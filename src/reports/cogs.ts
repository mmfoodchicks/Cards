/**
 * Cost of goods sold — Schedule C, Part III.
 *
 * This is computed TWO independent ways and the results are compared:
 *
 *   The form's way    beginning inventory + purchases + other costs
 *                     − ending inventory
 *   The direct way    add up the basis actually relieved by each sale
 *
 * They must agree. When they do not, something has gone wrong in the books —
 * an item sold without its basis moving, a purchase never allocated, a hand
 * edit that broke a chain. Most bookkeeping software computes one of these and
 * reports it with confidence. Computing both is the cheapest possible check
 * that the numbers on the return are real.
 */

import type { Cents } from '../domain/money.js';
import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import { beginningInventory, endingInventory } from './inventory.js';

export interface CogsReport {
  year: number;
  /** Schedule C line 35. */
  beginningInventoryCents: Cents;
  /** Schedule C line 36: purchases less items withdrawn for personal use. */
  purchasesCents: Cents;
  personalWithdrawalsCents: Cents;
  /** Schedule C line 39: grading and other costs capitalised into inventory. */
  otherCostsCents: Cents;
  /** Schedule C line 40. */
  goodsAvailableCents: Cents;
  /** Schedule C line 41. */
  endingInventoryCents: Cents;
  /** Schedule C line 42, computed the form's way. */
  cogsCents: Cents;
  /** The same figure computed from the basis actually relieved by sales. */
  cogsFromSalesCents: Cents;
  /** Non-zero means the books do not tie and the return should not be filed yet. */
  differenceCents: Cents;
  /** Set when the two methods disagree, explaining what to look for. */
  warning: string | null;
}

export function cogsForYear(year: number, db: Db = getDb()): CogsReport {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const beginning = beginningInventory(year, db).inventoryBasisCents;
  const ending = endingInventory(year, db).inventoryBasisCents;

  // Purchases is the cost that entered INVENTORY this year — not the total of
  // every receipt. Two exclusions matter and both are easy to get wrong:
  //
  //   Cards held for investment rather than resale are not stock in trade.
  //   Their cost never belongs on Schedule C at all; it sits in basis until the
  //   card is sold and reported on Form 8949. Including it here would deduct a
  //   personal investment as a business cost.
  //
  //   Grading capitalised into a card's basis is reported separately on line 39,
  //   so it has to come back out of the basis figure or it would be counted twice.
  //
  // Summing item basis rather than lot totals also handles opened boxes for
  // free: the box's basis moved to its contents, so parent and children together
  // still total exactly what was paid.
  const purchasesGross = (db.prepare(`
    SELECT COALESCE(SUM(i.basis_cents), 0) - COALESCE((
      SELECT SUM(g.allocated_cost_cents)
      FROM grading_submission_items g
      JOIN inventory_items gi ON gi.id = g.item_id
      WHERE gi.holding_intent = 'inventory' AND gi.acquired_on BETWEEN @from AND @to
    ), 0) AS total
    FROM inventory_items i
    WHERE i.holding_intent = 'inventory' AND i.acquired_on BETWEEN @from AND @to
  `).get({ from, to }) as { total: number }).total;

  // Line 36 is explicitly purchases LESS the cost of items taken for personal
  // use. Leaving them in would deduct the cost of something never sold.
  const withdrawals = (db.prepare(`
    SELECT COALESCE(SUM(basis_cents), 0) AS total
    FROM inventory_items
    WHERE status = 'personal-use'
      AND holding_intent = 'inventory'
      AND acquired_on BETWEEN @from AND @to
  `).get({ from, to }) as { total: number }).total;

  // Grading costs get capitalised into card basis when the cards come back, so
  // they enter cost of goods sold through line 39 rather than as an expense.
  // Only grading spent on cards held for resale. Grading an investment card is
  // capitalised into that card's basis and gets no business deduction at all.
  const grading = (db.prepare(`
    SELECT COALESCE(SUM(g.allocated_cost_cents), 0) AS total
    FROM grading_submission_items g
    JOIN grading_submissions s ON s.id = g.submission_id
    JOIN inventory_items i ON i.id = g.item_id
    WHERE i.holding_intent = 'inventory'
      AND COALESCE(s.returned_on, s.submitted_on) BETWEEN @from AND @to
  `).get({ from, to }) as { total: number }).total;

  const purchases = purchasesGross - withdrawals;
  const goodsAvailable = beginning + purchases + grading;
  const cogs = goodsAvailable - ending;

  const cogsFromSales = (db.prepare(`
    SELECT COALESCE(SUM(sl.cogs_cents), 0) AS total
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    JOIN inventory_items i ON i.id = sl.item_id
    WHERE i.holding_intent = 'inventory'
      AND s.sold_on BETWEEN @from AND @to
  `).get({ from, to }) as { total: number }).total;

  const difference = cogs - cogsFromSales;

  return {
    year,
    beginningInventoryCents: beginning,
    purchasesCents: purchases,
    personalWithdrawalsCents: withdrawals,
    otherCostsCents: grading,
    goodsAvailableCents: goodsAvailable,
    endingInventoryCents: ending,
    cogsCents: cogs,
    cogsFromSalesCents: cogsFromSales,
    differenceCents: difference,
    warning: difference === 0 ? null : explainDifference(difference),
  };
}

function explainDifference(differenceCents: Cents): string {
  const direction = differenceCents > 0 ? 'more' : 'less';
  return (
    `The two ways of computing cost of goods sold disagree by ${Math.abs(differenceCents) / 100} dollars. ` +
    `The inventory calculation says ${direction} than the sales records do. ` +
    'Usual causes: a purchase recorded without items, an item sold without its cost basis, ' +
    'inventory values edited by hand, or a card still marked on hand that has actually gone. ' +
    'Worth resolving before filing — the two should match to the cent.'
  );
}

/**
 * Cost of goods sold under IRC 471(c), where a small business may treat
 * inventory as non-incidental materials and supplies.
 *
 * Under that treatment the cost is deducted when the item is sold or otherwise
 * disposed of, which is exactly the basis relieved by sales. The distinction
 * matters at year end: this method never leaves unsold inventory sitting as an
 * asset, so a big December buy is not deductible until it sells either way —
 * but the paperwork is far lighter.
 */
export function cogsMaterialsMethod(
  year: number,
  db: Db = getDb(),
): { cogsCents: Cents; note: string; caveat: string } {
  const report = cogsForYear(year, db);
  return {
    cogsCents: report.cogsFromSalesCents,
    note:
      'Computed as the cost of items actually sold during the year, which is how inventory is deducted ' +
      'when treated as non-incidental materials and supplies. Unsold inventory is not deducted until it sells.',
    // Being precise about an approximation rather than quiet about it.
    //
    // Reg. 1.471-1(b)(4)(i) recovers the cost in the year the taxpayer
    // "provides the inventory to its customer". This uses the SALE date,
    // because that is the only date the app records. For a card posted the same
    // week they are the same year and the figure is exact. They diverge only
    // when a sale and its shipment straddle 31 December — sell on the 30th,
    // post on the 2nd, and the deduction belongs to the following year.
    caveat:
      'This uses the date of sale. The regulation recovers the cost when the item is PROVIDED TO THE ' +
      'CUSTOMER, which is the same year for almost every sale — but not for one sold in late December and ' +
      'posted in January. Check any sale near the year end and move it if the parcel went out after the 31st.',
  };
}
