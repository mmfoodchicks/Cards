import { describe, expect, it } from 'vitest';
import { selfEmploymentTax, setAsideGuidance } from '../tax/selfEmployment.js';
import { FIGURES_2026 } from '../tax/years/2026.js';
import { UnverifiedFigureError, valueOf } from '../tax/figures.js';

const year = FIGURES_2026;

describe('self-employment tax', () => {
  it('charges nothing below the $400 floor', () => {
    // $400 of net EARNINGS, so about $433 of profit, is the boundary.
    const result = selfEmploymentTax({ netProfitCents: 40000, filingStatus: 'single' }, year);
    expect(result.totalCents).toBe(0);
    expect(result.explanation.join(' ')).toMatch(/still reported/i);
  });

  it('computes the ordinary case', () => {
    // $20,000 profit -> $18,470 net earnings -> 15.3%.
    const result = selfEmploymentTax({ netProfitCents: 2000000, filingStatus: 'single' }, year);
    expect(result.netEarningsCents).toBe(1847000);
    expect(result.socialSecurityCents).toBe(229028);
    expect(result.medicareCents).toBe(53563);
    expect(result.totalCents).toBe(282591);
    // Half the regular tax is deductible.
    expect(result.deductionCents).toBe(141296);
  });

  it('is about 14.1% of profit, which is the number that surprises people', () => {
    const result = selfEmploymentTax({ netProfitCents: 1000000, filingStatus: 'single' }, year);
    expect(result.totalCents / 1000000).toBeCloseTo(0.1413, 3);
  });

  it('caps the Social Security portion at the wage base', () => {
    const result = selfEmploymentTax({ netProfitCents: 30000000, filingStatus: 'single' }, year);
    expect(result.wageBaseReached).toBe(true);
    // 12.4% of the full wage base.
    expect(result.socialSecurityCents).toBe(2287800);
    // Medicare keeps going on everything.
    expect(result.medicareCents).toBeGreaterThan(700000);
  });

  it('reduces the remaining wage base by W-2 wages already earned', () => {
    // A day job that already used most of the base.
    const result = selfEmploymentTax(
      { netProfitCents: 2000000, wagesCents: 18000000, filingStatus: 'single' },
      year,
    );
    expect(result.wageBaseRemainingCents).toBe(450000);
    expect(result.socialSecurityCents).toBe(55800);
    expect(result.explanation.join(' ')).toMatch(/already used part of the Social Security wage base/i);
  });

  it('charges the extra Medicare tax above the threshold, and excludes it from the deduction', () => {
    const result = selfEmploymentTax(
      { netProfitCents: 5000000, wagesCents: 19000000, filingStatus: 'single' },
      year,
    );
    expect(result.additionalMedicareCents).toBeGreaterThan(0);
    // The deduction is half of the REGULAR tax only.
    expect(result.deductionCents).toBe(Math.round((result.socialSecurityCents + result.medicareCents) / 2));
  });

  it('uses the married-filing-jointly threshold when that is the filing status', () => {
    const single = selfEmploymentTax({ netProfitCents: 5000000, wagesCents: 19000000, filingStatus: 'single' }, year);
    const joint = selfEmploymentTax({ netProfitCents: 5000000, wagesCents: 19000000, filingStatus: 'married-joint' }, year);
    expect(joint.additionalMedicareCents).toBeLessThan(single.additionalMedicareCents);
  });

  it('produces no tax and no credit from a loss', () => {
    const result = selfEmploymentTax({ netProfitCents: -500000, filingStatus: 'single' }, year);
    expect(result.totalCents).toBe(0);
    expect(result.deductionCents).toBe(0);
  });

  it('reports which figures behind the number are not fully verified', () => {
    const result = selfEmploymentTax({ netProfitCents: 2000000, filingStatus: 'single' }, year);
    // The wage base is indexed annually and was found via secondary reporting.
    expect(result.unverified.join(' ')).toMatch(/wage base/i);
  });
});

describe('unverified figures', () => {
  it('refuses to compute from a figure that was never confirmed', () => {
    // The alternative is a confident wrong answer on a tax return.
    const rate = FIGURES_2026.figures['vehicle.standardMileageRate']!;
    expect(rate.confidence).toBe('unverified');
    expect(() => valueOf(rate)).toThrow(UnverifiedFigureError);
    expect(() => valueOf(rate)).toThrow(/has not been verified/i);
  });
});

describe('set-aside guidance', () => {
  it('says roughly 14% before income tax is even considered', () => {
    expect(setAsideGuidance(null).seOnlyRate).toBeCloseTo(0.1413, 3);
  });

  it('adds income tax on top of that', () => {
    const guidance = setAsideGuidance(0.12);
    expect(guidance.suggestedRate!).toBeGreaterThan(0.2);
    expect(guidance.explanation).toMatch(/separate account/i);
  });
});
