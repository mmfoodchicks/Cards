import { describe, expect, it } from 'vitest';
import { allocate, allocateEvenly, applyRate, dollarsToCents, formatMoney, sum } from '../domain/money.js';

describe('money conversion', () => {
  it('converts dollars to cents without float drift', () => {
    expect(dollarsToCents(161.64)).toBe(16164);
    expect(dollarsToCents(0.1) + dollarsToCents(0.2)).toBe(dollarsToCents(0.3));
    expect(dollarsToCents('$1,234.56')).toBe(123456);
  });

  it('rounds half away from zero, symmetrically', () => {
    // 1.005 cannot be represented exactly in binary floating point, so
    // multiplying by 100 gives 100.49999999999999 and rounds DOWN. Reading the
    // decimal digits instead gives the answer the user expects from a receipt.
    expect(dollarsToCents(1.005)).toBe(101);
    expect(dollarsToCents(-1.005)).toBe(-101);
    expect(dollarsToCents('1.005')).toBe(101);
    expect(dollarsToCents('1.0049')).toBe(100);
  });

  it('parses the shapes a person actually types', () => {
    expect(dollarsToCents('12')).toBe(1200);
    expect(dollarsToCents('12.5')).toBe(1250);
    expect(dollarsToCents('.99')).toBe(99);
    expect(dollarsToCents('-$1,000.00')).toBe(-100000);
    expect(dollarsToCents(0)).toBe(0);
  });

  it('rejects input it cannot read rather than guessing', () => {
    expect(() => dollarsToCents('abc')).toThrow(TypeError);
    expect(() => dollarsToCents('')).toThrow(TypeError);
    expect(() => dollarsToCents(Number.NaN)).toThrow(TypeError);
  });

  it('formats for display', () => {
    expect(formatMoney(16164)).toBe('$161.64');
    expect(formatMoney(-500)).toBe('-$5.00');
    expect(formatMoney(null)).toBe('—');
  });
});

describe('allocation', () => {
  it('splits a total so the parts sum exactly to it', () => {
    // The case that motivated this: a booster box opened into cards.
    const parts = allocateEvenly(16164, 360);
    expect(sum(parts)).toBe(16164);
    expect(new Set(parts).size).toBeLessThanOrEqual(2);
  });

  it('never loses or invents a cent, for any total and any split', () => {
    for (const total of [1, 7, 100, 16164, 259999, 3, 999999]) {
      for (const parts of [1, 2, 3, 7, 36, 360, 401]) {
        expect(sum(allocateEvenly(total, parts)), `${total} over ${parts}`).toBe(total);
      }
    }
  });

  it('allocates by relative value', () => {
    // A $100 lot of three cards worth $60, $30 and $10 at market.
    const parts = allocate(10000, [60, 30, 10]);
    expect(parts).toEqual([6000, 3000, 1000]);
    expect(sum(parts)).toBe(10000);
  });

  it('hands leftover cents to the parts rounded down hardest', () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(sum(parts)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });

  it('gives zero-weight items zero basis', () => {
    const parts = allocate(10000, [1, 0, 1]);
    expect(parts[1]).toBe(0);
    expect(sum(parts)).toBe(10000);
  });

  it('spreads evenly rather than dropping money when every weight is zero', () => {
    // A box where nothing has a recorded market value still has to have its
    // cost accounted for somewhere.
    const parts = allocate(9999, [0, 0, 0]);
    expect(sum(parts)).toBe(9999);
  });

  it('handles negative totals, for refunds and returns', () => {
    const parts = allocate(-10000, [60, 30, 10]);
    expect(sum(parts)).toBe(-10000);
    expect(parts.every((p) => p <= 0)).toBe(true);
  });

  it('rejects nonsense weights instead of guessing', () => {
    expect(() => allocate(100, [1, -1])).toThrow(RangeError);
    expect(() => allocate(100, [1, Number.NaN])).toThrow(RangeError);
  });
});

describe('rates', () => {
  it('applies a rate and rounds to whole cents', () => {
    // Utah state income tax on $10,000 of net profit.
    expect(applyRate(1000000, 0.0455)).toBe(45500);
    expect(applyRate(333, 0.5)).toBe(167);
  });
});
