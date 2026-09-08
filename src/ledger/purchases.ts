/**
 * Recording purchases.
 *
 * A purchase is a lot (what you paid) plus the items it produced (what you got).
 * The lot's total cost is allocated across the items so that the sum of item
 * basis always equals what left your bank account. That invariant is enforced
 * here rather than trusted, because once it breaks, cost of goods sold stops
 * tying to purchases and the books cannot be defended.
 */

import { sum, type Cents } from '../domain/money.js';
import type { BasisAllocationMethod, InventoryItem, IsoDate, ItemKind, HoldingIntent } from '../domain/types.js';
import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import { createItem, createLot, itemsInLot, updateItem, type LotInput } from '../db/repos.js';
import { allocateBasis, lotTotalCents, type Allocation } from './basis.js';

export interface PurchaseItemInput {
  description: string;
  kind: ItemKind;
  holdingIntent?: HoldingIntent;
  quantity?: number;
  category?: string | null;
  setName?: string | null;
  year?: number | null;
  estimatedValueCents?: Cents | null;
  location?: string | null;
  notes?: string | null;
  /** Only used when the allocation method is `manual`. */
  manualBasisCents?: Cents;
}

export interface RecordPurchaseInput {
  lot: Omit<LotInput, 'createdAt'>;
  items: PurchaseItemInput[];
  allocationMethod?: BasisAllocationMethod;
}

export interface RecordPurchaseResult {
  lotId: number;
  items: InventoryItem[];
  allocation: Allocation;
  totalCents: Cents;
}

export function recordPurchase(input: RecordPurchaseInput, db: Db = getDb()): RecordPurchaseResult {
  if (input.items.length === 0) {
    throw new Error('A purchase needs at least one item, or there is nothing to allocate its cost to.');
  }

  const total = lotTotalCents(input.lot);
  const method = input.allocationMethod ?? 'relative-fmv';

  const allocation = allocateBasis({
    totalCents: total,
    method,
    asOf: input.lot.purchasedOn,
    items: input.items.map((item, index) => ({
      ref: index,
      estimatedValueCents: item.estimatedValueCents ?? null,
      estimatedValueAsOf: null,
      quantity: item.quantity ?? 1,
      manualBasisCents: item.manualBasisCents,
    })),
  });

  const run = db.transaction(() => {
    const lot = createLot(input.lot, db);
    const created: InventoryItem[] = [];

    for (const [index, item] of input.items.entries()) {
      const basis = allocation.results[index]!.basisCents;
      created.push(
        createItem(
          {
            lotId: lot.id,
            parentItemId: null,
            // A value given at purchase IS fair market value at the time of
            // purchase, which is exactly what Reg. 1.61-6 asks for.
            estimatedValueAsOf: item.estimatedValueCents == null ? null : input.lot.purchasedOn,
            estimatedValueSource: item.estimatedValueCents == null ? null : 'entered when the purchase was recorded',
            kind: item.kind,
            holdingIntent: item.holdingIntent ?? 'inventory',
            description: item.description,
            category: item.category ?? null,
            setName: item.setName ?? null,
            year: item.year ?? null,
            quantity: item.quantity ?? 1,
            acquiredOn: input.lot.purchasedOn,
            basisCents: basis,
            estimatedValueCents: item.estimatedValueCents ?? null,
            status: 'on-hand',
            gradedBy: null,
            grade: null,
            certNumber: null,
            location: item.location ?? null,
            notes: item.notes ?? null,
          },
          db,
        ),
      );
    }
    return { lotId: lot.id, items: created };
  });

  const { lotId, items } = run();

  // Belt and braces: the allocator guarantees this, but a mistake here would be
  // invisible until year end, so it is checked at the point of writing.
  const stored = sum(items.map((i) => i.basisCents));
  if (stored !== total) {
    throw new Error(`Allocation did not tie: items total ${stored} cents but the purchase cost ${total} cents.`);
  }

  return { lotId, items, allocation, totalCents: total };
}

/**
 * Re-spread a lot's cost across the items bought in it.
 *
 * Needed when a value estimate was wrong or missing at entry time.
 *
 * Two limits, both deliberate:
 *
 *  - Only items bought DIRECTLY in the lot are touched. Cards that came out of
 *    an opened box already received their basis from that box, and pulling them
 *    into a lot-level reallocation would spread the same money twice. Use
 *    `reallocateOpening` to change how a box's cost was split.
 *  - Only items still on hand are moved. Once something has sold, its basis is
 *    already in cost of goods sold for a period that may have been reported to
 *    the IRS, and quietly changing it would make the return stop matching the
 *    books.
 */
export function reallocateLot(
  lotId: number,
  method: BasisAllocationMethod,
  db: Db = getDb(),
): { allocation: Allocation; skipped: InventoryItem[] } {
  const lot = db.prepare('SELECT * FROM purchase_lots WHERE id = ?').get(lotId) as
    | {
        subtotal_cents: number; shipping_cents: number; tax_cents: number; fees_cents: number;
        purchased_on: string;
      }
    | undefined;
  if (!lot) throw new Error(`Purchase ${lotId} does not exist.`);

  const all = itemsInLot(lotId, db);
  // Only the goods bought directly in this lot. Anything with a parent got its
  // basis from that parent, not from the lot.
  const direct = all.filter((i) => i.parentItemId === null);
  const settled = direct.filter((i) => i.status === 'sold' || i.status === 'opened');
  const open = direct.filter((i) => i.status !== 'sold' && i.status !== 'opened');

  if (open.length === 0) {
    throw new Error(
      'Everything bought in this purchase has already been sold or opened, so its cost is already recorded. ' +
        'Reallocating now would restate a period you may have already reported. ' +
        'To change how an opened box was split, reallocate the opening instead.',
    );
  }

  const lotTotal = lotTotalCents({
    subtotalCents: lot.subtotal_cents,
    shippingCents: lot.shipping_cents,
    taxCents: lot.tax_cents,
    feesCents: lot.fees_cents,
  });

  // What is left to spread is the lot total minus the basis already sitting
  // anywhere else in the lot. "Anywhere else" has to include the cards pulled
  // from an opened box: the box itself now shows zero basis because it handed
  // that money down to its contents, so subtracting only the box would hand the
  // same money out a second time.
  const openIds = new Set(open.map((i) => i.id));
  const spokenFor = sum(all.filter((i) => !openIds.has(i.id)).map((i) => i.basisCents));
  const total = lotTotal - spokenFor;

  if (total < 0) {
    throw new Error(
      `The items from this purchase already carry more basis (${spokenFor} cents) than the purchase cost ` +
        `(${lotTotal} cents). Fix the item basis figures before reallocating.`,
    );
  }

  // Reallocation is where a live price feed does real damage. The cost being
  // split was incurred on the purchase date, so values observed after it are
  // the wrong input — and the whole point of a comps lookup is to produce
  // values observed today.
  const allocation = allocateBasis({
    totalCents: total,
    method,
    asOf: lot.purchased_on,
    items: open.map((item) => ({
      ref: item.id,
      estimatedValueCents: item.estimatedValueCents,
      estimatedValueAsOf: item.estimatedValueAsOf,
      quantity: item.quantity,
      manualBasisCents: item.basisCents,
    })),
  });

  const run = db.transaction(() => {
    for (const result of allocation.results) {
      updateItem(Number(result.ref), { basisCents: result.basisCents }, 'Lot cost reallocated', db);
    }
  });
  run();

  return { allocation, skipped: settled };
}
