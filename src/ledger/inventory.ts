/**
 * Inventory movements: opening sealed product, and grading.
 *
 * Both are events where an item stops being the thing it was. A sealed box
 * becomes forty cards; a raw card comes back from PSA as a graded card worth
 * several times more. In both cases the cost has to follow the goods, and in
 * neither case is any cost created or destroyed.
 */

import { sum, type Cents } from '../domain/money.js';
import type { BasisAllocationMethod, InventoryItem, IsoDate } from '../domain/types.js';
import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import {
  createItem,
  getItem,
  getSubmission,
  markSubmissionReturned,
  recordOpening,
  submissionItems,
  updateItem,
  updateSubmissionItem,
} from '../db/repos.js';
import { allocateGradingCost, allocateOpening, type Allocation } from './basis.js';
import type { PurchaseItemInput } from './purchases.js';

export interface OpenSealedInput {
  itemId: number;
  openedOn: IsoDate;
  contents: PurchaseItemInput[];
  allocationMethod?: BasisAllocationMethod;
  notes?: string | null;
}

export interface OpenSealedResult {
  parentId: number;
  created: InventoryItem[];
  allocation: Allocation;
}

/**
 * Open a sealed item and record what came out of it.
 *
 * The box's entire basis moves to its contents. The box itself is kept, marked
 * `opened` with zero basis, so the history of where those cards came from
 * survives — which matters if anyone ever asks how a card with $0.02 of basis
 * came to be worth $2,600.
 */
export function openSealedItem(input: OpenSealedInput, db: Db = getDb()): OpenSealedResult {
  const parent = getItem(input.itemId, db);
  if (!parent) throw new Error(`Item ${input.itemId} does not exist.`);
  if (parent.status === 'opened') throw new Error(`"${parent.description}" has already been opened.`);
  if (parent.status === 'sold') throw new Error(`"${parent.description}" was sold; it cannot be opened.`);
  if (input.contents.length === 0) {
    throw new Error('Record what came out of the pack, or its cost would vanish from the books.');
  }

  const allocation = allocateOpening(
    parent.basisCents,
    input.contents.map((item, index) => ({
      ref: index,
      estimatedValueCents: item.estimatedValueCents ?? null,
      quantity: item.quantity ?? 1,
      manualBasisCents: item.manualBasisCents,
    })),
    input.allocationMethod ?? 'relative-fmv',
  );

  const run = db.transaction(() => {
    const created: InventoryItem[] = [];
    for (const [index, item] of input.contents.entries()) {
      created.push(
        createItem(
          {
            lotId: parent.lotId,
            parentItemId: parent.id,
            kind: item.kind ?? 'single',
            holdingIntent: item.holdingIntent ?? parent.holdingIntent,
            description: item.description,
            category: item.category ?? parent.category,
            setName: item.setName ?? parent.setName,
            year: item.year ?? parent.year,
            quantity: item.quantity ?? 1,
            // Cards pulled from a box were acquired when the box was bought,
            // not when it was opened. Holding period runs from acquisition.
            acquiredOn: parent.acquiredOn,
            basisCents: allocation.results[index]!.basisCents,
            estimatedValueCents: item.estimatedValueCents ?? null,
            status: 'on-hand',
            gradedBy: null,
            grade: null,
            certNumber: null,
            location: item.location ?? parent.location,
            notes: item.notes ?? null,
          },
          db,
        ),
      );
    }

    // The box's cost now lives in its contents.
    updateItem(parent.id, { status: 'opened', basisCents: 0 }, `Opened on ${input.openedOn}`, db);
    recordOpening(parent.id, input.openedOn, allocation.method, input.notes ?? null, db);
    return created;
  });

  const created = run();

  const moved = sum(created.map((i) => i.basisCents));
  if (moved !== parent.basisCents) {
    throw new Error(`Opening did not tie: moved ${moved} cents from a basis of ${parent.basisCents} cents.`);
  }

  return { parentId: parent.id, created, allocation };
}

export interface ReceiveGradedInput {
  submissionId: number;
  returnedOn: IsoDate;
  results: Array<{ itemId: number; grade: string | null; certNumber?: string | null; estimatedValueCents?: Cents | null }>;
  /** Graders bill per card, so an even split matches the invoice by default. */
  allocationMethod?: 'equal' | 'relative-fmv';
}

/**
 * Record cards coming back from the grader.
 *
 * The submission's costs are added to the basis of the cards that were in it.
 * That is the treatment this app uses: grading is money spent on a specific
 * item held for resale, so it attaches to that item and reduces the gain when
 * it sells, rather than being deducted in the year it was paid.
 *
 * A CPA may reasonably prefer to expense grading currently for a dealer. The
 * allocation is recorded per card so it can be unwound if so.
 */
export function receiveGradedCards(input: ReceiveGradedInput, db: Db = getDb()): {
  allocation: Allocation;
  updated: InventoryItem[];
} {
  const submission = getSubmission(input.submissionId, db);
  if (!submission) throw new Error(`Grading submission ${input.submissionId} does not exist.`);

  const linked = submissionItems(input.submissionId, db);
  if (linked.length === 0) throw new Error('That submission has no cards recorded against it.');

  const items = linked
    .map((l) => getItem(l.itemId, db))
    .filter((i): i is InventoryItem => i !== null);

  const allocation = allocateGradingCost({
    submission: {
      feeCents: submission.feeCents,
      shippingToCents: submission.shippingToCents,
      shippingBackCents: submission.shippingBackCents,
      insuranceCents: submission.insuranceCents,
    },
    items: items.map((item) => ({
      ref: item.id,
      estimatedValueCents: item.estimatedValueCents,
      quantity: 1,
    })),
    method: input.allocationMethod,
  });

  const resultByItem = new Map(input.results.map((r) => [r.itemId, r]));

  const run = db.transaction(() => {
    const updated: InventoryItem[] = [];
    for (const result of allocation.results) {
      const itemId = Number(result.ref);
      const item = items.find((i) => i.id === itemId)!;
      const outcome = resultByItem.get(itemId);

      const next = updateItem(
        itemId,
        {
          basisCents: item.basisCents + result.basisCents,
          status: 'on-hand',
          gradedBy: submission.grader,
          grade: outcome?.grade ?? null,
          certNumber: outcome?.certNumber ?? null,
          estimatedValueCents:
            outcome?.estimatedValueCents !== undefined ? outcome.estimatedValueCents : item.estimatedValueCents,
        },
        `Returned from ${submission.grader}; grading cost added to basis`,
        db,
      );
      if (next) updated.push(next);

      updateSubmissionItem(
        input.submissionId,
        itemId,
        {
          resultGrade: outcome?.grade ?? null,
          certNumber: outcome?.certNumber ?? null,
          allocatedCostCents: result.basisCents,
        },
        db,
      );
    }
    markSubmissionReturned(input.submissionId, input.returnedOn, db);
    return updated;
  });

  return { allocation, updated: run() };
}

/**
 * Move an item out of the business into personal use.
 *
 * This is not a sale and produces no income, but it does have to come out of
 * inventory — Schedule C line 36 is explicitly "purchases LESS cost of items
 * withdrawn for personal use". Silently leaving it in inventory would overstate
 * cost of goods sold.
 */
export function withdrawToPersonalUse(itemId: number, reason: string, db: Db = getDb()): InventoryItem | null {
  const item = getItem(itemId, db);
  if (!item) return null;
  if (item.status === 'sold') throw new Error('That item was sold; it cannot be withdrawn.');
  return updateItem(itemId, { status: 'personal-use' }, `Withdrawn to personal use: ${reason}`, db);
}

/**
 * Re-spread an opened box's cost across the cards that came out of it.
 *
 * Values are often unknown at the moment of opening — you know you pulled a
 * Charizard, but not yet what it books at. This lets the split be corrected
 * once real values are known, without disturbing anything else in the lot.
 *
 * Cards already sold keep the basis they were sold with, for the same reason a
 * lot cannot be reallocated after the fact: their cost is already in a reported
 * period.
 */
export function reallocateOpening(
  parentItemId: number,
  method: BasisAllocationMethod,
  db: Db = getDb(),
): { allocation: Allocation; skipped: InventoryItem[] } {
  const parent = getItem(parentItemId, db);
  if (!parent) throw new Error(`Item ${parentItemId} does not exist.`);

  const children = (db
    .prepare('SELECT id FROM inventory_items WHERE parent_item_id = ? ORDER BY id')
    .all(parentItemId) as Array<{ id: number }>)
    .map((r) => getItem(r.id, db))
    .filter((i): i is InventoryItem => i !== null);

  if (children.length === 0) throw new Error('That item has no recorded contents to reallocate.');

  const settled = children.filter((i) => i.status === 'sold' || i.status === 'opened');
  const open = children.filter((i) => i.status !== 'sold' && i.status !== 'opened');
  if (open.length === 0) {
    throw new Error('Every card from this pack has already been sold, so its cost is already recorded.');
  }

  const originalTotal = sum(children.map((i) => i.basisCents));
  const remaining = originalTotal - sum(settled.map((i) => i.basisCents));

  const allocation = allocateOpening(
    remaining,
    open.map((item) => ({
      ref: item.id,
      estimatedValueCents: item.estimatedValueCents,
      quantity: item.quantity,
      manualBasisCents: item.basisCents,
    })),
    method,
  );

  const run = db.transaction(() => {
    for (const result of allocation.results) {
      updateItem(Number(result.ref), { basisCents: result.basisCents }, 'Pack contents reallocated', db);
    }
  });
  run();

  return { allocation, skipped: settled };
}
