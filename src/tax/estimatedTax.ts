/**
 * Quarterly estimated tax — Form 1040-ES.
 *
 * Nobody withholds tax from a card sale. The IRS expects tax to be paid as
 * income is earned, in four instalments, and charges an underpayment penalty
 * when it is not — even if the return itself is filed on time and paid in full.
 * The penalty is interest-like and accrues per quarter, so being late on one
 * instalment costs money that no April payment can undo.
 *
 * Two escape hatches, and getting under either one stops the penalty entirely:
 *
 *   CURRENT YEAR   Pay 90% of what this year's total tax turns out to be.
 *                  Safe, but you cannot know the number until the year is over.
 *   PRIOR YEAR     Pay 100% of LAST year's total tax — or 110% of it if last
 *                  year's adjusted gross income was over $150,000. This is the
 *                  one people actually use, because last year's number is
 *                  already known and cannot move.
 *
 * A first-year business has no prior-year return, so only the current-year test
 * is available, which is exactly when estimating is hardest.
 *
 * The four instalments are NOT quarters. The periods are 3, 2, 3 and 4 months
 * long, which is why the June payment always feels early.
 */

import type { Cents } from '../domain/money.js';
import { applyRate } from '../domain/money.js';
import type { IsoDate } from '../domain/types.js';

/** Prior-year AGI above this requires 110% rather than 100%. Not indexed. */
export const HIGH_INCOME_PRIOR_YEAR_AGI = 15000000;
export const SAFE_HARBOR_AUTHORITY = 'IRC 6654(d)(1)(B)-(C)';

export interface EstimatedPeriod {
  quarter: 1 | 2 | 3 | 4;
  /** Income earned in this window counts toward this instalment. */
  periodStart: IsoDate;
  periodEnd: IsoDate;
  dueOn: IsoDate;
  /** Cumulative share of the year's tax expected by this date. */
  cumulativeShare: number;
}

/**
 * The four instalment periods for a tax year.
 *
 * Due dates fall on the 15th and shift to the next weekday when that is a
 * weekend. Federal holidays can shift them further — Emancipation Day in the
 * District of Columbia is the usual culprit for the April date — so a date the
 * app computes should be checked against the IRS calendar before it is relied
 * on.
 */
export function estimatedPeriods(year: number): EstimatedPeriod[] {
  return [
    { quarter: 1, periodStart: `${year}-01-01`, periodEnd: `${year}-03-31`, dueOn: nextBusinessDay(`${year}-04-15`), cumulativeShare: 0.25 },
    { quarter: 2, periodStart: `${year}-04-01`, periodEnd: `${year}-05-31`, dueOn: nextBusinessDay(`${year}-06-15`), cumulativeShare: 0.5 },
    { quarter: 3, periodStart: `${year}-06-01`, periodEnd: `${year}-08-31`, dueOn: nextBusinessDay(`${year}-09-15`), cumulativeShare: 0.75 },
    { quarter: 4, periodStart: `${year}-09-01`, periodEnd: `${year}-12-31`, dueOn: nextBusinessDay(`${year + 1}-01-15`), cumulativeShare: 1 },
  ];
}

/** Shift a date forward off a Saturday or Sunday. */
export function nextBusinessDay(iso: IsoDate): IsoDate {
  const date = new Date(`${iso}T00:00:00Z`);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

export interface SafeHarborInput {
  /** Best estimate of this year's total federal tax, income plus SE. */
  projectedTaxCents: Cents;
  /** Total tax from last year's return, if there was one. */
  priorYearTaxCents: Cents | null;
  priorYearAgiCents: Cents | null;
  /** Tax already withheld from wages, which counts toward the requirement. */
  withholdingCents: Cents;
}

export interface SafeHarborResult {
  /** The smaller requirement — meeting it avoids the penalty. */
  requiredCents: Cents;
  basis: 'current-year' | 'prior-year' | 'current-year-only';
  currentYearTestCents: Cents;
  priorYearTestCents: Cents | null;
  priorYearMultiplier: number | null;
  /** Requirement less withholding: what estimated payments must cover. */
  netRequiredCents: Cents;
  explanation: string[];
}

export function safeHarbor(input: SafeHarborInput): SafeHarborResult {
  const explanation: string[] = [];

  const currentYearTest = applyRate(Math.max(0, input.projectedTaxCents), 0.9);
  explanation.push(
    `Paying 90% of this year's tax means ${fmt(currentYearTest)}, based on the profit projected so far.`,
  );

  let priorYearTest: Cents | null = null;
  let multiplier: number | null = null;

  if (input.priorYearTaxCents !== null && input.priorYearTaxCents >= 0) {
    const highIncome =
      input.priorYearAgiCents !== null && input.priorYearAgiCents > HIGH_INCOME_PRIOR_YEAR_AGI;
    multiplier = highIncome ? 1.1 : 1.0;
    priorYearTest = applyRate(input.priorYearTaxCents, multiplier);
    explanation.push(
      highIncome
        ? `Last year's adjusted gross income was over $150,000, so the prior-year test is 110% of last year's tax: ${fmt(priorYearTest)}.`
        : `The prior-year test is 100% of last year's total tax: ${fmt(priorYearTest)}.`,
    );
  } else {
    explanation.push(
      'There is no prior-year return to fall back on, so the only protection is paying 90% of this year’s tax. ' +
        'First-year businesses have to estimate, which is why keeping the books current matters most now.',
    );
  }

  const required =
    priorYearTest === null ? currentYearTest : Math.min(currentYearTest, priorYearTest);
  const basis: SafeHarborResult['basis'] =
    priorYearTest === null ? 'current-year-only' : required === priorYearTest ? 'prior-year' : 'current-year';

  if (priorYearTest !== null) {
    explanation.push(
      basis === 'prior-year'
        ? 'The prior-year test is lower, so paying that amount is enough to avoid a penalty however this year turns out.'
        : 'This year is projected to be a lighter year than last, so the 90% test is the lower requirement.',
    );
  }

  const netRequired = Math.max(0, required - Math.max(0, input.withholdingCents));
  if (input.withholdingCents > 0) {
    explanation.push(
      `Withholding of ${fmt(input.withholdingCents)} counts toward this, leaving ${fmt(netRequired)} to pay in instalments.`,
    );
  }

  return {
    requiredCents: required,
    basis,
    currentYearTestCents: currentYearTest,
    priorYearTestCents: priorYearTest,
    priorYearMultiplier: multiplier,
    netRequiredCents: netRequired,
    explanation,
  };
}

export interface QuarterStatus {
  period: EstimatedPeriod;
  /** Cumulative amount that should have been paid by this due date. */
  expectedCumulativeCents: Cents;
  /** Amount for this instalment on its own. */
  instalmentCents: Cents;
  paidCents: Cents;
  shortfallCents: Cents;
  status: 'paid' | 'short' | 'upcoming' | 'due-soon' | 'overdue';
  daysUntilDue: number;
}

export interface EstimatedTaxPlan {
  year: number;
  safeHarbor: SafeHarborResult;
  quarters: QuarterStatus[];
  totalPaidCents: Cents;
  remainingCents: Cents;
  warnings: string[];
}

export interface EstimatedTaxInput extends SafeHarborInput {
  year: number;
  /** Payments already made, by quarter. */
  paymentsByQuarter?: Partial<Record<1 | 2 | 3 | 4, Cents>>;
  /** Evaluation date; injected so results are reproducible. */
  today?: Date;
}

export function estimatedTaxPlan(input: EstimatedTaxInput): EstimatedTaxPlan {
  const harbor = safeHarbor(input);
  const periods = estimatedPeriods(input.year);
  const today = input.today ?? new Date();
  const warnings: string[] = [];

  let cumulativePaid = 0;
  const quarters: QuarterStatus[] = periods.map((period) => {
    const paid = input.paymentsByQuarter?.[period.quarter] ?? 0;
    cumulativePaid += paid;

    const expectedCumulative = applyRate(harbor.netRequiredCents, period.cumulativeShare);
    const previousShare = period.quarter === 1 ? 0 : periods[period.quarter - 2]!.cumulativeShare;
    const instalment = expectedCumulative - applyRate(harbor.netRequiredCents, previousShare);
    const shortfall = Math.max(0, expectedCumulative - cumulativePaid);

    const days = daysUntil(period.dueOn, today);
    let status: QuarterStatus['status'];
    if (shortfall === 0) status = 'paid';
    else if (days < 0) status = 'overdue';
    else if (days <= 14) status = 'due-soon';
    else if (days <= 60) status = 'short';
    else status = 'upcoming';

    return {
      period,
      expectedCumulativeCents: expectedCumulative,
      instalmentCents: instalment,
      paidCents: paid,
      shortfallCents: shortfall,
      status,
      daysUntilDue: days,
    };
  });

  const overdue = quarters.filter((q) => q.status === 'overdue');
  if (overdue.length > 0) {
    warnings.push(
      `${overdue.length} instalment${overdue.length === 1 ? '' : 's'} passed unpaid. The underpayment penalty ` +
        'accrues per period, so paying now stops it growing even though it cannot undo what has accrued. ' +
        'Pay as soon as you can rather than waiting for the next due date.',
    );
  }
  const dueSoon = quarters.find((q) => q.status === 'due-soon');
  if (dueSoon) {
    warnings.push(
      `The quarter ${dueSoon.period.quarter} instalment of ${fmt(dueSoon.shortfallCents)} is due on ` +
        `${dueSoon.period.dueOn}, in ${dueSoon.daysUntilDue} day${dueSoon.daysUntilDue === 1 ? '' : 's'}.`,
    );
  }
  if (harbor.basis === 'current-year-only') {
    warnings.push(
      'With no prior-year return there is no fixed safe harbour, so this estimate moves as the year does. ' +
        'Re-check it after any big month.',
    );
  }

  return {
    year: input.year,
    safeHarbor: harbor,
    quarters,
    totalPaidCents: cumulativePaid,
    remainingCents: Math.max(0, harbor.netRequiredCents - cumulativePaid),
    warnings,
  };
}

export function daysUntil(iso: IsoDate, from: Date): number {
  const target = Date.parse(`${iso}T00:00:00Z`);
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return Math.round((target - start) / 86_400_000);
}

function fmt(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
