import { describe, expect, it } from 'vitest';
import { applyBrackets, combinedMarginalRate, incomeTax } from '../tax/incomeTax.js';
import { FIGURES_2026 } from '../tax/years/2026.js';

const year = FIGURES_2026;
const tables = year.brackets!;

describe('the 2026 rate schedules', () => {
  // Every schedule in Rev. Proc. 2025-32 states the cumulative tax at each
  // breakpoint. Recomputing it from the slices is the check that the
  // transcription is right — a single mistyped digit shows up here.
  const cumulative: Array<[string, Array<[number, number]>]> = [
    ['single', [[1240000, 124000], [5040000, 580000], [10570000, 1796600], [20177500, 4102400], [25622500, 5844800], [64060000, 19297925]]],
    ['married-joint', [[2480000, 248000], [10080000, 1160000], [21140000, 3593200], [40355000, 8204800], [51245000, 11689600], [76870000, 20658350]]],
    ['head-of-household', [[1770000, 177000], [6745000, 774000], [10570000, 1615500], [20175000, 3920700], [25620000, 5663100], [64060000, 19117100]]],
    ['married-separate', [[1240000, 124000], [5040000, 580000], [10570000, 1796600], [20177500, 4102400], [25622500, 5844800], [38435000, 10329175]]],
  ];

  for (const [status, points] of cumulative) {
    it(`matches the stated cumulative tax at every breakpoint — ${status}`, () => {
      const brackets = tables.byStatus[status as keyof typeof tables.byStatus];
      for (const [income, expected] of points) {
        expect(applyBrackets(income, brackets).taxCents).toBe(expected);
      }
    });
  }

  it('does not treat married-separate as single', () => {
    // They share the first five breakpoints, so only the top one distinguishes
    // them — and getting it wrong understates a high earner's tax badly.
    const single = tables.byStatus.single.at(-1)!;
    const separate = tables.byStatus['married-separate'].at(-1)!;
    expect(single.fromCents).toBe(64060000);
    expect(separate.fromCents).toBe(38435000);
  });

  it('leaves no gaps or overlaps in any schedule', () => {
    for (const brackets of Object.values(tables.byStatus)) {
      expect(brackets[0]!.fromCents).toBe(0);
      for (let i = 1; i < brackets.length; i += 1) {
        expect(brackets[i]!.fromCents).toBe(brackets[i - 1]!.toCents);
      }
      expect(brackets.at(-1)!.toCents).toBeNull();
    }
  });
});

describe('federal income tax', () => {
  it('charges nothing when the standard deduction covers everything', () => {
    const r = incomeTax({ businessProfitCents: 1000000, filingStatus: 'single' }, year);
    expect(r.taxableIncomeCents).toBe(0);
    expect(r.totalTaxCents).toBe(0);
    // The next dollar is genuinely free, not taxed at 10%.
    expect(r.marginalRate).toBe(0);
  });

  it('stacks business profit on top of wages, not beside them', () => {
    // $90,000 of wages already reaches the 22% bracket, so the first dollar of
    // card profit is taxed at 22% — not at 10%.
    const withWages = incomeTax(
      { businessProfitCents: 500000, otherIncomeCents: 9000000, filingStatus: 'single' },
      year,
    );
    const alone = incomeTax({ businessProfitCents: 500000, filingStatus: 'single' }, year);

    expect(withWages.marginalRate).toBeGreaterThan(0.15);
    expect(alone.marginalRate).toBe(0);
    expect(withWages.totalTaxCents).toBeGreaterThan(alone.totalTaxCents);
  });

  it('takes the section 199A deduction off qualified business income', () => {
    const withQbi = incomeTax(
      { businessProfitCents: 5000000, otherIncomeCents: 0, filingStatus: 'single' },
      year,
    );
    const without = incomeTax(
      { businessProfitCents: 5000000, otherIncomeCents: 0, filingStatus: 'single', claimQbi: false },
      year,
    );
    expect(withQbi.qbiDeductionCents).toBeGreaterThan(0);
    expect(without.qbiDeductionCents).toBe(0);
    expect(withQbi.totalTaxCents).toBeLessThan(without.totalTaxCents);
    // The deduction is the LESSER of 20% of qualified business income and 20%
    // of taxable income. Here $50,000 of profit less the $16,100 standard
    // deduction leaves $33,900, so the taxable-income limit binds at $6,780
    // rather than the $10,000 the profit alone would give.
    expect(withQbi.qbiDeductionCents).toBe(678000);
    expect(withQbi.qbiDeductionCents).toBeLessThan(1000000);
  });

  it('subtracts half of self-employment tax before computing anything', () => {
    const withDeduction = incomeTax(
      { businessProfitCents: 5000000, selfEmploymentDeductionCents: 353000, filingStatus: 'single' },
      year,
    );
    const without = incomeTax({ businessProfitCents: 5000000, filingStatus: 'single' }, year);
    expect(withDeduction.taxableIncomeCents).toBeLessThan(without.taxableIncomeCents);
  });

  it('caps collectibles gain at 28% but never charges more than the ordinary rate', () => {
    // A big gain on top of a high income hits the cap.
    const high = incomeTax(
      { businessProfitCents: 0, otherIncomeCents: 30000000, collectiblesGainCents: 1000000, filingStatus: 'single' },
      year,
    );
    expect(high.collectiblesTaxCents).toBe(280000);

    // The same gain with no other income is taxed at the ordinary rate it
    // reaches, which is far below 28%.
    const low = incomeTax(
      { businessProfitCents: 0, collectiblesGainCents: 1000000, filingStatus: 'single' },
      year,
    );
    expect(low.collectiblesTaxCents).toBeLessThan(280000);
  });

  it('uses each filing status\'s own schedule', () => {
    const input = { businessProfitCents: 0, otherIncomeCents: 12000000, filingStatus: 'single' } as const;
    const single = incomeTax(input, year);
    const joint = incomeTax({ ...input, filingStatus: 'married-joint' }, year);
    const hoh = incomeTax({ ...input, filingStatus: 'head-of-household' }, year);
    // Joint is the most favourable at this income; single the least.
    expect(joint.totalTaxCents).toBeLessThan(hoh.totalTaxCents);
    expect(hoh.totalTaxCents).toBeLessThan(single.totalTaxCents);
  });

  it('reports an effective rate below the marginal rate', () => {
    const r = incomeTax({ businessProfitCents: 0, otherIncomeCents: 15000000, filingStatus: 'single' }, year);
    expect(r.effectiveRate).toBeLessThan(r.marginalRate);
    expect(r.effectiveRate).toBeGreaterThan(0);
  });

  it('names what it does not model instead of implying completeness', () => {
    const r = incomeTax({ businessProfitCents: 5000000, filingStatus: 'single' }, year);
    expect(r.limitations.join(' ')).toMatch(/standard deduction/i);
    expect(r.limitations.join(' ')).toMatch(/no credits at all/i);
  });

  it('combines with self-employment tax for the real cost of the next dollar', () => {
    const r = incomeTax(
      { businessProfitCents: 500000, otherIncomeCents: 9000000, filingStatus: 'single' },
      year,
    );
    const combined = combinedMarginalRate(r);
    // Higher than income tax alone, but lower than naively adding 15.3%,
    // because half of SE tax is itself deductible.
    expect(combined).toBeGreaterThan(r.marginalRate);
    expect(combined).toBeLessThan(r.marginalRate + 0.153);
  });

  it('refuses to compute for a year with no rate schedules', () => {
    const bare = { ...year, brackets: null };
    expect(() => incomeTax({ businessProfitCents: 100000, filingStatus: 'single' }, bare)).toThrow(
      /no rate schedules/i,
    );
  });
});
