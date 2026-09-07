/**
 * Federal income tax — the other half of the bill.
 *
 * Self-employment tax was already modelled. Until now income tax was not, so
 * the estimated-tax projection reported self-employment tax alone and called
 * itself a floor. That is honest but not much use: for a seller with a day job,
 * income tax on the business profit is usually the LARGER of the two, because
 * the profit stacks on top of the wages and is taxed at the marginal rate the
 * wages already reached.
 *
 * That stacking is the whole point, and it is what makes a flat "set aside 30%"
 * rule of thumb wrong in both directions. Someone with no other income pays
 * almost no income tax on the first $16,100 of profit and 10% on the next
 * $12,400. Someone earning $90,000 at a day job pays 22% on the first dollar of
 * card profit. Same profit, very different bill.
 *
 * WHAT THIS MODELS
 *   - Ordinary income at the 2026 rate schedules, per filing status.
 *   - The standard deduction.
 *   - The deduction for half of self-employment tax (an above-the-line
 *     adjustment, so it reduces taxable income).
 *   - The section 199A qualified business income deduction, in the simple
 *     below-threshold form: 20% of qualified business income, limited to 20% of
 *     taxable income before the deduction.
 *   - Long-term collectibles gain at its own 28% ceiling, stacked on top.
 *
 * WHAT IT DOES NOT MODEL, and says so rather than quietly assuming zero:
 *   - Itemised deductions. It assumes the standard deduction is larger, which
 *     is true for most people and false for some.
 *   - Credits of any kind — child tax credit, education, energy. Every one of
 *     them reduces the bill, so the result is a ceiling in that direction.
 *   - The preferential 0/15/20% rates on ordinary long-term capital gains.
 *   - Alternative minimum tax, net investment income tax, state tax other than
 *     Utah's flat rate, and the QBI phase-out above the threshold.
 *
 * So this is a planning estimate for setting money aside and sizing quarterly
 * payments. It is not a return, and the app says that everywhere it appears.
 */

import type { Cents } from '../domain/money.js';
import { applyRate } from '../domain/money.js';
import type { FilingStatus } from '../domain/types.js';
import { isUsable, valueOf, type TaxBracket, type TaxYearFigures } from './figures.js';

export interface IncomeTaxInput {
  /** Schedule C net profit. */
  businessProfitCents: Cents;
  /** W-2 wages and any other ordinary income. */
  otherIncomeCents?: Cents;
  /** Half of self-employment tax, from the Schedule SE computation. */
  selfEmploymentDeductionCents?: Cents;
  /** Long-term gain on collectibles, taxed at its own 28% ceiling. */
  collectiblesGainCents?: Cents;
  /** Short-term gain, which is ordinary income. */
  shortTermGainCents?: Cents;
  filingStatus: FilingStatus;
  /**
   * Claim the section 199A deduction on the business profit. Default true — it
   * is available to a sole proprietor below the threshold, and omitting it
   * overstates the tax by roughly a fifth of the profit's marginal rate.
   */
  claimQbi?: boolean;
}

export interface BracketSlice {
  rate: number;
  /** Income taxed at this rate. */
  amountCents: Cents;
  taxCents: Cents;
}

export interface IncomeTaxResult {
  /** Everything before deductions. */
  grossIncomeCents: Cents;
  selfEmploymentDeductionCents: Cents;
  qbiDeductionCents: Cents;
  standardDeductionCents: Cents;
  taxableIncomeCents: Cents;
  /** Ordinary income tax, before the collectibles layer. */
  ordinaryTaxCents: Cents;
  collectiblesTaxCents: Cents;
  totalTaxCents: Cents;
  /** The rate the NEXT dollar of business profit would be taxed at. */
  marginalRate: number;
  /** Total tax over gross income. Always lower than the marginal rate. */
  effectiveRate: number;
  slices: BracketSlice[];
  explanation: string[];
  /** What this deliberately leaves out. */
  limitations: string[];
  unverified: string[];
}

function standardDeductionKey(status: FilingStatus): string {
  switch (status) {
    case 'married-joint':
    case 'qualifying-surviving-spouse':
      return 'deduction.standard.marriedJoint';
    case 'married-separate':
      return 'deduction.standard.marriedSeparate';
    case 'head-of-household':
      return 'deduction.standard.headOfHousehold';
    default:
      return 'deduction.standard.single';
  }
}

/** Tax on an amount under a rate schedule, sliced bracket by bracket. */
export function applyBrackets(taxableCents: Cents, brackets: readonly TaxBracket[]): {
  taxCents: Cents;
  slices: BracketSlice[];
} {
  const slices: BracketSlice[] = [];
  let tax = 0;

  for (const b of brackets) {
    if (taxableCents <= b.fromCents) break;
    const ceiling = b.toCents ?? taxableCents;
    const amount = Math.min(taxableCents, ceiling) - b.fromCents;
    if (amount <= 0) continue;
    const sliceTax = applyRate(amount, b.rate);
    slices.push({ rate: b.rate, amountCents: amount, taxCents: sliceTax });
    tax += sliceTax;
  }

  return { taxCents: tax, slices };
}

type Computation = Omit<IncomeTaxResult, 'marginalRate' | 'effectiveRate'>;

function compute(input: IncomeTaxInput, year: TaxYearFigures): Computation {
  const explanation: string[] = [];
  const limitations: string[] = [];
  const unverified: string[] = [];

  const tables = year.brackets;
  if (!tables) {
    throw new Error(
      `No rate schedules are loaded for ${year.year}, so income tax cannot be computed. ` +
        'Add them from the year\'s Revenue Procedure before relying on this.',
    );
  }
  if (tables.confidence !== 'verified') {
    unverified.push(`${year.year} rate schedules (${tables.authority})`);
  }

  const brackets = tables.byStatus[input.filingStatus];

  const sdFigure = year.figures[standardDeductionKey(input.filingStatus)];
  if (sdFigure && sdFigure.confidence !== 'verified') {
    unverified.push(`${sdFigure.label} (${sdFigure.note ?? 'not confirmed against a primary source'})`);
  }
  const standardDeduction = isUsable(sdFigure) ? valueOf(sdFigure) : 0;

  const profit = Math.max(0, input.businessProfitCents);
  const other = Math.max(0, input.otherIncomeCents ?? 0);
  const shortTerm = Math.max(0, input.shortTermGainCents ?? 0);
  const collectibles = Math.max(0, input.collectiblesGainCents ?? 0);
  const seDeduction = Math.max(0, input.selfEmploymentDeductionCents ?? 0);

  // Short-term gain is ordinary. Collectibles gain is layered on separately
  // because it has its own ceiling.
  const gross = profit + other + shortTerm + collectibles;
  explanation.push(
    `Gross income of ${fmt(gross)}: ${fmt(profit)} of business profit` +
      (other > 0 ? `, ${fmt(other)} of wages and other income` : '') +
      (shortTerm > 0 ? `, ${fmt(shortTerm)} of short-term gain` : '') +
      (collectibles > 0 ? `, ${fmt(collectibles)} of long-term collectibles gain` : '') +
      '.',
  );

  // Half of self-employment tax comes off before anything else.
  const afterSe = Math.max(0, gross - seDeduction);
  if (seDeduction > 0) {
    explanation.push(
      `Less ${fmt(seDeduction)} for half of self-employment tax, an above-the-line adjustment.`,
    );
  }

  // The QBI deduction is computed on taxable income before itself.
  const beforeQbi = Math.max(0, afterSe - standardDeduction);
  let qbi = 0;
  if ((input.claimQbi ?? true) && profit > 0) {
    const thresholdFigure = year.figures['qbi.threshold.single'];
    const threshold = isUsable(thresholdFigure) ? valueOf(thresholdFigure) : 0;
    // The business profit qualifies, reduced by the self-employment adjustment
    // attributable to it. Limited to 20% of taxable income.
    const qualified = Math.max(0, profit - seDeduction);
    // Collectibles gain is net capital gain, which the limit excludes.
    const limitBase = Math.max(0, beforeQbi - collectibles);
    qbi = Math.min(applyRate(qualified, 0.2), applyRate(limitBase, 0.2));
    if (qbi > 0) {
      explanation.push(
        `Less ${fmt(qbi)} for the section 199A deduction — 20% of qualified business income, on Form 8995.`,
      );
    }
    if (threshold > 0 && beforeQbi > threshold) {
      limitations.push(
        `Taxable income is above the ${fmt(threshold)} section 199A threshold, where the deduction starts ` +
          'to phase out against wages and property. This estimate does not model that phase-out, so it ' +
          'understates the tax.',
      );
    }
  }

  const taxable = Math.max(0, afterSe - standardDeduction - qbi);
  explanation.push(
    `Less the ${fmt(standardDeduction)} standard deduction leaves ${fmt(taxable)} of taxable income.`,
  );

  // Collectibles gain sits at the top of the stack, at its own ceiling rate.
  const ordinaryTaxable = Math.max(0, taxable - collectibles);
  const ordinary = applyBrackets(ordinaryTaxable, brackets);

  let collectiblesTax = 0;
  if (collectibles > 0) {
    const rateFigure = year.figures['collectibles.maxRate'];
    const capRate = isUsable(rateFigure) ? valueOf(rateFigure) : 0.28;
    // The 28% figure is a CEILING, not a flat rate: gain below that bracket is
    // taxed at the ordinary rate it would have reached.
    const stacked = applyBrackets(taxable, brackets).taxCents - ordinary.taxCents;
    collectiblesTax = Math.min(stacked, applyRate(collectibles, capRate));
    explanation.push(
      `Long-term collectibles gain of ${fmt(collectibles)} is taxed at your ordinary rate but capped at ` +
        `${Math.round(capRate * 100)}%, giving ${fmt(collectiblesTax)}.`,
    );
  }

  const total = ordinary.taxCents + collectiblesTax;

  limitations.push(
    'Assumes the standard deduction. If you itemise more than that, this overstates the tax.',
    'Includes no credits at all. Any credit you qualify for reduces this.',
    'Does not model the 0/15/20% rates on ordinary long-term capital gains, alternative minimum tax, or ' +
      'net investment income tax.',
  );

  return {
    grossIncomeCents: gross,
    selfEmploymentDeductionCents: seDeduction,
    qbiDeductionCents: qbi,
    standardDeductionCents: standardDeduction,
    taxableIncomeCents: taxable,
    ordinaryTaxCents: ordinary.taxCents,
    collectiblesTaxCents: collectiblesTax,
    totalTaxCents: total,
    slices: ordinary.slices,
    explanation,
    limitations,
    unverified,
  };
}

/** How much more profit to test with when measuring the marginal rate. */
const MARGINAL_PROBE_CENTS = 10000;

export function incomeTax(input: IncomeTaxInput, year: TaxYearFigures): IncomeTaxResult {
  const base = compute(input, year);

  // The marginal rate is measured, not looked up. Reading it off the bracket
  // table gets three cases wrong: profit still absorbed by the standard
  // deduction (the next dollar is free, not 10%), the section 199A deduction
  // shaving 20% off each additional dollar, and a dollar that straddles a
  // bracket boundary. Adding $100 of profit and seeing what happens is right in
  // all three.
  const probe = compute(
    { ...input, businessProfitCents: input.businessProfitCents + MARGINAL_PROBE_CENTS },
    year,
  );
  const marginalRate = (probe.totalTaxCents - base.totalTaxCents) / MARGINAL_PROBE_CENTS;

  base.explanation.push(
    `Federal income tax of ${fmt(base.totalTaxCents)}. The next $100 of business profit would add ` +
      `${fmt(probe.totalTaxCents - base.totalTaxCents)} of income tax — an effective ` +
      `${(marginalRate * 100).toFixed(1)}% on the margin, before self-employment tax.`,
  );

  return {
    ...base,
    marginalRate,
    effectiveRate: base.grossIncomeCents > 0 ? base.totalTaxCents / base.grossIncomeCents : 0,
  };
}

/**
 * What the next dollar of profit actually costs, income tax and
 * self-employment tax together.
 *
 * This is the number worth knowing before deciding whether a flip is worth
 * making, and it is not any of the rates people usually quote.
 */
export function combinedMarginalRate(result: IncomeTaxResult, seRate = 0.153): number {
  // Self-employment tax applies to 92.35% of profit, and half of it is
  // deductible against income tax, so the true marginal cost is less than a
  // naive sum of the two rates.
  const seCost = seRate * 0.9235;
  const seDeductionSaving = result.marginalRate * (seCost / 2);
  return result.marginalRate + seCost - seDeductionSaving;
}

function fmt(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
