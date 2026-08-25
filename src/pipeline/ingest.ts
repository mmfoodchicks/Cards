/**
 * The deal engine: raw listings in, scored listings out.
 *
 * Order matters here. A listing is parsed, then priced against the best
 * benchmark available for it, then scored — and at each step the pipeline
 * prefers to record "we don't know" over producing a confident wrong answer,
 * because the failure mode of a deal finder is not missing a bargain, it is
 * telling you something is a bargain when it is not.
 */

import { config } from '../config.js';
import { loadCatalog, resolveMsrp, type CatalogFile } from '../catalog/msrpCatalog.js';
import { getBaseline, recordObservation, upsertListing, type ProviderComp } from '../db/repos.js';
import { cachedComp } from './comps.js';
import type { Db } from '../db/index.js';
import { msrpConfidence } from '../pricing/baseline.js';
import { computeLandedCost } from '../pricing/landedCost.js';
import { scoreListing } from '../pricing/score.js';
import { parseTitle } from '../parse/titleParser.js';
import type { BenchmarkKind, RawListing, ScoredListing } from '../types.js';
import { logger } from '../util/logger.js';

const log = logger('ingest');

export interface EnrichOptions {
  now?: Date;
  catalog?: CatalogFile;
  /** Supplies the market baseline. Injectable so scoring can be tested offline. */
  baselineLookup?: (productKey: string) => ReturnType<typeof getBaseline>;
  /** Supplies a price-provider quote. Injectable for the same reason. */
  compLookup?: (productKey: string) => ProviderComp | null;
  db?: Db;
}

/** Parse, benchmark and score one raw listing. Pure: touches no storage. */
export function enrichListing(raw: RawListing, opts: EnrichOptions = {}): ScoredListing {
  const now = opts.now ?? new Date();
  const catalog = opts.catalog ?? loadCatalog();

  const parsed = parseTitle(raw.title, { conditionHint: raw.condition ?? undefined });

  const cost = computeLandedCost({
    priceCents: raw.priceCents,
    shippingCents: raw.shippingCents,
    quantity: parsed.quantity,
    taxRate: config.estTaxRate,
    assumedShippingCents: config.assumedShippingCents,
  });

  const notes: string[] = [...cost.notes];

  // A multi-variation group listing quotes its CHEAPEST variation, so it looks
  // like a spectacular find and is not one.
  const rawMeta = (raw.raw ?? {}) as { isGroupListing?: boolean; excludedCategory?: boolean };
  const isGroupListing = rawMeta.isGroupListing === true;
  if (isGroupListing) {
    notes.push('Multi-variation listing: the price shown is the cheapest variation, not this item.');
  }

  const benchmark = resolveBenchmark(parsed, raw.title, catalog, opts);
  notes.push(...benchmark.notes);

  const scored = scoreListing({
    parsed,
    unitCents: cost.unitCents,
    benchmark: isGroupListing ? null : benchmark.value,
    listingType: raw.listingType,
    bidCount: raw.bidCount,
    endsAt: raw.endsAt,
    shippingKnown: cost.shippingKnown,
    sellerFeedbackPct: raw.sellerFeedbackPct,
    sellerFeedbackCount: raw.sellerFeedbackCount,
    now,
  });

  const nowIso = now.toISOString();
  return {
    ...raw,
    id: `${raw.source}:${raw.sourceItemId}`,
    parsed,
    landedCents: cost.landedCents,
    unitCents: cost.unitCents,
    benchmarkKind: benchmark.value?.kind ?? 'none',
    benchmarkCents: benchmark.value?.valueCents ?? null,
    benchmarkLabel: benchmark.label,
    benchmarkSource: benchmark.source,
    discountPct: scored.discountPct,
    label: scored.label,
    underMsrp: scored.underMsrp,
    shippingUnknown: !cost.shippingKnown,
    confidence: scored.confidence,
    score: scored.score,
    notes: dedupeNotes([...notes, ...scored.notes]),
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
  };
}

interface ResolvedBenchmark {
  value: { kind: BenchmarkKind; valueCents: number; confidence: number } | null;
  label: string | null;
  source: string | null;
  notes: string[];
}

/**
 * Choose the benchmark.
 *
 * MSRP is preferred for sealed product because it is a hard published number
 * the user asked about specifically. Market data still gets computed and shown
 * alongside it, because sealed product frequently trades well above MSRP and
 * "under MSRP but still over market" is a distinction worth seeing.
 */
function resolveBenchmark(
  parsed: ReturnType<typeof parseTitle>,
  rawTitle: string,
  catalog: CatalogFile,
  opts: EnrichOptions,
): ResolvedBenchmark {
  const notes: string[] = [];
  const lookup = opts.baselineLookup ?? ((key: string) => getBaseline(key, opts.db));
  const compFor = opts.compLookup ?? ((key: string) => cachedComp(key, opts.now, opts.db));

  const market = parsed.productKey ? lookup(parsed.productKey) : null;
  const comp = parsed.productKey ? compFor(parsed.productKey) : null;

  if (parsed.sealed) {
    const msrp = resolveMsrp(parsed, rawTitle, catalog);
    if (msrp.match) {
      if (msrp.match.quality === 'era-default') {
        notes.push(`MSRP is the era-wide price for this product type (${msrp.match.label}), not a per-set figure.`);
      }
      if (msrp.match.ambiguityNote) notes.push(msrp.match.ambiguityNote);
      if (msrp.match.confidence === 'low') {
        notes.push('This "MSRP" is a typical retail price, not a published manufacturer figure.');
      }
      if (market) {
        const delta = (market.valueCents - msrp.match.msrpCents) / msrp.match.msrpCents;
        if (delta > 0.15) {
          notes.push(`Heads up: this product currently trades about ${(delta * 100).toFixed(0)}% above MSRP, so under-MSRP listings sell fast.`);
        } else if (delta < -0.15) {
          notes.push(`Heads up: this product currently trades about ${(-delta * 100).toFixed(0)}% below MSRP, so being under MSRP is not by itself a bargain.`);
        }
      }
      return {
        value: { kind: 'msrp', valueCents: msrp.match.msrpCents, confidence: msrpConfidence(msrp.match.confidence) },
        label: msrp.match.label,
        source: msrp.match.source,
        notes,
      };
    }
    notes.push(msrp.reason);
  }

  // A provider's market price is a real valuation and outranks anything we
  // could infer from the asking prices we happen to have seen.
  if (comp) {
    const ageDays = Math.floor((Date.now() - Date.parse(comp.fetchedAt)) / 86_400_000);
    if (ageDays >= 7) notes.push(`Market value is ${ageDays} days old.`);
    return {
      value: {
        kind: 'sold-comp',
        valueCents: comp.valueCents,
        // Freshness is the only real risk with a provider figure.
        confidence: ageDays <= 3 ? 0.95 : ageDays <= 14 ? 0.85 : 0.7,
      },
      label: comp.basis,
      source: comp.provider,
      notes,
    };
  }

  if (market) {
    return {
      value: { kind: market.kind, valueCents: market.valueCents, confidence: market.confidence },
      label: `Market value from ${market.n} observation${market.n === 1 ? '' : 's'}`,
      source: describeBaselineKind(market.kind),
      notes,
    };
  }

  if (!parsed.sealed) {
    notes.push('Singles have no MSRP, and not enough comparable sales have been seen yet to estimate a market value.');
  }
  return { value: null, label: null, source: null, notes };
}

function describeBaselineKind(kind: BenchmarkKind): string {
  switch (kind) {
    case 'sold-comp':
      return 'Completed sales reported by a price data source.';
    case 'sold-inferred':
      return 'Listings that disappeared before their end date, which usually means they sold.';
    case 'ask-derived':
      return 'The low end of current asking prices for the same product.';
    case 'msrp':
      return 'Manufacturer suggested retail price.';
    default:
      return 'Unknown.';
  }
}

function dedupeNotes(notes: string[]): string[] {
  return [...new Set(notes.filter((n) => n.trim().length > 0))];
}

export interface IngestStats {
  seen: number;
  stored: number;
  newListings: number;
  deals: number;
  skipped: number;
}

/**
 * Persist a batch of scored listings and record their prices as observations.
 *
 * Only listings we could identify AND whose price is meaningful feed the
 * observation table — junk, lots and un-bid auctions would poison every future
 * baseline built from it.
 */
export function persistListings(
  listings: ScoredListing[],
  watchId: number | null,
  db?: Db,
): IngestStats {
  const stats: IngestStats = { seen: listings.length, stored: 0, newListings: 0, deals: 0, skipped: 0 };

  for (const listing of listings) {
    const { isNew } = upsertListing(listing, watchId, db);
    stats.stored++;
    if (isNew) stats.newListings++;
    if (isDeal(listing)) stats.deals++;

    if (shouldObserve(listing)) {
      recordObservation(
        {
          productKey: listing.parsed.productKey!,
          observedAt: listing.lastSeenAt,
          unitCents: listing.unitCents,
          kind: 'ask',
          source: listing.source,
          listingId: listing.id,
        },
        db,
      );
    } else {
      stats.skipped++;
    }
  }

  log.debug(`Stored ${stats.stored} listings (${stats.newListings} new, ${stats.deals} deals).`);
  return stats;
}

/** Labels that represent an actionable opportunity. */
export function isDeal(listing: ScoredListing): boolean {
  return listing.label === 'steal' || listing.label === 'great-deal' || listing.label === 'good-deal';
}

/**
 * Whether a listing's price is clean enough to become a market observation.
 *
 * This gate is the difference between a baseline that means something and one
 * that drifts toward junk over time, so it is deliberately strict.
 */
export function shouldObserve(listing: ScoredListing): boolean {
  const p = listing.parsed;
  if (!p.productKey) return false;
  if (p.mixedLot) return false;
  if (p.redFlags.length > 0) return false;
  if (p.parseConfidence < 0.5) return false;
  if (listing.unitCents <= 0) return false;

  const meta = (listing.raw ?? {}) as { isGroupListing?: boolean; excludedCategory?: boolean };
  // Break slots, repacks, supplies and mixed lots live in their own eBay
  // categories and are never comparable to the product itself.
  if (meta.excludedCategory === true) return false;
  if (meta.isGroupListing === true) return false;

  // An auction nobody has bid on is not a price. One that has been bid up, or
  // is about to close, is.
  if (listing.listingType === 'auction' || listing.listingType === 'auction-with-bin') {
    const hoursLeft = listing.endsAt ? (Date.parse(listing.endsAt) - Date.now()) / 3_600_000 : Infinity;
    const bids = listing.bidCount ?? 0;
    if (hoursLeft > 6 && bids < 5) return false;
  }

  return true;
}
