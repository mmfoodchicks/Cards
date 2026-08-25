/**
 * Offline demo source.
 *
 * The app should be worth looking at before anyone signs up for an eBay
 * developer account, so this adapter synthesises a realistic market from the
 * MSRP catalog: mostly sensible prices, a few genuine bargains, some auctions
 * mid-flight, and the junk a real search returns — empty boxes, repacks and
 * unlabelled lots — so the scoring and the warnings can be seen working.
 *
 * It is deterministic: the same query always produces the same listings, which
 * makes it usable as test data as well as a demo.
 */

import { loadCatalog, type CatalogEntry } from '../catalog/msrpCatalog.js';
import type { ListingType, RawListing } from '../types.js';
import { normalizeTitle } from '../util/text.js';
import type { SourceAdapter, SourceQuery, SourceResult } from './types.js';

/** Small deterministic PRNG so demo data is stable across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SELLERS = [
  { name: 'cardvaultpa', pct: 99.8, count: 24310 },
  { name: 'slabhouse_co', pct: 100, count: 1842 },
  { name: 'waxandwonder', pct: 99.2, count: 512 },
  { name: 'thehobbyshop88', pct: 97.4, count: 88 },
  { name: 'newseller2026', pct: 92.0, count: 3 },
];

/** Junk that a real keyword search drags in, so the filters can be seen working. */
const NOISE_TEMPLATES = [
  { suffix: 'EMPTY BOX ONLY no cards read description', factor: 0.08 },
  { suffix: 'Mystery Repack Hot Pack chase card!!', factor: 0.35 },
  { suffix: 'PROXY custom reprint card not authentic', factor: 0.05 },
  { suffix: 'Lot bundle assorted mixed', factor: 2.4 },
];

export class FixtureAdapter implements SourceAdapter {
  readonly id = 'demo';
  readonly displayName = 'Demo data (offline)';
  readonly capabilities = {
    soldComps: false,
    auctions: true,
    gradedFilter: true,
    needsCredentials: false,
  };

  isConfigured(): boolean {
    return true;
  }

  unavailableReason(): string | null {
    return null;
  }

  async search(query: SourceQuery): Promise<SourceResult> {
    const catalog = loadCatalog();
    const needle = normalizeTitle(query.q).trim();
    const terms = needle.split(/\s+/).filter((t) => t.length > 2);

    // Structural filters are hard: asking for Pokemon sealed product and being
    // shown basketball boxes would be worse than being shown nothing.
    const eligible = catalog.entries.filter((entry) => {
      if (query.category && entry.category !== query.category) return false;
      if (query.productType && entry.productType !== query.productType) return false;
      return true;
    });

    // Keywords are soft: real searches like "elite trainer box booster box
    // sealed" name several products at once, so entries are ranked by how many
    // terms they match rather than required to match all of them.
    const ranked = eligible
      .map((entry) => {
        const hay = normalizeTitle(
          `${entry.year} ${entry.setName} ${entry.productType} ${entry.brand} ${entry.aliases.join(' ')}`,
        );
        return { entry, hits: terms.filter((t) => hay.includes(t)).length };
      })
      .filter((r) => terms.length === 0 || r.hits > 0)
      .sort((a, b) => b.hits - a.hits);

    const pool = ranked.length > 0 ? ranked.map((r) => r.entry) : eligible;
    const limit = query.limit ?? 60;
    const listings: RawListing[] = [];

    for (const entry of pool) {
      if (listings.length >= limit) break;
      listings.push(...this.listingsFor(entry, query));
    }

    return {
      listings: listings.slice(0, limit),
      callsUsed: 0,
      warnings: [
        ranked.length === 0
          ? 'Demo mode: nothing in the catalog matched those keywords, so a sample of the catalog is shown instead.'
          : 'Demo mode: these listings are generated, not real. Add eBay credentials to search the live market.',
      ],
    };
  }

  private listingsFor(entry: CatalogEntry, query: SourceQuery): RawListing[] {
    const rand = mulberry32(hashString(entry.id));
    const out: RawListing[] = [];
    const count = 4 + Math.floor(rand() * 3);

    for (let i = 0; i < count; i++) {
      // Most sellers sit above MSRP; a couple sit meaningfully below it.
      // That skew is the real shape of the market and is what makes the
      // "under MSRP" flag rare and therefore worth seeing.
      const roll = rand();
      const factor =
        roll < 0.12 ? 0.62 + rand() * 0.13 // a genuine bargain
        : roll < 0.3 ? 0.86 + rand() * 0.12 // slightly under MSRP
        : roll < 0.75 ? 1.0 + rand() * 0.25 // at or a little over
        : 1.3 + rand() * 0.8; // aspirational

      const isAuction = rand() < 0.25;
      if (isAuction && query.includeAuctions === false) continue;

      const seller = SELLERS[Math.floor(rand() * SELLERS.length)]!;
      const shippingRoll = rand();
      const shippingCents = shippingRoll < 0.55 ? 0 : shippingRoll < 0.9 ? Math.round(495 + rand() * 900) : null;

      // Auctions land at a fraction of value early and climb as they close.
      const hoursLeft = isAuction ? Math.round(1 + rand() * 160) : 0;
      const closing = isAuction && hoursLeft <= 6;
      const auctionFactor = isAuction ? (closing ? 0.8 + rand() * 0.25 : 0.15 + rand() * 0.4) : 1;

      const priceCents = Math.max(99, Math.round(entry.msrpCents * factor * auctionFactor));
      const listingType: ListingType = isAuction ? 'auction' : rand() < 0.35 ? 'best-offer' : 'fixed';

      out.push({
        source: this.id,
        sourceItemId: `demo-${entry.id}-${i}`,
        title: `${entry.year} ${entry.setName} ${humanize(entry.productType)}${entry.variant ? ` ${entry.variant.replace(/-/g, ' ')}` : ''} Factory Sealed`,
        url: 'https://example.invalid/demo-listing',
        imageUrl: null,
        currency: 'USD',
        priceCents,
        shippingCents,
        listingType,
        bidCount: isAuction ? Math.floor(rand() * (closing ? 22 : 4)) : null,
        endsAt: isAuction ? new Date(Date.now() + hoursLeft * 3_600_000).toISOString() : null,
        condition: 'New',
        sellerName: seller.name,
        sellerFeedbackPct: seller.pct,
        sellerFeedbackCount: seller.count,
        locationCountry: 'US',
        raw: { demo: true, basedOnMsrpCents: entry.msrpCents },
      });
    }

    // One junk listing per product, so the safety rails are visible.
    if (rand() < 0.5) {
      const noise = NOISE_TEMPLATES[Math.floor(rand() * NOISE_TEMPLATES.length)]!;
      out.push({
        source: this.id,
        sourceItemId: `demo-${entry.id}-noise`,
        title: `${entry.year} ${entry.setName} ${humanize(entry.productType)} ${noise.suffix}`,
        url: 'https://example.invalid/demo-listing',
        imageUrl: null,
        currency: 'USD',
        priceCents: Math.max(99, Math.round(entry.msrpCents * noise.factor)),
        shippingCents: 0,
        listingType: 'fixed',
        bidCount: null,
        endsAt: null,
        condition: 'New',
        sellerName: 'newseller2026',
        sellerFeedbackPct: 92,
        sellerFeedbackCount: 3,
        locationCountry: 'US',
        raw: { demo: true, noise: true },
      });
    }

    return out;
  }
}

function humanize(type: string): string {
  return type.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
