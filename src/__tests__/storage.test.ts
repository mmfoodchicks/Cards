import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, type Db } from '../db/index.js';
import {
  MAX_OBSERVATIONS_PER_LISTING,
  createWatch,
  findVanishedListings,
  markGone,
  observationsFor,
  purgeOldListings,
  queryListings,
  recordObservation,
  upsertListing,
} from '../db/repos.js';
import { enrichListing } from '../pipeline/ingest.js';
import { sweepVanishedListings } from '../pipeline/baselines.js';
import type { RawListing } from '../types.js';

let db: Db;
beforeEach(() => {
  db = openMemoryDb();
});

const noMarketData = { baselineLookup: () => null, compLookup: () => null };

function raw(overrides: Partial<RawListing> = {}): RawListing {
  return {
    source: 'test',
    sourceItemId: 'abc',
    title: '2025 Bowman Baseball Hobby Box Factory Sealed',
    url: 'https://example.invalid/abc',
    imageUrl: null,
    currency: 'USD',
    priceCents: 19000,
    shippingCents: 0,
    listingType: 'fixed',
    bidCount: null,
    endsAt: null,
    condition: 'New',
    sellerName: 'seller',
    sellerFeedbackPct: 99,
    sellerFeedbackCount: 300,
    locationCountry: 'US',
    ...overrides,
  };
}

describe('listing storage', () => {
  it('inserts once and updates thereafter', () => {
    const first = enrichListing(raw(), noMarketData);
    expect(upsertListing(first, null, db).isNew).toBe(true);
    expect(upsertListing(first, null, db).isNew).toBe(false);
    expect(queryListings({}, db).total).toBe(1);
  });

  it('keeps the original first-seen time when a listing is re-scanned', () => {
    const first = enrichListing(raw(), noMarketData);
    upsertListing(first, null, db);
    const later = { ...first, firstSeenAt: '2030-01-01T00:00:00Z', lastSeenAt: '2030-01-01T00:00:00Z' };
    upsertListing(later, null, db);
    const stored = queryListings({}, db).rows[0]!;
    // How long something has sat unsold is a real signal; clobbering the
    // first-seen time would lose it.
    expect(stored.first_seen_at).toBe(first.firstSeenAt);
    expect(stored.last_seen_at).toBe('2030-01-01T00:00:00Z');
  });

  it('filters to listings under MSRP', () => {
    upsertListing(enrichListing(raw(), noMarketData), null, db);
    upsertListing(
      enrichListing(raw({ sourceItemId: 'pricey', priceCents: 40000 }), noMarketData),
      null,
      db,
    );
    expect(queryListings({ underMsrpOnly: true }, db).total).toBe(1);
  });

  it('hides listings that have disappeared unless asked for them', () => {
    const scored = enrichListing(raw(), noMarketData);
    upsertListing(scored, null, db);
    markGone(scored.id, new Date().toISOString(), db);
    expect(queryListings({}, db).total).toBe(0);
    expect(queryListings({ includeGone: true }, db).total).toBe(1);
  });
});

describe('price observations', () => {
  it('caps how much one listing can say about a market', () => {
    // A listing that sits unsold for months is one opinion repeated, not
    // months of independent evidence.
    for (let week = 0; week < 10; week++) {
      recordObservation(
        {
          productKey: 'k',
          observedAt: new Date(Date.UTC(2026, 0, 1 + week * 7)).toISOString(),
          unitCents: 1000,
          kind: 'ask',
          source: 'test',
          listingId: 'same-listing',
        },
        db,
      );
    }
    expect(observationsFor('k', '2020-01-01T00:00:00Z', db)).toHaveLength(MAX_OBSERVATIONS_PER_LISTING);
  });

  it('accepts one observation per listing per week, not per scan', () => {
    for (let hour = 0; hour < 12; hour++) {
      recordObservation(
        {
          productKey: 'k',
          observedAt: new Date(Date.UTC(2026, 0, 5, hour)).toISOString(),
          unitCents: 1000,
          kind: 'ask',
          source: 'test',
          listingId: 'hourly',
        },
        db,
      );
    }
    expect(observationsFor('k', '2020-01-01T00:00:00Z', db)).toHaveLength(1);
  });

  it('records the seller so one shop cannot dominate a baseline', () => {
    recordObservation(
      { productKey: 'k', observedAt: new Date().toISOString(), unitCents: 500, kind: 'ask', source: 't', listingId: 'x', sellerId: 'shop' },
      db,
    );
    expect(observationsFor('k', '2020-01-01T00:00:00Z', db)[0]!.sellerId).toBe('shop');
  });
});

describe('vanished-listing inference', () => {
  const now = new Date('2026-08-25T00:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

  function store(overrides: Partial<RawListing>, firstSeen: string, lastSeen: string) {
    const scored = enrichListing(raw(overrides), noMarketData);
    upsertListing({ ...scored, firstSeenAt: firstSeen, lastSeenAt: lastSeen }, null, db);
    return scored.id;
  }

  it('treats a fixed-price listing that vanished as a likely sale', () => {
    store({ sourceItemId: 'sold', endsAt: daysAgo(-20) }, daysAgo(10), daysAgo(3));
    const result = sweepVanishedListings(now, db);
    expect(result.markedGone).toBe(1);
    expect(result.inferredSales).toBe(1);

    const observations = observationsFor(
      enrichListing(raw({ sourceItemId: 'sold' }), noMarketData).parsed.productKey!,
      '2020-01-01T00:00:00Z',
      db,
    );
    expect(observations.some((o) => o.kind === 'sold-inferred')).toBe(true);
  });

  it('does not call an expired listing a sale', () => {
    // Its end date had already passed, so it simply ran out.
    store({ sourceItemId: 'expired', endsAt: daysAgo(5) }, daysAgo(10), daysAgo(3));
    const result = sweepVanishedListings(now, db);
    expect(result.markedGone).toBe(1);
    expect(result.inferredSales).toBe(0);
  });

  it('ignores a listing seen only once, which may just be search churn', () => {
    const seenOnce = daysAgo(3);
    store({ sourceItemId: 'blip' }, seenOnce, seenOnce);
    expect(findVanishedListings(daysAgo(1), db)).toHaveLength(0);
  });

  it('leaves recently seen listings alone', () => {
    store({ sourceItemId: 'live', endsAt: daysAgo(-20) }, daysAgo(10), daysAgo(0.1));
    expect(sweepVanishedListings(now, db).markedGone).toBe(0);
  });
});

describe('retention', () => {
  it('expires cached listings but keeps our own measurements', () => {
    // eBay's licence allows only limited intermediate copies of their data.
    // The observations are our measurements, not their catalog, so they stay.
    const scored = enrichListing(raw(), noMarketData);
    upsertListing({ ...scored, firstSeenAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-01-02T00:00:00Z' }, null, db);
    recordObservation(
      { productKey: scored.parsed.productKey!, observedAt: '2026-01-02T00:00:00Z', unitCents: 1000, kind: 'ask', source: 't', listingId: scored.id },
      db,
    );

    expect(purgeOldListings('2026-06-01T00:00:00Z', db)).toBe(1);
    expect(queryListings({ includeGone: true }, db).total).toBe(0);
    expect(observationsFor(scored.parsed.productKey!, '2020-01-01T00:00:00Z', db)).toHaveLength(1);
  });
});

describe('watches', () => {
  it('round-trips a watch', () => {
    const watch = createWatch(
      {
        name: 'Prismatic ETBs',
        query: 'prismatic evolutions elite trainer box',
        sources: ['demo'],
        category: 'pokemon',
        productType: null,
        minPriceCents: null,
        maxPriceCents: 20000,
        minDiscountPct: 0.15,
        sealedOnly: true,
        gradedOnly: false,
        excludeLots: true,
        enabled: true,
        intervalMinutes: 30,
      },
      db,
    );
    expect(watch.id).toBeGreaterThan(0);
    expect(watch.sources).toEqual(['demo']);
    expect(watch.sealedOnly).toBe(true);
    expect(watch.maxPriceCents).toBe(20000);
  });
});
