/**
 * eBay Browse API adapter.
 *
 * This is the only eBay API a normal developer account can actually use for
 * buy-side search, and it returns LIVE listings only. Notes on the traps it
 * hides, all of which are handled below:
 *
 *  - Search returns ONLY fixed-price listings unless buyingOptions is passed
 *    explicitly. Auctions — where most underpricing lives — are invisible by
 *    default. This is the single most common silent bug in eBay integrations.
 *  - Every money field is a JSON string, not a number.
 *  - For auctions the meaningful figure is currentBidPrice, not price.
 *  - shippingOptions can be an empty array (local pickup, freight).
 *  - Multi-variation "group" listings report the price of their CHEAPEST
 *    variation, which reads as a spectacular deal and is not one.
 *  - itemId carries a variation suffix; legacyItemId is the stable listing id.
 *  - limit maxes at 200 and the default of 50 burns four times the quota for
 *    the same data.
 */

import { config, ebayConfigured } from '../config.js';
import type { ListingType, RawListing } from '../types.js';
import { logger } from '../util/logger.js';
import { RateLimiter, sleep, DailyBudgetExceeded } from '../util/rateLimiter.js';
import { CONDITION_IDS, categoriesFor, isExcludedFromPricing } from './ebayCategories.js';
import { ebayApiHost, getAppToken } from './ebayOAuth.js';
import type { SourceAdapter, SourceQuery, SourceResult } from './types.js';

const log = logger('ebay');

export const EBAY_MAX_LIMIT = 200;

/** Shared across the process so every watch draws from one quota. */
export const ebayLimiter = new RateLimiter({
  // 5,000/day is one call per ~17s sustained; allow short bursts for a sweep.
  ratePerSecond: 2,
  burst: 10,
  dailyBudget: config.maxApiCallsPerDay,
});

interface EbayAmount {
  value?: string;
  currency?: string;
}

interface EbayItemSummary {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  price?: EbayAmount;
  currentBidPrice?: EbayAmount;
  bidCount?: number;
  shippingOptions?: Array<{ shippingCost?: EbayAmount; shippingCostType?: string }>;
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  image?: { imageUrl?: string };
  thumbnailImages?: Array<{ imageUrl?: string }>;
  condition?: string;
  conditionId?: string;
  buyingOptions?: string[];
  itemEndDate?: string;
  itemCreationDate?: string;
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number };
  itemLocation?: { country?: string; postalCode?: string; city?: string };
  categories?: Array<{ categoryId?: string; categoryName?: string }>;
  leafCategoryIds?: string[];
  itemGroupHref?: string;
  itemGroupType?: string;
  marketingPrice?: { originalPrice?: EbayAmount; discountPercentage?: string };
  qualifiedPrograms?: string[];
  priorityListing?: boolean;
}

interface EbaySearchResponse {
  total?: number;
  next?: string;
  itemSummaries?: EbayItemSummary[];
  warnings?: Array<{ message?: string; longMessage?: string }>;
  autoCorrections?: unknown;
}

export class EbayBrowseAdapter implements SourceAdapter {
  readonly id = 'ebay';
  readonly displayName = 'eBay';
  readonly capabilities = {
    // Completed sales live behind the restricted Marketplace Insights API.
    soldComps: false,
    auctions: true,
    gradedFilter: true,
    needsCredentials: true,
  };

  isConfigured(): boolean {
    return ebayConfigured();
  }

  unavailableReason(): string | null {
    if (this.isConfigured()) return null;
    return 'Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in .env. A free developer account takes about five minutes — see docs/EBAY_SETUP.md.';
  }

  async search(query: SourceQuery): Promise<SourceResult> {
    if (!this.isConfigured()) {
      return { listings: [], callsUsed: 0, warnings: [this.unavailableReason()!] };
    }

    const wanted = query.limit ?? EBAY_MAX_LIMIT;
    const categories = categoriesFor({
      category: query.category ?? null,
      productType: query.productType ?? null,
      sealedOnly: query.sealedOnly ?? false,
    });

    const warnings: string[] = [];
    const bySourceId = new Map<string, RawListing>();
    let callsUsed = 0;

    // One request per category: eBay accepts only a single category_ids value
    // per call in practice, and each call costs quota.
    for (const category of categories) {
      if (bySourceId.size >= wanted) break;
      try {
        const page = await this.searchOneCategory(query, category.id, Math.min(EBAY_MAX_LIMIT, wanted));
        callsUsed += page.callsUsed;
        for (const listing of page.listings) {
          // Sellers cross-list the same box in two categories; legacyItemId
          // is stable where itemId carries a per-variation suffix.
          if (!bySourceId.has(listing.sourceItemId)) bySourceId.set(listing.sourceItemId, listing);
        }
        warnings.push(...page.warnings);
      } catch (err) {
        if (err instanceof DailyBudgetExceeded) {
          warnings.push(err.message);
          break;
        }
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`${category.name}: ${message}`);
        log.warn(`Search failed for category ${category.id}`, message);
      }
    }

    return { listings: [...bySourceId.values()].slice(0, wanted), callsUsed, warnings: dedupe(warnings) };
  }

  private async searchOneCategory(
    query: SourceQuery,
    categoryId: string,
    limit: number,
  ): Promise<SourceResult> {
    const params = new URLSearchParams();
    // The keyword field is capped at 100 characters and silently truncated.
    params.set('q', query.q.slice(0, 100));
    params.set('category_ids', categoryId);
    params.set('limit', String(Math.min(EBAY_MAX_LIMIT, Math.max(1, limit))));
    params.set('sort', 'newlyListed');
    // EXTENDED costs nothing extra and fills in fields that are otherwise blank.
    params.set('fieldgroups', 'EXTENDED');
    params.set('filter', buildFilter(query));

    const url = `${ebayApiHost()}/buy/browse/v1/item_summary/search?${params.toString()}`;
    const body = await this.request(url);

    const warnings = (body.warnings ?? [])
      .map((w) => w.longMessage ?? w.message ?? '')
      .filter((m): m is string => m.length > 0);

    const listings: RawListing[] = [];
    for (const item of body.itemSummaries ?? []) {
      const mapped = mapItem(item, categoryId);
      if (mapped) listings.push(mapped);
    }

    return { listings, callsUsed: 1, warnings };
  }

  private async request(url: string, attempt = 0): Promise<EbaySearchResponse> {
    await ebayLimiter.acquire(1);
    const token = await getAppToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      // An invalid value here silently falls back to EBAY_US rather than
      // erroring, so it is always sent explicitly.
      'X-EBAY-C-MARKETPLACE-ID': config.marketplace,
      Accept: 'application/json',
    };

    const ctx = endUserContext();
    if (ctx) headers['X-EBAY-C-ENDUSERCTX'] = ctx;

    const res = await fetch(url, { headers });

    if (res.status === 429 || res.status >= 500) {
      // The daily window does not slide, so hammering a 429 achieves nothing.
      if (attempt >= 3) {
        throw new Error(
          res.status === 429
            ? 'eBay rate limit hit (HTTP 429). The Browse quota is daily and resets at midnight UTC.'
            : `eBay returned HTTP ${res.status} repeatedly.`,
        );
      }
      const backoffMs = 1000 * 2 ** attempt;
      log.warn(`HTTP ${res.status} from eBay; retrying in ${backoffMs}ms.`);
      await sleep(backoffMs);
      return this.request(url, attempt + 1);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`eBay Browse returned HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    return (await res.json()) as EbaySearchResponse;
  }
}

/**
 * Builds the `filter` query value.
 *
 * Syntax rules that bite: different filters are comma-separated, multiple
 * values for one filter go in {braces|piped}, ranges go in [square..brackets],
 * and `price` is silently ignored unless `priceCurrency` accompanies it. The
 * whole value is handed to URLSearchParams, which encodes it correctly —
 * hand-concatenating it into a URL is the usual cause of HTTP 400s.
 */
export function buildFilter(query: SourceQuery): string {
  const parts: string[] = [];

  const min = query.minPriceCents != null ? (query.minPriceCents / 100).toFixed(2) : null;
  const max = query.maxPriceCents != null ? (query.maxPriceCents / 100).toFixed(2) : null;
  if (min && max) parts.push(`price:[${min}..${max}]`);
  else if (min) parts.push(`price:[${min}]`);
  else if (max) parts.push(`price:[..${max}]`);
  if (min || max) parts.push(`priceCurrency:${config.currency}`);

  // Without this the search silently omits every auction.
  const buying = query.includeAuctions === false
    ? ['FIXED_PRICE', 'BEST_OFFER']
    : ['FIXED_PRICE', 'AUCTION', 'BEST_OFFER'];
  parts.push(`buyingOptions:{${buying.join('|')}}`);

  if (query.condition === 'graded') parts.push(`conditionIds:{${CONDITION_IDS.graded}}`);
  else if (query.condition === 'raw') parts.push(`conditionIds:{${CONDITION_IDS.ungraded}}`);

  if (config.ebay.shipToCountry) parts.push(`deliveryCountry:${config.ebay.shipToCountry}`);

  if (query.since) {
    parts.push(`itemStartDate:[${query.since.toISOString().replace(/\.\d{3}Z$/, '.000Z')}]`);
  }

  return parts.join(',');
}

/**
 * The end-user context header does two jobs: it enables affiliate links, and it
 * gives eBay a buyer location so calculated shipping estimates are real numbers
 * instead of guesses. Its inner separators must be percent-encoded while the
 * outer commas stay literal.
 */
export function endUserContext(): string | null {
  const parts: string[] = [];
  if (config.ebay.epnCampaignId) parts.push(`affiliateCampaignId=${config.ebay.epnCampaignId}`);
  if (config.ebay.shipToZip && config.ebay.shipToCountry) {
    const inner = `country=${config.ebay.shipToCountry},zip=${config.ebay.shipToZip}`;
    parts.push(`contextualLocation=${inner.replace(/=/g, '%3D').replace(/,/g, '%2C')}`);
  }
  return parts.length > 0 ? parts.join(',') : null;
}

function mapItem(item: EbayItemSummary, searchedCategoryId: string): RawListing | null {
  const title = item.title?.trim();
  // legacyItemId is the stable listing number; itemId varies per variation.
  const sourceItemId = item.legacyItemId ?? item.itemId;
  if (!title || !sourceItemId) return null;

  const buyingOptions = item.buyingOptions ?? [];
  const isAuction = buyingOptions.includes('AUCTION');
  const listingType: ListingType = isAuction
    ? buyingOptions.includes('FIXED_PRICE')
      ? 'auction-with-bin'
      : 'auction'
    : buyingOptions.includes('BEST_OFFER')
      ? 'best-offer'
      : buyingOptions.includes('FIXED_PRICE')
        ? 'fixed'
        : 'unknown';

  // For a live auction the asking price is the current bid, not `price`.
  const priceSource = isAuction && item.currentBidPrice ? item.currentBidPrice : item.price;
  const priceCents = amountToCents(priceSource);
  if (priceCents === null) return null;

  const shippingCents = firstShippingCents(item);
  const category = item.leafCategoryIds?.[0] ?? item.categories?.[0]?.categoryId ?? searchedCategoryId;

  return {
    source: 'ebay',
    sourceItemId,
    title,
    // Prefer the affiliate URL when EPN is configured; it is the same page.
    url: item.itemAffiliateWebUrl ?? item.itemWebUrl ?? `https://www.ebay.com/itm/${sourceItemId}`,
    imageUrl: item.image?.imageUrl ?? item.thumbnailImages?.[0]?.imageUrl ?? null,
    currency: priceSource?.currency ?? config.currency,
    priceCents,
    shippingCents,
    listingType,
    bidCount: typeof item.bidCount === 'number' ? item.bidCount : null,
    endsAt: item.itemEndDate ?? null,
    condition: item.condition ?? null,
    sellerName: item.seller?.username ?? null,
    sellerFeedbackPct: parseNumeric(item.seller?.feedbackPercentage),
    sellerFeedbackCount: typeof item.seller?.feedbackScore === 'number' ? item.seller.feedbackScore : null,
    locationCountry: item.itemLocation?.country ?? null,
    raw: {
      itemId: item.itemId,
      conditionId: item.conditionId,
      categoryId: category,
      // A group listing quotes its cheapest variation, which looks like a
      // bargain and is not one. The ingest pipeline drops these.
      itemGroupType: item.itemGroupType ?? null,
      isGroupListing: Boolean(item.itemGroupHref),
      excludedCategory: isExcludedFromPricing(category),
      qualifiedPrograms: item.qualifiedPrograms ?? [],
      priorityListing: item.priorityListing ?? false,
      marketingDiscountPct: parseNumeric(item.marketingPrice?.discountPercentage),
    },
  };
}

function amountToCents(amount: EbayAmount | undefined): number | null {
  if (!amount?.value) return null;
  const parsed = Number.parseFloat(amount.value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/** null means "not disclosed", which is different from free shipping. */
function firstShippingCents(item: EbayItemSummary): number | null {
  const options = item.shippingOptions;
  if (!options || options.length === 0) return null;
  for (const option of options) {
    const cents = amountToCents(option.shippingCost);
    if (cents !== null) return cents;
  }
  return null;
}

function parseNumeric(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
