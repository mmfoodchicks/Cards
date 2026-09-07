/**
 * Utah individual income tax on business profit.
 *
 * Utah is a flat-rate state, which makes the incremental calculation simple:
 * the state starts from federal adjusted gross income, so Schedule C profit
 * flows straight through and is taxed at the same rate as every other dollar.
 *
 * The one thing that is NOT simple is the taxpayer tax credit. Utah does not
 * have a standard deduction or personal exemptions; instead it grants a credit
 * that phases out as income rises, at 1.3 cents per dollar of income above a
 * threshold. Inside the phase-out range the effective marginal rate on an extra
 * dollar is higher than the headline rate, and above it the credit is gone
 * entirely and the headline rate is exact.
 *
 * This computes the INCREMENTAL state tax on business profit — what the profit
 * adds to a Utah return — and says plainly that it does not model the credit.
 * For someone above the phase-out (most people with a day job), that is exact.
 * For someone below it, the real figure is somewhat lower.
 */

import { applyRate, type Cents } from '../../domain/money.js';
import { isUsable, valueOf, type TaxYearFigures } from '../figures.js';

export interface UtahIncomeTaxResult {
  rate: number;
  /** Profit and other business income flowing to the Utah return. */
  taxableCents: Cents;
  taxCents: Cents;
  explanation: string[];
  limitations: string[];
  unverified: string[];
}

export function utahIncomeTax(
  businessProfitCents: Cents,
  year: TaxYearFigures,
): UtahIncomeTaxResult {
  const unverified: string[] = [];
  const rateFigure = year.figures['utah.incomeTaxRate'];

  if (rateFigure && rateFigure.confidence !== 'verified') {
    unverified.push(`${rateFigure.label} (${rateFigure.note ?? 'not confirmed against a primary source'})`);
  }
  const rate = isUsable(rateFigure) ? valueOf(rateFigure) : 0;

  const taxable = Math.max(0, businessProfitCents);
  const tax = applyRate(taxable, rate);

  return {
    rate,
    taxableCents: taxable,
    taxCents: tax,
    explanation: [
      `Utah taxes at a flat ${(rate * 100).toFixed(2)}%, starting from federal adjusted gross income, so ` +
        `${fmt(taxable)} of business profit adds ${fmt(tax)} of state tax.`,
      'Utah has no separate business return for a sole proprietor. This goes on form TC-40 with everything else.',
    ],
    limitations: [
      'Does not model the Utah taxpayer tax credit, which replaces a standard deduction and phases out as ' +
        'income rises. Above the phase-out this figure is exact; below it, the real tax is lower.',
      'Utah has no separate estimated-tax payment system for individuals — it is settled with the annual ' +
        'return, though under-withholding can still leave a large balance due in April.',
    ],
    unverified,
  };
}

function fmt(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
