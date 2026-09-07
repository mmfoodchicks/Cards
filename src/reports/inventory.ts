/**
 * Inventory valuation.
 *
 * Two figures matter at year end: what is still on the shelf (Schedule C line
 * 41, ending inventory) and what was on the shelf when the year started (line
 * 35). The difference between them, plus what was bought, is cost of goods sold.
 *
 * Inventory is valued at COST here, not at market. That is the ordinary rule,
 * and it is also the conservative one: writing inventory up to market would
 * report profit before anything sold.
 */

import { sum, type Cents } from '../domain/money.js';
import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import type { HoldingIntent, IsoDate } from '../domain/types.js';

export interface InventorySnapshot {
  asOf: IsoDate;
  /** Items held for resale. This is what belongs on Schedule C. */
  inventoryCount: number;
  inventoryBasisCents: Cents;
  /** Items held as investments rather than stock in trade, tracked separately. */
  investmentCount: number;
  investmentBasisCents: Cents;
  /** Estimated market value of everything on hand, for insurance and planning. */
  estimatedValueCents: Cents;
  /** Items with no basis recorded, which usually means a data-entry gap. */
  zeroBasisCount: number;
}

/**
 * What was on hand at the close of business on `asOf`.
 *
 * "On hand" means acquired on or before the date and not yet sold, opened or
 * withdrawn. Items at the grader still count — they are still owned, just not
 * in the room.
 */
export function inventoryAsOf(asOf: IsoDate, db: Db = getDb()): InventorySnapshot {
  const rows = db.prepare(`
    SELECT holding_intent, basis_cents, estimated_value_cents, quantity
    FROM inventory_items
    WHERE acquired_on <= @asOf
      AND status IN ('on-hand', 'listed', 'at-grading')
  `).all({ asOf }) as Array<{
    holding_intent: HoldingIntent;
    basis_cents: number;
    estimated_value_cents: number | null;
    quantity: number;
  }>;

  const inventory = rows.filter((r) => r.holding_intent === 'inventory');
  const investment = rows.filter((r) => r.holding_intent === 'investment');

  return {
    asOf,
    inventoryCount: inventory.length,
    inventoryBasisCents: sum(inventory.map((r) => r.basis_cents)),
    investmentCount: investment.length,
    investmentBasisCents: sum(investment.map((r) => r.basis_cents)),
    estimatedValueCents: sum(rows.map((r) => r.estimated_value_cents ?? 0)),
    zeroBasisCount: rows.filter((r) => r.basis_cents === 0).length,
  };
}

/**
 * Beginning-of-year inventory.
 *
 * Reconstructed as "what was on hand the day before the year started", which is
 * only accurate if the books go back that far. A first year of trading
 * correctly reports zero.
 */
export function beginningInventory(year: number, db: Db = getDb()): InventorySnapshot {
  return inventoryAsOf(`${year - 1}-12-31`, db);
}

export function endingInventory(year: number, db: Db = getDb()): InventorySnapshot {
  return inventoryAsOf(`${year}-12-31`, db);
}
