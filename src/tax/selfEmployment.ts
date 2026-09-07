/**
 * Self-employment tax — Schedule SE.
 *
 * This is the number that surprises people who have only ever had a W-2. An
 * employee pays 7.65% of wages toward Social Security and Medicare and the
 * employer quietly pays the other half. A sole proprietor pays BOTH halves,
 * 15.3%, on top of income tax — so roughly the first fifteen cents of every
 * dollar of profit is spoken for before any income tax is calculated.
 *
 * The mechanics, in order:
 *
 *   1. Net earnings = net profit x 92.35%. The 7.65% haircut approximates the
 *      employer-side deduction an employee's employer would have taken.
 *   2. If net earnings are under $400, no self-employment tax at all.
 *   3. Social Security at 12.4%, but only up to the wage base — and W-2 wages
 *      already used up part of that base, so they reduce what is left.
 *   4. Medicare at 2.9% on everything, with no cap.
 *   5. An extra 0.9% Medicare on combined wages and self-employment income
 *      above a threshold that is NOT inflation-adjusted.
 *   6. Half of the regular self-employment tax is deductible against income
 *      tax. The additional Medicare tax is not.
 */

import { applyRate, type Cents } from '../domain/money.js';
import type { FilingStatus } from '../domain/types.js';
import { isUsable, valueOf, type TaxYearFigures } from './figures.js';

export interface SelfEmploymentInput {
  /** Schedule C line 31, net profit. */
  netProfitCents: Cents;
  /** W-2 wages already subject to Social Security this year. */
  wagesCents?: Cents;
  filingStatus: FilingStatus;
}

export interface SelfEmploymentResult {
  /** Net profit after the 92.35% multiplier. */
  netEarningsCents: Cents;
  socialSecurityCents: Cents;
  medicareCents: Cents;
  additionalMedicareCents: Cents;
  totalCents: Cents;
  /** Half the regular tax, deductible against income tax. */
  deductionCents: Cents;
  /** How much of the Social Security wage base was still available. */
  wageBaseRemainingCents: Cents;
  /** True when the Social Security portion was capped by the wage base. */
  wageBaseReached: boolean;
  explanation: string[];
  /** Figures that could not be verified, so the result may be wrong. */
  unverified: string[];
}

function additionalMedicareThresholdKey(status: FilingStatus): string {
  switch (status) {
    case 'married-joint':
    case 'qualifying-surviving-spouse':
      return 'se.additionalMedicareThreshold.marriedJoint';
    case 'married-separate':
      return 'se.additionalMedicareThreshold.marriedSeparate';
    default:
      return 'se.additionalMedicareThreshold.single';
  }
}

export function selfEmploymentTax(
  input: SelfEmploymentInput,
  year: TaxYearFigures,
): SelfEmploymentResult {
  const explanation: string[] = [];
  const unverified: string[] = [];

  const f = year.figures;
  const multiplier = valueOf(f['se.netEarningsMultiplier']!);
  const ssRate = valueOf(f['se.socialSecurityRate']!);
  const medicareRate = valueOf(f['se.medicareRate']!);
  const floor = valueOf(f['se.minimumNetEarnings']!);

  const wageBaseFigure = f['se.socialSecurityWageBase']!;
  if (wageBaseFigure.confidence !== 'verified') {
    unverified.push(`${wageBaseFigure.label} (${wageBaseFigure.note ?? 'not confirmed against a primary source'})`);
  }
  const wageBase = isUsable(wageBaseFigure) ? wageBaseFigure.value : 0;

  const wages = Math.max(0, input.wagesCents ?? 0);

  // A business loss produces no self-employment tax; it does not create a credit.
  const netProfit = Math.max(0, input.netProfitCents);
  const netEarnings = applyRate(netProfit, multiplier);
  explanation.push(
    `Net profit of ${fmt(netProfit)} becomes ${fmt(netEarnings)} of net earnings after the 92.35% adjustment.`,
  );

  if (netEarnings < floor) {
    explanation.push(
      `Net earnings are under ${fmt(floor)}, so no self-employment tax is due. The income is still reported.`,
    );
    return {
      netEarningsCents: netEarnings,
      socialSecurityCents: 0,
      medicareCents: 0,
      additionalMedicareCents: 0,
      totalCents: 0,
      deductionCents: 0,
      wageBaseRemainingCents: Math.max(0, wageBase - wages),
      wageBaseReached: false,
      explanation,
      unverified,
    };
  }

  // Wages already consumed part of the Social Security base.
  const baseRemaining = Math.max(0, wageBase - wages);
  const ssBase = Math.min(netEarnings, baseRemaining);
  const socialSecurity = applyRate(ssBase, ssRate);
  const wageBaseReached = netEarnings > baseRemaining;

  if (wages > 0) {
    explanation.push(
      `Your ${fmt(wages)} of W-2 wages already used part of the Social Security wage base, ` +
        `leaving ${fmt(baseRemaining)} of it available.`,
    );
  }
  explanation.push(
    wageBaseReached
      ? `Social Security applies to ${fmt(ssBase)} — the rest is above the wage base and is not taxed for Social Security.`
      : `Social Security at 12.4% on ${fmt(ssBase)} is ${fmt(socialSecurity)}.`,
  );

  const medicare = applyRate(netEarnings, medicareRate);
  explanation.push(`Medicare at 2.9% on the full ${fmt(netEarnings)} is ${fmt(medicare)}. Medicare has no cap.`);

  // The extra 0.9% is charged on combined wages and self-employment income
  // above the threshold, and only on the part above it.
  const thresholdFigure = f[additionalMedicareThresholdKey(input.filingStatus)]!;
  const threshold = valueOf(thresholdFigure);
  const combined = wages + netEarnings;
  const overThreshold = Math.max(0, combined - threshold);
  const additionalMedicare =
    overThreshold > 0 ? applyRate(Math.min(overThreshold, netEarnings), valueOf(f['se.additionalMedicareRate']!)) : 0;
  if (additionalMedicare > 0) {
    explanation.push(
      `Combined income above ${fmt(threshold)} attracts an extra 0.9% Medicare tax of ${fmt(additionalMedicare)}. ` +
        'That extra amount is not deductible.',
    );
  }

  const regular = socialSecurity + medicare;
  const total = regular + additionalMedicare;
  // Half of the regular tax only. The additional Medicare tax is excluded.
  const deduction = Math.round(regular / 2);

  explanation.push(
    `Total self-employment tax is ${fmt(total)}. Half of the regular portion, ${fmt(deduction)}, ` +
      'is deductible against your income tax.',
  );

  return {
    netEarningsCents: netEarnings,
    socialSecurityCents: socialSecurity,
    medicareCents: medicare,
    additionalMedicareCents: additionalMedicare,
    totalCents: total,
    deductionCents: deduction,
    wageBaseRemainingCents: baseRemaining,
    wageBaseReached,
    explanation,
    unverified,
  };
}

function fmt(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A rough "set this aside" rate.
 *
 * The single most useful number for someone starting out: what fraction of each
 * dollar of profit should go straight into a separate account and not be spent.
 * Self-employment tax alone is about 14.1% of profit (15.3% of 92.35%); income
 * tax sits on top and depends on everything else.
 */
export function setAsideGuidance(marginalIncomeTaxRate: number | null): {
  seOnlyRate: number;
  suggestedRate: number | null;
  explanation: string;
} {
  const seOnly = 0.153 * 0.9235;
  if (marginalIncomeTaxRate === null) {
    return {
      seOnlyRate: seOnly,
      suggestedRate: null,
      explanation:
        'Self-employment tax alone takes about 14 cents of every dollar of profit. Income tax comes on top, ' +
        'and how much depends on your other income — fill in your filing details to get a full figure.',
    };
  }
  // Income tax applies to profit less half the self-employment tax.
  const combined = seOnly + marginalIncomeTaxRate * (1 - seOnly / 2);

  // A marginal rate of zero is a real answer, not a missing one: the standard
  // deduction is still absorbing the profit. Saying "and the rest for income
  // tax" there would be wrong, and it is exactly the case a first-year seller
  // is in.
  if (marginalIncomeTaxRate === 0) {
    return {
      seOnlyRate: seOnly,
      suggestedRate: combined,
      explanation:
        `Set aside roughly ${Math.round(combined * 100)}% of every dollar of profit, all of it for ` +
        'self-employment tax. Your income so far is still covered by the standard deduction, so federal ' +
        'income tax adds nothing yet — that changes the moment it is not.',
    };
  }

  return {
    seOnlyRate: seOnly,
    suggestedRate: combined,
    explanation:
      `Set aside roughly ${Math.round(combined * 100)}% of every dollar of profit: about 14% for ` +
      `self-employment tax and about ${Math.round(marginalIncomeTaxRate * (1 - seOnly / 2) * 100)}% for ` +
      'income tax. Move it to a separate account the day the money lands.',
  };
}
