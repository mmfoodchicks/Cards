import { describe, expect, it } from 'vitest';
import { enrichListing, shouldObserve } from '../pipeline/ingest.js';
import { buildFilter } from '../sources/ebayBrowse.js';
import { FixtureAdapter } from '../sources/fixture.js';
import { categoriesFor } from '../sources/ebayCategories.js';
import { RateLimiter, DailyBudgetExceeded } from '../util/rateLimiter.js';
import type { RawListing } from '../types.js';

function listing(overrides: Partial<RawListing> = {}): RawListing {
  return {
    source: 'test',
    sourceItemId: '1',
    title: '2025 Bowman Baseball Hobby Box Factory Sealed',
    url: 'https://example.invalid/1',
    imageUrl: null,
    currency: 'USD',
    priceCents: 19000,
    shippingCents: 0,
    listingType: 'fixed',
    bidCount: null,
    endsAt: null,
    condition: 'New',
    sellerName: 'seller',
    sellerFeedbackPct: 99.5,
    sellerFeedbackCount: 500,
    locationCountry: 'US',
    ...overrides,
  };
}

// The pipeline normally reads baselines from SQLite; these tests supply them
// directly so scoring can be exercised without a database.
const noMarketData = { baselineLookup: () => null, compLookup: () => null };

describe('enrichment', () => {
  it('scores a sealed listing against MSRP and flags it under MSRP', () => {
    const result = enrichListing(listing(), noMarketData);
    expect(result.benchmarkKind).toBe('msrp');
    expect(result.underMsrp).toBe(true);
    expect(result.discountPct).toBeGreaterThan(0.1);
  });

  it('includes shipping in the comparison', () => {
    const free = enrichListing(listing({ shippingCents: 0 }), noMarketData);
    const shipped = enrichListing(listing({ shippingCents: 4000 }), noMarketData);
    expect(shipped.unitCents).toBeGreaterThan(free.unitCents);
    expect(shipped.discountPct!).toBeLessThan(free.discountPct!);
  });

  it('refuses to score a multi-variation group listing', () => {
    // eBay reports the cheapest variation's price for these, which reads as an
    // enormous discount on whatever the title happens to describe.
    const result = enrichListing(
      listing({ priceCents: 500, raw: { isGroupListing: true } }),
      noMarketData,
    );
    expect(result.label).toBe('unscored');
    expect(result.notes.join(' ')).toMatch(/cheapest variation/i);
  });

  it('prefers a provider comp over an observed-ask baseline', () => {
    const result = enrichListing(listing({ title: 'Charizard ex 199/165 Pokemon 151' }), {
      baselineLookup: () => ({
        productKey: 'k', valueCents: 10000, kind: 'ask-derived', n: 9,
        dispersion: 0.2, confidence: 0.6, computedAt: new Date().toISOString(),
      }),
      compLookup: () => ({
        productKey: 'k', provider: 'pokemontcg', valueCents: 37689,
        basis: 'TCGplayer holofoil market price', sampleSize: null,
        fetchedAt: new Date().toISOString(), detail: null,
      }),
    });
    expect(result.benchmarkKind).toBe('sold-comp');
    expect(result.benchmarkCents).toBe(37689);
  });

  it('warns when a product trades far above its MSRP', () => {
    const result = enrichListing(listing(), {
      baselineLookup: () => ({
        productKey: 'k', valueCents: 40000, kind: 'ask-derived', n: 12,
        dispersion: 0.15, confidence: 0.7, computedAt: new Date().toISOString(),
      }),
      compLookup: () => null,
    });
    expect(result.notes.join(' ')).toMatch(/above MSRP/i);
  });
});

describe('observation gate', () => {
  const enrich = (overrides: Partial<RawListing>) => enrichListing(listing(overrides), noMarketData);

  it('accepts a clean fixed-price listing', () => {
    expect(shouldObserve(enrich({}))).toBe(true);
  });

  it('rejects anything with a red flag', () => {
    expect(shouldObserve(enrich({ title: '2025 Bowman Hobby Box EMPTY BOX ONLY' }))).toBe(false);
  });

  it('rejects an unbid auction, whose price nobody has competed for', () => {
    const result = enrich({
      listingType: 'auction',
      bidCount: 0,
      endsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });
    expect(shouldObserve(result)).toBe(false);
  });

  it('accepts an auction in its final hour once it has real bids', () => {
    const result = enrich({
      listingType: 'auction',
      bidCount: 14,
      endsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    expect(shouldObserve(result)).toBe(true);
  });

  it('holds auctions to a stricter standard for evidence than for display', () => {
    // An auction closing in two hours with real bids is worth showing a user —
    // they can still bid on it — but eBay price paths are back-loaded, so its
    // current price is not yet evidence about what the product is worth.
    const closingSoon = enrich({
      listingType: 'auction',
      bidCount: 14,
      endsAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    });
    expect(closingSoon.label).not.toBe('unscored');
    expect(shouldObserve(closingSoon)).toBe(false);
  });

  it('rejects categories that do not sell the product itself', () => {
    // Break slots and repacks live in their own eBay categories.
    expect(shouldObserve(enrich({ raw: { excludedCategory: true } }))).toBe(false);
  });
});

describe('eBay query construction', () => {
  it('asks for auctions explicitly, since search hides them by default', () => {
    expect(buildFilter({ q: 'x' })).toContain('buyingOptions:{FIXED_PRICE|AUCTION|BEST_OFFER}');
  });

  it('omits auctions when asked to', () => {
    expect(buildFilter({ q: 'x', includeAuctions: false })).not.toContain('AUCTION');
  });

  it('always pairs a price range with a currency', () => {
    // eBay silently ignores the price filter when priceCurrency is absent,
    // which looks like filtering that is not happening.
    const filter = buildFilter({ q: 'x', minPriceCents: 2500, maxPriceCents: 50000 });
    expect(filter).toContain('price:[25.00..500.00]');
    expect(filter).toContain('priceCurrency:');
  });

  it('builds open-ended ranges with the right bracket syntax', () => {
    expect(buildFilter({ q: 'x', minPriceCents: 5000 })).toContain('price:[50.00]');
    expect(buildFilter({ q: 'x', maxPriceCents: 5000 })).toContain('price:[..50.00]');
  });

  it('maps condition to eBay trading-card condition ids', () => {
    expect(buildFilter({ q: 'x', condition: 'graded' })).toContain('conditionIds:{2750}');
    expect(buildFilter({ q: 'x', condition: 'raw' })).toContain('conditionIds:{4000}');
  });

  it('survives being URL encoded', () => {
    const filter = buildFilter({ q: 'x', minPriceCents: 100, maxPriceCents: 200, condition: 'graded' });
    const round = new URLSearchParams({ filter }).toString();
    expect(decodeURIComponent(round.slice('filter='.length))).toBe(filter);
  });
});

describe('eBay category selection', () => {
  it('sweeps both CCG sealed categories, because sellers split boxes across them', () => {
    const ids = categoriesFor({ category: 'pokemon', sealedOnly: true }).map((c) => c.id);
    expect(ids).toContain('261044');
    expect(ids).toContain('183456');
  });

  it('uses the sports singles category for graded sports cards', () => {
    const ids = categoriesFor({ category: 'baseball', productType: 'single' }).map((c) => c.id);
    expect(ids).toEqual(['261328']);
  });

  it('never sweeps break or repack categories', () => {
    const everything = categoriesFor({});
    for (const c of everything) {
      expect(['261334', '261337', '463773', '183460', '183455']).not.toContain(c.id);
    }
  });
});

describe('rate limiting', () => {
  it('refuses to spend more than the daily budget', async () => {
    const limiter = new RateLimiter({ ratePerSecond: 1000, burst: 1000, dailyBudget: 2 });
    await limiter.acquire();
    await limiter.acquire();
    await expect(limiter.acquire()).rejects.toBeInstanceOf(DailyBudgetExceeded);
    expect(limiter.status().remaining).toBe(0);
  });
});

describe('demo source', () => {
  it('produces listings without any credentials', async () => {
    const result = await new FixtureAdapter().search({ q: 'pokemon elite trainer box', limit: 40 });
    expect(result.listings.length).toBeGreaterThan(0);
    expect(result.callsUsed).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/demo/i);
  });

  it('is deterministic, so it doubles as test data', async () => {
    const adapter = new FixtureAdapter();
    const a = await adapter.search({ q: 'bowman hobby box', limit: 20 });
    const b = await adapter.search({ q: 'bowman hobby box', limit: 20 });
    expect(a.listings.map((l) => l.priceCents)).toEqual(b.listings.map((l) => l.priceCents));
  });

  it('respects a category filter', async () => {
    const result = await new FixtureAdapter().search({ q: 'box', category: 'pokemon', limit: 30 });
    const enriched = result.listings.map((l) => enrichListing(l, noMarketData));
    expect(enriched.every((l) => l.parsed.category === 'pokemon')).toBe(true);
  });
});
