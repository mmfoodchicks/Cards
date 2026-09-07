import { describe, expect, it } from 'vitest';
import { startupCosts, type StartupExpense } from '../tax/startupCosts.js';

let nextId = 1;
const exp = (over: Partial<StartupExpense> = {}): StartupExpense => ({
  id: nextId++,
  incurredOn: '2026-02-01',
  accountKey: 'startup',
  description: 'scouting a show',
  amountCents: 50000,
  ...over,
});

describe('start-up costs', () => {
  it('says nothing until a start date is known', () => {
    expect(startupCosts([exp()], null, 2026)).toBeNull();
  });

  it('deducts the whole thing when it is under the ceiling', () => {
    const r = startupCosts([exp({ amountCents: 280000 })], '2026-05-15', 2026)!;
    expect(r.qualifyingCents).toBe(280000);
    expect(r.immediateDeductionCents).toBe(280000);
    expect(r.amortisableCents).toBe(0);
    expect(r.firstYearDeductionCents).toBe(280000);
    expect(r.explanation.join(' ')).toMatch(/nothing is spread over 180 months/i);
  });

  it('splits at the $5,000 ceiling and amortises from the starting month', () => {
    // $12,000 of costs, trading from 15 May: $5,000 now, $7,000 over 180
    // months, and only 8 of those months fall in the first year.
    const r = startupCosts([exp({ amountCents: 1200000 })], '2026-05-15', 2026)!;
    expect(r.immediateDeductionCents).toBe(500000);
    expect(r.amortisableCents).toBe(700000);
    expect(r.monthsAmortisedThisYear).toBe(8);
    expect(r.amortisationThisYearCents).toBe(31111);
    expect(r.firstYearDeductionCents).toBe(531111);
  });

  it('phases the immediate deduction out dollar for dollar above $50,000', () => {
    // $52,000 of costs: the $5,000 is cut by the $2,000 excess.
    const r = startupCosts([exp({ incurredOn: '2025-11-01', amountCents: 5200000 })], '2026-01-01', 2026)!;
    expect(r.immediateDeductionCents).toBe(300000);
    expect(r.amortisableCents).toBe(4900000);
    expect(r.phasedOut).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/dollar for dollar/i);
  });

  it('gives no immediate deduction at all once costs reach $55,000', () => {
    const r = startupCosts([exp({ incurredOn: '2025-11-01', amountCents: 5500000 })], '2026-01-01', 2026)!;
    expect(r.immediateDeductionCents).toBe(0);
    expect(r.amortisableCents).toBe(5500000);
  });

  it('ignores anything incurred on or after the day trading begins', () => {
    const r = startupCosts(
      [
        exp({ incurredOn: '2026-05-14', amountCents: 10000 }),
        exp({ incurredOn: '2026-05-15', amountCents: 90000 }),
        exp({ incurredOn: '2026-08-01', amountCents: 90000 }),
      ],
      '2026-05-15',
      2026,
    )!;
    // Only the 14th qualifies; the 15th is the first day of trading.
    expect(r.qualifyingCents).toBe(10000);
  });

  it('never treats inventory as a start-up cost', () => {
    // The most common section 195 error in this trade.
    const r = startupCosts(
      [
        exp({ accountKey: 'inventory-purchases', amountCents: 800000 }),
        exp({ accountKey: 'startup', amountCents: 40000 }),
      ],
      '2026-05-15',
      2026,
    )!;
    expect(r.qualifyingCents).toBe(40000);
    expect(r.excludedCents).toBe(800000);
    expect(r.explanation.join(' ')).toMatch(/cards bought before opening are NOT start-up costs/i);
  });

  it('excludes equipment, which is depreciated instead', () => {
    const r = startupCosts(
      [exp({ accountKey: 'equipment', amountCents: 120000 }), exp({ amountCents: 30000 })],
      '2026-05-15',
      2026,
    )!;
    expect(r.qualifyingCents).toBe(30000);
    expect(r.warnings.join(' ')).toMatch(/placed in service/i);
  });

  it('keeps amortising in later years, a full twelve months at a time', () => {
    const r = startupCosts([exp({ amountCents: 1200000 })], '2026-05-15', 2027)!;
    // No second bite at the immediate deduction.
    expect(r.firstYearDeductionCents).toBe(r.amortisationThisYearCents);
    expect(r.monthsAmortisedThisYear).toBe(12);
    expect(r.amortisationThisYearCents).toBe(46667);
  });

  it('stops after 180 months', () => {
    const r = startupCosts([exp({ amountCents: 1200000 })], '2026-05-15', 2100)!;
    expect(r.monthsAmortisedThisYear).toBe(0);
    expect(r.amortisationThisYearCents).toBe(0);
  });

  it('prompts for the costs people forget when none are recorded', () => {
    const r = startupCosts([], '2026-05-15', 2026)!;
    expect(r.qualifyingCents).toBe(0);
    expect(r.explanation.join(' ')).toMatch(/routinely missed/i);
  });
});
