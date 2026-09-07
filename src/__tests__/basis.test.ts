import { describe, expect, it } from 'vitest';
import { AllocationError, allocateBasis, allocateGradingCost, allocateOpening, lotTotalCents } from '../ledger/basis.js';
import { sum } from '../domain/money.js';

describe('lot cost', () => {
  it('includes shipping, tax and fees in what the goods cost', () => {
    // Inbound shipping is part of the cost of inventory, not a separate
    // expense. Deducting it now instead would overstate this year's costs.
    expect(lotTotalCents({ subtotalCents: 16164, shippingCents: 895, taxCents: 0, feesCents: 0 })).toBe(17059);
  });
});

describe('relative fair market value allocation', () => {
  it('gives the chase card the basis and the commons almost none', () => {
    // A $161.64 box opened into one big hit and three near-worthless cards.
    const result = allocateBasis({
      totalCents: 16164,
      method: 'relative-fmv',
      items: [
        { ref: 'charizard', estimatedValueCents: 260000 },
        { ref: 'common-a', estimatedValueCents: 100 },
        { ref: 'common-b', estimatedValueCents: 100 },
        { ref: 'common-c', estimatedValueCents: 100 },
      ],
    });

    const byRef = Object.fromEntries(result.results.map((r) => [r.ref, r.basisCents]));
    expect(byRef.charizard).toBeGreaterThan(16000);
    expect(byRef['common-a']).toBeLessThan(20);
    expect(sum(result.results.map((r) => r.basisCents))).toBe(16164);
  });

  it('always foots to the total, however lopsided the values', () => {
    const items = Array.from({ length: 360 }, (_, i) => ({
      ref: i,
      estimatedValueCents: i === 0 ? 260000 : 1,
    }));
    const result = allocateBasis({ totalCents: 16164, method: 'relative-fmv', items });
    expect(sum(result.results.map((r) => r.basisCents))).toBe(16164);
  });

  it('warns that valueless items become pure profit when they sell', () => {
    const result = allocateBasis({
      totalCents: 10000,
      method: 'relative-fmv',
      items: [
        { ref: 'a', estimatedValueCents: 10000 },
        { ref: 'b', estimatedValueCents: null },
      ],
    });
    expect(result.results.find((r) => r.ref === 'b')!.basisCents).toBe(0);
    expect(result.notes.join(' ')).toMatch(/entirely taxable profit/i);
  });

  it('falls back to an even split when nothing has a value, and says so', () => {
    const result = allocateBasis({
      totalCents: 9999,
      method: 'relative-fmv',
      items: [{ ref: 'a', estimatedValueCents: null }, { ref: 'b', estimatedValueCents: null }],
    });
    expect(sum(result.results.map((r) => r.basisCents))).toBe(9999);
    expect(result.notes.join(' ')).toMatch(/split evenly/i);
  });
});

describe('equal allocation', () => {
  it('splits by quantity for homogeneous goods', () => {
    // 1,000 penny sleeves bought for $12.
    const result = allocateBasis({
      totalCents: 1200,
      method: 'equal',
      items: [{ ref: 'sleeves', estimatedValueCents: null, quantity: 1000 }],
    });
    expect(result.results[0]!.basisCents).toBe(1200);
  });
});

describe('manual allocation', () => {
  it('accepts figures that tie to the purchase', () => {
    const result = allocateBasis({
      totalCents: 10000,
      method: 'manual',
      items: [
        { ref: 'a', estimatedValueCents: null, manualBasisCents: 7500 },
        { ref: 'b', estimatedValueCents: null, manualBasisCents: 2500 },
      ],
    });
    expect(sum(result.results.map((r) => r.basisCents))).toBe(10000);
  });

  it('refuses figures that do not tie, rather than silently absorbing the difference', () => {
    expect(() =>
      allocateBasis({
        totalCents: 10000,
        method: 'manual',
        items: [
          { ref: 'a', estimatedValueCents: null, manualBasisCents: 7500 },
          { ref: 'b', estimatedValueCents: null, manualBasisCents: 2000 },
        ],
      }),
    ).toThrow(AllocationError);
  });
});

describe('opening sealed product', () => {
  it('moves the whole basis to the contents so nothing is created or lost', () => {
    const result = allocateOpening(17059, [
      { ref: 'hit', estimatedValueCents: 50000 },
      { ref: 'bulk', estimatedValueCents: 500 },
    ]);
    expect(sum(result.results.map((r) => r.basisCents))).toBe(17059);
    expect(result.notes[0]).toMatch(/entire cost basis was moved/i);
  });

  it('refuses to open a box with no recorded contents', () => {
    // Otherwise the box's cost would simply disappear from the books.
    expect(() => allocateOpening(17059, [])).toThrow(AllocationError);
  });
});

describe('grading costs', () => {
  it('adds fees, shipping and insurance to the cards, split per card', () => {
    const result = allocateGradingCost({
      submission: { feeCents: 15000, shippingToCents: 2000, shippingBackCents: 2500, insuranceCents: 1500 },
      items: [
        { ref: 1, estimatedValueCents: 260000 },
        { ref: 2, estimatedValueCents: 5000 },
      ],
    });
    expect(sum(result.results.map((r) => r.basisCents))).toBe(21000);
    expect(result.results[0]!.basisCents).toBe(10500);
    expect(result.notes.join(' ')).toMatch(/added to the cost basis/i);
  });

  it('can allocate by value when one card drove the cost', () => {
    const result = allocateGradingCost({
      submission: { feeCents: 20000, shippingToCents: 0, shippingBackCents: 0, insuranceCents: 0 },
      items: [
        { ref: 1, estimatedValueCents: 260000 },
        { ref: 2, estimatedValueCents: 1000 },
      ],
      method: 'relative-fmv',
    });
    expect(result.results[0]!.basisCents).toBeGreaterThan(result.results[1]!.basisCents * 100);
    expect(sum(result.results.map((r) => r.basisCents))).toBe(20000);
  });
});


/**
 * The safety property a price-comps feature rests on.
 *
 * An estimated market value is a WEIGHT in relative-FMV allocation, never an
 * amount. If that ever stopped being true, pulling sold comps into the app
 * would start inflating cost basis with market value — which is both wrong and
 * exactly the mistake the feature is meant to prevent. These lock it down.
 */
describe('market value can never become cost', () => {
  const items = [
    { ref: 'hit', estimatedValueCents: 200000 },
    { ref: 'mid', estimatedValueCents: 5000 },
    { ref: 'common', estimatedValueCents: 1000 },
  ];
  const basisOf = (r: ReturnType<typeof allocateBasis>) => r.results.map((x) => x.basisCents);

  it('allocates the same way whatever scale the values are on', () => {
    const base = basisOf(allocateBasis({ totalCents: 16164, method: 'relative-fmv', items }));
    expect(sum(base)).toBe(16164);

    // The same relative values, expressed larger and smaller. A comps lookup
    // that revises every estimate must not move basis at all.
    for (const factor of [10, 0.1, 1000]) {
      const scaled = basisOf(allocateBasis({
        totalCents: 16164,
        method: 'relative-fmv',
        items: items.map((i) => ({ ...i, estimatedValueCents: Math.round(i.estimatedValueCents * factor) })),
      }));
      expect(scaled, `scaling values by ${factor} changed the allocation`).toEqual(base);
    }
  });

  it('never allocates more than was actually paid, however valuable the cards', () => {
    // A $161.64 box holding a card the market says is worth $2,600 still has
    // $161.64 of cost in it. Nothing else.
    const result = allocateBasis({
      totalCents: 16164,
      method: 'relative-fmv',
      items: [
        { ref: 'chase', estimatedValueCents: 260000 },
        { ref: 'common', estimatedValueCents: 100 },
      ],
    });
    expect(sum(basisOf(result))).toBe(16164);
    expect(Math.max(...basisOf(result))).toBeLessThan(16164);
  });

  it('is unaffected by a value revised after the fact', () => {
    // Buying at $50 and later learning the card books at $750 does not change
    // what the card cost.
    const before = allocateBasis({
      totalCents: 5000,
      method: 'relative-fmv',
      items: [{ ref: 'card', estimatedValueCents: 5000 }],
    });
    const after = allocateBasis({
      totalCents: 5000,
      method: 'relative-fmv',
      items: [{ ref: 'card', estimatedValueCents: 75000 }],
    });
    expect(basisOf(after)).toEqual(basisOf(before));
    expect(basisOf(after)[0]).toBe(5000);
  });
});
