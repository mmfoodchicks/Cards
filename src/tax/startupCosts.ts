/**
 * Start-up costs — IRC 195.
 *
 * Money spent getting ready to trade is not a business expense, because there
 * was no business yet. Section 195(a) says so flatly: "no deduction shall be
 * allowed for start-up expenditures." What section 195(b) then gives back is a
 * deduction in the year the business BEGINS, of the lesser of the total or
 * $5,000 — reduced dollar for dollar once the total passes $50,000, so it is
 * gone entirely at $55,000 — with whatever remains spread over 180 months.
 *
 * Three things about this catch people out, and all three matter here.
 *
 * WHEN THE BUSINESS BEGINS is the pivot, and it is not when you decided to do
 * it, not when you opened a bank account, and not when you bought your first
 * box. Richmond Television: a taxpayer has not begun carrying on a trade or
 * business until it "has begun to function as a going concern and performed
 * the activities for which it was organized." For a card seller the defensible
 * line is the first card actually offered for sale — the first live listing or
 * the first show table.
 *
 * INVENTORY IS NOT A START-UP COST. This is the most common section 195 error
 * in this trade. Cards bought for resale are stock in trade; their cost comes
 * back through cost of goods sold when they sell. Buying $8,000 of wax before
 * opening does not create an $8,000 start-up deduction. This app never treats
 * it as one, because inventory is tracked as basis and never touches the
 * expense ledger.
 *
 * EQUIPMENT IS NOT A START-UP COST EITHER. A scanner, a camera, a safe, a
 * lightbox — those are depreciable property, deducted when placed in service.
 *
 * The election is automatic. Reg. 1.195-1(b) deems it made for the year the
 * business begins; nothing is attached to the return. It is the opposite
 * choice — capitalise everything and wait — that requires an affirmative
 * election.
 */

import type { Cents } from '../domain/money.js';
import type { IsoDate } from '../domain/types.js';

/** Immediate deduction ceiling. Statutory, and NOT inflation-indexed. */
export const STARTUP_IMMEDIATE_CAP: Cents = 500000;
/** Total at which the immediate deduction starts phasing out, dollar for dollar. */
export const STARTUP_PHASEOUT_START: Cents = 5000000;
/** Amortisation period for the remainder, in months. */
export const STARTUP_AMORTISATION_MONTHS = 180;

export const STARTUP_AUTHORITY = 'IRC 195; Treas. Reg. 1.195-1(b)';
export const STARTUP_SOURCE = 'https://www.law.cornell.edu/uscode/text/26/195';

/**
 * Accounts that can hold a start-up cost.
 *
 * The section 195(c)(1)(B) test is whether the same cost would have been
 * currently deductible for an existing business in the same field. Costs that
 * would be capitalised anyway — equipment, inventory — fail that test and are
 * governed by their own regime, so they are excluded here rather than swept in.
 */
const NON_QUALIFYING_ACCOUNTS = new Set([
  // Depreciable property: deducted when placed in service, under 179 or bonus
  // depreciation, not over 180 months.
  'equipment',
  // 195(c)(1) expressly excludes amounts deductible under 163(a).
  'interest',
  // Stock in trade. Recovered through cost of goods sold when it sells, and the
  // most common section 195 error in this trade.
  'inventory-purchases',
]);

export interface StartupExpense {
  id: number;
  incurredOn: IsoDate;
  accountKey: string;
  description: string;
  amountCents: Cents;
}

export interface StartupCostResult {
  /** Costs identified as incurred before the business began. */
  qualifyingCents: Cents;
  excludedCents: Cents;
  /** Deductible immediately in the year trading begins. */
  immediateDeductionCents: Cents;
  /** Spread over 180 months from the month trading begins. */
  amortisableCents: Cents;
  /** This year's slice of the amortisable amount. */
  amortisationThisYearCents: Cents;
  /** Total deduction for the year trading begins. */
  firstYearDeductionCents: Cents;
  monthlyAmortisationCents: Cents;
  monthsAmortisedThisYear: number;
  /** True when the total exceeded $50,000 and the immediate deduction shrank. */
  phasedOut: boolean;
  expenses: StartupExpense[];
  explanation: string[];
  warnings: string[];
}

/**
 * Analyse costs incurred before trading began.
 *
 * `startedOn` is the date the business began to function as a going concern.
 * Everything on or after it is an ordinary Schedule C expense and is not
 * considered here.
 */
export function startupCosts(
  expenses: readonly StartupExpense[],
  startedOn: IsoDate | null,
  year: number,
): StartupCostResult | null {
  // With no start date there is no line to draw, so there is nothing to say.
  if (startedOn === null) return null;

  const before = expenses.filter((e) => e.incurredOn < startedOn);
  const qualifying = before.filter((e) => !NON_QUALIFYING_ACCOUNTS.has(e.accountKey));
  const excluded = before.filter((e) => NON_QUALIFYING_ACCOUNTS.has(e.accountKey));

  const total = sum(qualifying.map((e) => e.amountCents));
  const excludedTotal = sum(excluded.map((e) => e.amountCents));

  // $5,000, reduced dollar for dollar by the excess over $50,000.
  const reduction = Math.max(0, total - STARTUP_PHASEOUT_START);
  const immediate = Math.max(0, Math.min(total, STARTUP_IMMEDIATE_CAP - reduction));
  const amortisable = total - immediate;

  // Amortisation runs from the MONTH trading begins, so a business that starts
  // in May gets eight months in its first year, not twelve.
  const startYear = Number(startedOn.slice(0, 4));
  const startMonth = Number(startedOn.slice(5, 7));
  const monthly = amortisable / STARTUP_AMORTISATION_MONTHS;

  let months = 0;
  if (year === startYear) months = 13 - startMonth;
  else if (year > startYear) {
    const elapsed = (year - startYear) * 12 + (13 - startMonth);
    months = Math.max(0, Math.min(12, STARTUP_AMORTISATION_MONTHS - (elapsed - 12)));
  }

  const amortisationThisYear = Math.round(monthly * months);
  const firstYear = (year === startYear ? immediate : 0) + amortisationThisYear;

  const explanation: string[] = [];
  const warnings: string[] = [];

  if (total === 0) {
    explanation.push(
      `Nothing was recorded before ${startedOn}, so there are no start-up costs to deduct. If you spent ` +
        'money scouting shows, on a licence, or on advice before you began trading, record it — it is ' +
        'deductible and it is routinely missed.',
    );
  } else if (amortisable === 0) {
    explanation.push(
      `${fmt(total)} of costs was incurred before trading began on ${startedOn}. That is under the ` +
        `${fmt(STARTUP_IMMEDIATE_CAP)} ceiling, so all of it is deducted in ${startYear} — nothing is ` +
        'spread over 180 months.',
    );
  } else {
    explanation.push(
      `${fmt(total)} of costs was incurred before trading began on ${startedOn}. ${fmt(immediate)} is ` +
        `deducted in ${startYear}; the remaining ${fmt(amortisable)} is spread over 180 months from ` +
        `${startedOn.slice(0, 7)}, which is ${fmt(Math.round(monthly))} a month.`,
    );
  }

  if (reduction > 0) {
    warnings.push(
      `Start-up costs passed ${fmt(STARTUP_PHASEOUT_START)}, so the immediate deduction is reduced dollar ` +
        `for dollar. It disappears entirely at ${fmt(STARTUP_PHASEOUT_START + STARTUP_IMMEDIATE_CAP)}.`,
    );
  }

  if (excludedTotal > 0) {
    warnings.push(
      `${fmt(excludedTotal)} recorded before ${startedOn} is NOT a start-up cost — equipment is depreciated ` +
        'when placed in service, and interest and property taxes have their own rules. It is excluded here ' +
        'rather than swept in.',
    );
  }

  explanation.push(
    'Cards bought before opening are NOT start-up costs. They are inventory, and their cost comes back ' +
      'through cost of goods sold when they sell. This app tracks them as basis, so they never appear here.',
  );

  explanation.push(
    'The election is automatic — Reg. 1.195-1(b) deems it made for the year the business begins. Nothing ' +
      'is attached to the return.',
  );

  return {
    qualifyingCents: total,
    excludedCents: excludedTotal,
    immediateDeductionCents: immediate,
    amortisableCents: amortisable,
    amortisationThisYearCents: amortisationThisYear,
    firstYearDeductionCents: firstYear,
    monthlyAmortisationCents: Math.round(monthly),
    monthsAmortisedThisYear: months,
    phasedOut: reduction > 0,
    expenses: qualifying,
    explanation,
    warnings,
  };
}

function sum(values: readonly number[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}

function fmt(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
