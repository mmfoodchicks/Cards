/**
 * Profit and loss, laid out as Schedule C.
 *
 * Deliberately not a generic P&L. The line numbers are the point: at filing
 * time the user (or their CPA) should be able to read this straight onto the
 * form without deciding where anything goes.
 *
 * Two treatments that catch people out and are handled explicitly here:
 *
 *   SHIPPING the buyer paid you is GROSS RECEIPTS, and the postage you bought
 *   is a DEDUCTION. Netting them looks tidier and understates both sides, which
 *   makes the return stop matching the 1099-K.
 *
 *   SALES TAX you collected is NOT income. It is the state's money passing
 *   through your hands. When a marketplace collects and remits it, it should
 *   never appear in your figures at all.
 */

import { applyRate, sum, type Cents } from '../domain/money.js';
import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import { ACCOUNTS_BY_KEY, SCHEDULE_C_LINES } from '../tax/scheduleC.js';
import { cogsForYear, cogsMaterialsMethod, type CogsReport } from './cogs.js';
import { getProfile } from '../db/repos.js';
import type { InventoryMethod } from '../domain/types.js';

export interface ExpenseLine {
  line: string;
  title: string;
  accountKey: string;
  accountName: string;
  /** What was actually spent. */
  grossCents: Cents;
  /** What is deductible after business-use percentages and statutory limits. */
  deductibleCents: Cents;
  /** Set when a limit reduced the deduction, so the user can see why. */
  limitNote: string | null;
}

export interface ProfitLossReport {
  year: number;
  inventoryMethod: InventoryMethod;

  /** Line 1. Includes shipping charged to buyers; excludes sales tax. */
  grossReceiptsCents: Cents;
  /** Line 2. */
  returnsAndAllowancesCents: Cents;
  /** Line 3. */
  netReceiptsCents: Cents;
  /** Line 4. */
  cogsCents: Cents;
  /** Line 5. */
  grossProfitCents: Cents;
  /** Line 7. */
  grossIncomeCents: Cents;

  expenseLines: ExpenseLine[];
  /** Line 28. */
  totalExpensesCents: Cents;
  /** Line 29. */
  tentativeProfitCents: Cents;
  /** Line 30. */
  homeOfficeCents: Cents;
  /** Line 31 — the figure that flows to Form 1040 and Schedule SE. */
  netProfitCents: Cents;

  cogs: CogsReport;
  /** Sales tax collected and owed onward. Not income; shown so it is not spent. */
  salesTaxCollectedCents: Cents;
  salesTaxRemittedByPlatformCents: Cents;
  /** Things the user should look at before filing. */
  warnings: string[];
}

export interface ProfitLossOptions {
  /** Standard mileage rate in cents per mile, when a verified figure exists. */
  mileageRateCentsPerMile?: number | null;
  /** Deductible share of business meals, e.g. 0.5. */
  mealsDeductiblePercent?: number | null;
  /** Home office deduction in cents, computed elsewhere. */
  homeOfficeCents?: Cents;
}

export function profitAndLoss(
  year: number,
  options: ProfitLossOptions = {},
  db: Db = getDb(),
): ProfitLossReport {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const profile = getProfile(db);
  const warnings: string[] = [];

  // --- Income -------------------------------------------------------------
  const sales = db.prepare(`
    SELECT
      COALESCE(SUM(gross_cents), 0)              AS gross,
      COALESCE(SUM(shipping_charged_cents), 0)   AS shippingCharged,
      COALESCE(SUM(refunded_cents), 0)           AS refunded,
      COALESCE(SUM(platform_fee_cents), 0)       AS platformFees,
      COALESCE(SUM(payment_processing_fee_cents), 0) AS processingFees,
      COALESCE(SUM(shipping_cost_cents), 0)      AS shippingCost,
      COALESCE(SUM(other_fee_cents), 0)          AS otherFees,
      COALESCE(SUM(CASE WHEN sales_tax_remitted_by_platform = 0 THEN sales_tax_collected_cents ELSE 0 END), 0) AS taxSelfCollected,
      COALESCE(SUM(CASE WHEN sales_tax_remitted_by_platform = 1 THEN sales_tax_collected_cents ELSE 0 END), 0) AS taxPlatformCollected
    FROM sales WHERE sold_on BETWEEN @from AND @to
  `).get({ from, to }) as Record<string, number>;

  // Shipping the buyer paid is part of what they paid you, so it is receipts.
  const grossReceipts = sales.gross! + sales.shippingCharged!;
  const returns = sales.refunded!;
  const netReceipts = grossReceipts - returns;

  // --- Cost of goods sold -------------------------------------------------
  const cogs = cogsForYear(year, db);
  const cogsCents =
    profile.inventoryMethod === 'materials-and-supplies'
      ? cogsMaterialsMethod(year, db).cogsCents
      : cogs.cogsCents;

  if (cogs.warning) warnings.push(cogs.warning);

  const grossProfit = netReceipts - cogsCents;
  const grossIncome = grossProfit;

  // --- Expenses -----------------------------------------------------------
  const expenseRows = db.prepare(`
    SELECT account_key, SUM(amount_cents) AS gross,
           SUM(amount_cents * business_use_percent / 100.0) AS deductible
    FROM expenses WHERE incurred_on BETWEEN @from AND @to
    GROUP BY account_key
  `).all({ from, to }) as Array<{ account_key: string; gross: number; deductible: number }>;

  const byLine = new Map<string, ExpenseLine>();

  const push = (line: ExpenseLine): void => {
    const existing = byLine.get(`${line.line}:${line.accountKey}`);
    if (existing) {
      existing.grossCents += line.grossCents;
      existing.deductibleCents += line.deductibleCents;
    } else {
      byLine.set(`${line.line}:${line.accountKey}`, line);
    }
  };

  for (const row of expenseRows) {
    const account = ACCOUNTS_BY_KEY[row.account_key];
    if (!account) {
      warnings.push(`Expenses are recorded against an unknown category "${row.account_key}" and were left out.`);
      continue;
    }
    // Grading and inventory purchases belong in cost of goods sold, not here.
    if (account.isCogs) continue;

    let deductible = Math.round(row.deductible);
    let limitNote: string | null = null;

    if (account.key === 'meals') {
      const rate = options.mealsDeductiblePercent;
      if (rate === null || rate === undefined) {
        limitNote =
          'Business meals are subject to a statutory percentage limit that has not been confirmed for this year, ' +
          'so the full amount is shown. Check the limit before filing.';
        warnings.push('The deductible percentage for business meals has not been verified for this tax year.');
      } else {
        deductible = applyRate(deductible, rate);
        limitNote = `Limited to ${Math.round(rate * 100)}% of the amount spent.`;
      }
    }

    push({
      line: account.scheduleCLine,
      title: SCHEDULE_C_LINES[account.scheduleCLine]?.title ?? 'Other expenses',
      accountKey: account.key,
      accountName: account.name,
      grossCents: row.gross,
      deductibleCents: deductible,
      limitNote,
    });
  }

  // --- Mileage ------------------------------------------------------------
  const miles = (db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN round_trip = 1 THEN miles * 2 ELSE miles END), 0) AS total
    FROM mileage_trips WHERE driven_on BETWEEN @from AND @to
  `).get({ from, to }) as { total: number }).total;

  if (miles > 0) {
    const rate = options.mileageRateCentsPerMile;
    if (rate === null || rate === undefined) {
      warnings.push(
        `${miles.toFixed(1)} business miles are logged but the standard mileage rate for ${year} has not been ` +
          'verified, so no vehicle deduction is included. That deduction is usually worth real money — ' +
          'confirm the rate and it will appear here.',
      );
    } else {
      push({
        line: '9',
        title: SCHEDULE_C_LINES['9']!.title,
        accountKey: 'vehicle',
        accountName: 'Vehicle',
        grossCents: Math.round(miles * rate),
        deductibleCents: Math.round(miles * rate),
        limitNote: `${miles.toFixed(1)} miles at the standard mileage rate.`,
      });
    }
  }

  const expenseLines = [...byLine.values()].sort((a, b) => a.line.localeCompare(b.line, 'en', { numeric: true }));
  const totalExpenses = sum(expenseLines.map((l) => l.deductibleCents));
  const tentativeProfit = grossIncome - totalExpenses;

  // The home office deduction cannot create or increase a loss, so it is capped
  // at tentative profit.
  const requestedHomeOffice = options.homeOfficeCents ?? 0;
  const homeOffice = Math.max(0, Math.min(requestedHomeOffice, Math.max(0, tentativeProfit)));
  if (requestedHomeOffice > homeOffice) {
    warnings.push(
      'The home office deduction was reduced because it cannot create or deepen a business loss. ' +
        'The unused part may be able to carry forward — worth asking a preparer about.',
    );
  }

  const netProfit = tentativeProfit - homeOffice;

  if (sales.taxSelfCollected! > 0) {
    warnings.push(
      `You collected ${(sales.taxSelfCollected! / 100).toFixed(2)} dollars of sales tax yourself that a platform ` +
        'did not remit. That money belongs to the state and needs to be filed and paid, not spent.',
    );
  }

  return {
    year,
    inventoryMethod: profile.inventoryMethod,
    grossReceiptsCents: grossReceipts,
    returnsAndAllowancesCents: returns,
    netReceiptsCents: netReceipts,
    cogsCents,
    grossProfitCents: grossProfit,
    grossIncomeCents: grossIncome,
    expenseLines,
    totalExpensesCents: totalExpenses,
    tentativeProfitCents: tentativeProfit,
    homeOfficeCents: homeOffice,
    netProfitCents: netProfit,
    cogs,
    salesTaxCollectedCents: sales.taxSelfCollected!,
    salesTaxRemittedByPlatformCents: sales.taxPlatformCollected!,
    warnings,
  };
}
