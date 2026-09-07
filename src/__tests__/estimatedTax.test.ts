import { describe, expect, it } from 'vitest';
import {
  HIGH_INCOME_PRIOR_YEAR_AGI,
  estimatedPeriods,
  estimatedTaxPlan,
  nextBusinessDay,
  safeHarbor,
} from '../tax/estimatedTax.js';

describe('instalment periods', () => {
  it('gives the four 2026 due dates', () => {
    const periods = estimatedPeriods(2026);
    expect(periods.map((p) => p.dueOn)).toEqual([
      '2026-04-15',
      '2026-06-15',
      '2026-09-15',
      '2027-01-15',
    ]);
  });

  it('uses uneven periods, which is why the June payment feels early', () => {
    const [q1, q2] = estimatedPeriods(2026);
    expect(q1!.periodStart).toBe('2026-01-01');
    expect(q1!.periodEnd).toBe('2026-03-31');
    // Only two months, not three.
    expect(q2!.periodStart).toBe('2026-04-01');
    expect(q2!.periodEnd).toBe('2026-05-31');
  });

  it('shifts a weekend due date to the following Monday', () => {
    // 2027-04-15 is a Thursday; 2028-04-15 is a Saturday.
    expect(nextBusinessDay('2028-04-15')).toBe('2028-04-17');
    expect(nextBusinessDay('2026-04-15')).toBe('2026-04-15');
  });
});

describe('safe harbour', () => {
  it('takes the lower of the two tests', () => {
    const result = safeHarbor({
      projectedTaxCents: 1000000,
      priorYearTaxCents: 500000,
      priorYearAgiCents: 4000000,
      withholdingCents: 0,
    });
    // 90% of 10,000 is 9,000; 100% of last year is 5,000.
    expect(result.currentYearTestCents).toBe(900000);
    expect(result.priorYearTestCents).toBe(500000);
    expect(result.requiredCents).toBe(500000);
    expect(result.basis).toBe('prior-year');
  });

  it('requires 110% of the prior year when prior AGI was over $150,000', () => {
    const result = safeHarbor({
      projectedTaxCents: 100000000,
      priorYearTaxCents: 2000000,
      priorYearAgiCents: HIGH_INCOME_PRIOR_YEAR_AGI + 1,
      withholdingCents: 0,
    });
    expect(result.priorYearMultiplier).toBe(1.1);
    expect(result.priorYearTestCents).toBe(2200000);
    expect(result.explanation.join(' ')).toMatch(/over \$150,000/);
  });

  it('falls back to the 90% test alone in a first year', () => {
    const result = safeHarbor({
      projectedTaxCents: 800000,
      priorYearTaxCents: null,
      priorYearAgiCents: null,
      withholdingCents: 0,
    });
    expect(result.basis).toBe('current-year-only');
    expect(result.requiredCents).toBe(720000);
    expect(result.explanation.join(' ')).toMatch(/no prior-year return/i);
  });

  it('counts wage withholding toward the requirement', () => {
    const result = safeHarbor({
      projectedTaxCents: 1000000,
      priorYearTaxCents: null,
      priorYearAgiCents: null,
      withholdingCents: 400000,
    });
    expect(result.requiredCents).toBe(900000);
    expect(result.netRequiredCents).toBe(500000);
  });

  it('never asks for a negative payment when withholding already covers it', () => {
    const result = safeHarbor({
      projectedTaxCents: 100000,
      priorYearTaxCents: null,
      priorYearAgiCents: null,
      withholdingCents: 500000,
    });
    expect(result.netRequiredCents).toBe(0);
  });
});

describe('the plan', () => {
  const base = {
    year: 2026,
    projectedTaxCents: 400000,
    priorYearTaxCents: null,
    priorYearAgiCents: null,
    withholdingCents: 0,
  };

  it('spreads the requirement across the four instalments', () => {
    const plan = estimatedTaxPlan({ ...base, today: new Date('2026-01-05T00:00:00Z') });
    expect(plan.safeHarbor.netRequiredCents).toBe(360000);
    expect(plan.quarters.map((q) => q.instalmentCents)).toEqual([90000, 90000, 90000, 90000]);
  });

  it('flags an instalment that is coming up', () => {
    // Eight days before the September date.
    const plan = estimatedTaxPlan({ ...base, today: new Date('2026-09-07T00:00:00Z') });
    const q3 = plan.quarters[2]!;
    expect(q3.status).toBe('due-soon');
    expect(q3.daysUntilDue).toBe(8);
    expect(plan.warnings.join(' ')).toMatch(/due on 2026-09-15, in 8 days/i);
  });

  it('flags instalments that were missed, and says paying late still helps', () => {
    const plan = estimatedTaxPlan({ ...base, today: new Date('2026-09-07T00:00:00Z') });
    const missed = plan.quarters.filter((q) => q.status === 'overdue');
    expect(missed).toHaveLength(2);
    expect(plan.warnings.join(' ')).toMatch(/stops it growing/i);
  });

  it('counts payments already made', () => {
    const plan = estimatedTaxPlan({
      ...base,
      paymentsByQuarter: { 1: 90000, 2: 90000 },
      today: new Date('2026-09-07T00:00:00Z'),
    });
    expect(plan.quarters[0]!.status).toBe('paid');
    expect(plan.quarters[1]!.status).toBe('paid');
    expect(plan.totalPaidCents).toBe(180000);
    expect(plan.remainingCents).toBe(180000);
  });

  it('treats a big early payment as covering later instalments too', () => {
    const plan = estimatedTaxPlan({
      ...base,
      paymentsByQuarter: { 1: 360000 },
      today: new Date('2026-09-07T00:00:00Z'),
    });
    expect(plan.quarters.every((q) => q.status === 'paid')).toBe(true);
    expect(plan.remainingCents).toBe(0);
  });
});
