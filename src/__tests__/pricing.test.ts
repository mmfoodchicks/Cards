import { describe, expect, it } from 'vitest';
import {
  MAD_SIGMA,
  mad,
  median,
  quantile,
  rejectOutliers,
  relativeDispersion,
  timeDecayWeight,
  weightedQuantile,
} from '../pricing/stats.js';
import { computeBaseline } from '../pricing/baseline.js';
import { computeLandedCost } from '../pricing/landedCost.js';
import { MARKET_THRESHOLDS, MSRP_THRESHOLDS, labelFor, scoreListing } from '../pricing/score.js';
import { parseTitle } from '../parse/titleParser.js';
import type { PriceObservation } from '../types.js';

describe('statistics', () => {
  it('computes medians for odd and even samples', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it('interpolates quantiles', () => {
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(quantile([10, 20, 30, 40], 0)).toBe(10);
    expect(quantile([10, 20, 30, 40], 1)).toBe(40);
  });

  it('scales MAD to be comparable with a standard deviation', () => {
    // Deviations are all 10, so MAD before scaling is 10.
    expect(mad([90, 100, 110])).toBeCloseTo(10 * MAD_SIGMA, 6);
  });

  it('weights recent observations more heavily', () => {
    const cheapButOld = { value: 100, weight: 0.01 };
    const expensiveAndFresh = [
      { value: 300, weight: 1 },
      { value: 320, weight: 1 },
      { value: 310, weight: 1 },
    ];
    const q = weightedQuantile([cheapButOld, ...expensiveAndFresh], 0.5);
    expect(q).toBeGreaterThan(290);
  });

  it('rejects outliers symmetrically in log space', () => {
    const values = [100, 102, 98, 101, 99, 103, 5000, 2];
    const { kept, rejected } = rejectOutliers(values, (v) => v);
    expect(rejected).toContain(5000);
    expect(rejected).toContain(2);
    expect(kept).toContain(100);
  });

  it('leaves small samples alone rather than guessing', () => {
    const { kept, rejected } = rejectOutliers([10, 20, 999], (v) => v);
    expect(rejected).toHaveLength(0);
    expect(kept).toHaveLength(3);
  });

  it('survives a sample with no spread', () => {
    const { rejected } = rejectOutliers([50, 50, 50, 50, 50], (v) => v);
    expect(rejected).toHaveLength(0);
  });

  it('halves weight at the half-life', () => {
    expect(timeDecayWeight(14, 14)).toBeCloseTo(0.5, 6);
    expect(timeDecayWeight(0, 14)).toBe(1);
  });

  it('reports dispersion scale-free', () => {
    const cheap = relativeDispersion([90, 100, 110]);
    const pricey = relativeDispersion([9000, 10000, 11000]);
    expect(cheap).toBeCloseTo(pricey, 6);
  });
});

describe('landed cost', () => {
  const base = { taxRate: 0, assumedShippingCents: 0 };

  it('adds shipping', () => {
    const c = computeLandedCost({ priceCents: 4000, shippingCents: 1800, quantity: 1, ...base });
    expect(c.landedCents).toBe(5800);
  });

  it('divides by quantity so lots compare against single units', () => {
    const c = computeLandedCost({ priceCents: 18000, shippingCents: 0, quantity: 6, ...base });
    expect(c.unitCents).toBe(3000);
  });

  it('applies estimated tax to price and shipping together', () => {
    const c = computeLandedCost({ priceCents: 10000, shippingCents: 1000, quantity: 1, taxRate: 0.07, assumedShippingCents: 0 });
    expect(c.landedCents).toBe(11770);
  });

  it('says so when shipping is undisclosed rather than assuming free', () => {
    const c = computeLandedCost({ priceCents: 5000, shippingCents: null, quantity: 1, ...base });
    expect(c.shippingKnown).toBe(false);
    expect(c.notes.join(' ')).toMatch(/not disclosed/i);
  });
});

describe('baselines', () => {
  const now = new Date('2026-08-25T00:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  function ask(unitCents: number, days = 1, sellerId: string | null = null): PriceObservation {
    return { productKey: 'k', observedAt: ago(days), unitCents, kind: 'ask', source: 'test', listingId: `l${unitCents}-${days}-${sellerId ?? ''}`, sellerId };
  }

  it('refuses to price from too few observations', () => {
    expect(computeBaseline({ productKey: 'k', observations: [ask(100), ask(110)], now })).toBeNull();
  });

  it('estimates market value from the low end of asking prices', () => {
    // Asks are biased above what things actually sell for, so the estimate
    // must sit below the middle of the ask distribution.
    const asks = [100, 110, 120, 130, 200, 300, 400].map((v) => ask(v * 100));
    const baseline = computeBaseline({ productKey: 'k', observations: asks, now })!;
    expect(baseline.kind).toBe('ask-derived');
    expect(baseline.valueCents).toBeLessThan(median(asks.map((a) => a.unitCents)));
  });

  it('prefers reported sales over asking prices', () => {
    const observations: PriceObservation[] = [
      ...[100, 110, 120, 130, 140, 150].map((v) => ask(v * 100)),
      { productKey: 'k', observedAt: ago(2), unitCents: 8000, kind: 'sold', source: 't', listingId: 's1' },
      { productKey: 'k', observedAt: ago(3), unitCents: 8200, kind: 'sold', source: 't', listingId: 's2' },
      { productKey: 'k', observedAt: ago(4), unitCents: 7900, kind: 'sold', source: 't', listingId: 's3' },
    ];
    const baseline = computeBaseline({ productKey: 'k', observations, now })!;
    expect(baseline.kind).toBe('sold-comp');
    expect(baseline.valueCents).toBeCloseTo(8000, -2);
  });

  it('stops one seller from defining the market', () => {
    // One shop lists twelve copies at $500 while seven independent sellers sit
    // near $100. Uncapped, the shop is the majority of the sample and drags
    // the "market value" up with it.
    const flood = Array.from({ length: 12 }, (_, i) => ask(50000, i + 1, 'bulkseller'));
    const independent = [9900, 10000, 10100, 10200, 10300, 9800, 10050].map((v, i) =>
      ask(v, i + 1, `seller${i}`),
    );

    const capped = computeBaseline({ productKey: 'k', observations: [...flood, ...independent], now })!;
    expect(capped.valueCents).toBeLessThan(20000);

    // Without the cap the same data produces a materially higher number.
    const uncapped = computeBaseline({
      productKey: 'k',
      observations: [...flood, ...independent],
      now,
      options: { maxPerSeller: 1000 },
    })!;
    expect(uncapped.valueCents).toBeGreaterThan(capped.valueCents);
  });

  it('returns nothing rather than a baseline built on too little evidence', () => {
    // After capping one seller's flood and rejecting it as an outlier, too few
    // independent observations remain to say anything. Silence beats a guess.
    const flood = Array.from({ length: 9 }, (_, i) => ask(50000, i + 1, 'bulkseller'));
    const few = [ask(10000, 1, 'a'), ask(10100, 2, 'b'), ask(9900, 3, 'c'), ask(10200, 4, 'd')];
    expect(computeBaseline({ productKey: 'k', observations: [...flood, ...few], now })).toBeNull();
  });

  it('ignores observations outside the window', () => {
    const stale = [100, 110, 120, 130, 140, 150].map((v) => ask(v * 100, 400));
    expect(computeBaseline({ productKey: 'k', observations: stale, now })).toBeNull();
  });
});

describe('deal labels', () => {
  it('places MSRP discounts on the tighter ladder', () => {
    expect(labelFor(0.7, MSRP_THRESHOLDS)).toBe('suspicious');
    expect(labelFor(0.4, MSRP_THRESHOLDS)).toBe('steal');
    expect(labelFor(0.25, MSRP_THRESHOLDS)).toBe('great-deal');
    expect(labelFor(0.1, MSRP_THRESHOLDS)).toBe('good-deal');
    expect(labelFor(0.0, MSRP_THRESHOLDS)).toBe('fair');
    expect(labelFor(-0.5, MSRP_THRESHOLDS)).toBe('above-market');
  });

  it('is looser about market-derived discounts', () => {
    // 9% under a published MSRP is a real discount; 9% under an estimated
    // market value is inside the noise.
    expect(labelFor(0.09, MSRP_THRESHOLDS)).toBe('good-deal');
    expect(labelFor(0.09, MARKET_THRESHOLDS)).toBe('fair');
  });
});

describe('scoring', () => {
  const now = new Date('2026-08-25T12:00:00Z');
  const sealed = parseTitle('2025 Bowman Baseball Hobby Box Factory Sealed');
  const msrp = { kind: 'msrp' as const, valueCents: 23999, confidence: 0.95 };

  function score(overrides: Partial<Parameters<typeof scoreListing>[0]> = {}) {
    return scoreListing({
      parsed: sealed,
      unitCents: 20000,
      benchmark: msrp,
      listingType: 'fixed',
      bidCount: null,
      endsAt: null,
      shippingKnown: true,
      now,
      ...overrides,
    });
  }

  it('flags a sealed listing below MSRP', () => {
    const result = score();
    expect(result.underMsrp).toBe(true);
    expect(result.discountPct).toBeGreaterThan(0);
  });

  it('does not claim under-MSRP when the price is above it', () => {
    expect(score({ unitCents: 30000 }).underMsrp).toBe(false);
  });

  it('treats an absurd discount as suspicious rather than a find', () => {
    const result = score({ unitCents: 2000 });
    expect(result.label).toBe('suspicious');
    expect(result.underMsrp).toBe(false);
    expect(result.score).toBe(0);
  });

  it('rejects listings whose text says they are not the product', () => {
    const empty = parseTitle('2025 Bowman Hobby Box EMPTY BOX ONLY no cards');
    const result = score({ parsed: empty, unitCents: 1000 });
    expect(result.label).toBe('suspicious');
    expect(result.confidence).toBe(0);
  });

  it('will not score an auction that nobody has bid up yet', () => {
    const result = score({
      unitCents: 100,
      listingType: 'auction',
      bidCount: 0,
      endsAt: new Date(now.getTime() + 5 * 86_400_000).toISOString(),
    });
    expect(result.label).toBe('unscored');
    expect(result.notes.join(' ')).toMatch(/will move before it closes/i);
  });

  it('scores an auction once it is about to close', () => {
    const result = score({
      unitCents: 18000,
      listingType: 'auction',
      bidCount: 12,
      endsAt: new Date(now.getTime() + 2 * 3_600_000).toISOString(),
    });
    expect(result.label).not.toBe('unscored');
  });

  it('will not score a lot with no per-unit price', () => {
    const lot = parseTitle('Huge mixed lot Bowman baseball assorted');
    expect(score({ parsed: lot }).label).toBe('unscored');
  });

  it('says why it could not score something', () => {
    const result = score({ benchmark: null });
    expect(result.label).toBe('unscored');
    expect(result.notes[0]).toMatch(/no msrp or market comps/i);
  });

  it('ranks a bigger absolute saving above an equal percentage on a cheap item', () => {
    const cheap = score({ unitCents: 100, benchmark: { kind: 'msrp', valueCents: 125, confidence: 0.9 } });
    const pricey = score({ unitCents: 40000, benchmark: { kind: 'msrp', valueCents: 50000, confidence: 0.9 } });
    expect(pricey.score).toBeGreaterThan(cheap.score);
  });

  it('discounts confidence when shipping is unknown', () => {
    expect(score({ shippingKnown: false }).confidence).toBeLessThan(score().confidence);
  });

  it('discounts confidence for a seller with almost no feedback', () => {
    expect(score({ sellerFeedbackCount: 2, sellerFeedbackPct: 90 }).confidence).toBeLessThan(score().confidence);
  });
});
