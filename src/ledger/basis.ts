/**
 * Cost basis allocation.
 *
 * This is the part of card-business bookkeeping that has no obvious answer and
 * that most spreadsheets get wrong.
 *
 * You pay $161.64 for a sealed booster box. You open it and now you hold 360
 * cards: one worth $2,600, a handful worth $5-$40, and roughly 340 worth
 * essentially nothing. What is the cost basis of the $2,600 card?
 *
 * It is NOT $161.64 (that would deduct the whole box against one sale and leave
 * the rest of the cards with no cost at all). It is NOT $0.45 either — that is
 * an even split, which treats a chase card and a common as equally costly.
 *
 * The general rule for property acquired in a single purchase is that the cost
 * is apportioned among the items in proportion to their RELATIVE FAIR MARKET
 * VALUES. That is the rule this module implements as its default, because it is
 * what an accountant will expect to see and what stands up if the return is
 * examined.
 *
 * Consequences worth understanding before relying on it:
 *
 *   - The chase card carries almost all of the basis, so selling it produces
 *     little taxable gain, while the commons carry almost none and are close to
 *     pure profit when they sell.
 *   - Total income over the life of the box is IDENTICAL under any allocation
 *     method. What changes is WHICH YEAR the income lands in, and that matters
 *     when a card sits unsold across a year end.
 *   - Allocation is done at the moment of opening, using values as of that
 *     date. Later price movement does not retroactively change basis.
 *
 * None of this is tax advice. The method used is recorded on every allocation so
 * a CPA can see what was done and change it if they disagree.
 */

import { allocate, sum, type Cents } from '../domain/money.js';
import type { BasisAllocationMethod } from '../domain/types.js';

export interface AllocationInput {
  /** Total cost to spread, in cents. */
  totalCents: Cents;
  items: AllocationItem[];
  method: BasisAllocationMethod;
}

export interface AllocationItem {
  /** Caller's identifier, echoed back on the result. */
  ref: string | number;
  /**
   * Fair market value at the allocation date, used as the weight under
   * relative-FMV. null means unknown.
   */
  estimatedValueCents: Cents | null;
  /** Units, for supplies bought in bulk. Cards are 1. */
  quantity?: number;
  /** Explicit basis, used only under the `manual` method. */
  manualBasisCents?: Cents;
}

export interface AllocationResult {
  ref: string | number;
  basisCents: Cents;
  /** Share of the total this item received, for display. */
  share: number;
}

export interface Allocation {
  method: BasisAllocationMethod;
  results: AllocationResult[];
  totalCents: Cents;
  /** Anything the user should know about how this was worked out. */
  notes: string[];
}

export class AllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllocationError';
  }
}

/**
 * Spread a purchase cost across the items it bought.
 *
 * Guarantees the allocated amounts sum EXACTLY to the total, to the cent. A
 * ledger where cost of goods sold does not tie back to purchases is a ledger
 * that cannot be defended.
 */
export function allocateBasis(input: AllocationInput): Allocation {
  const { totalCents, items, method } = input;
  const notes: string[] = [];

  if (items.length === 0) {
    throw new AllocationError('Cannot allocate a cost across zero items.');
  }

  if (method === 'manual') {
    const manual = items.map((item) => item.manualBasisCents ?? 0);
    const manualTotal = sum(manual);
    if (manualTotal !== totalCents) {
      throw new AllocationError(
        `Manual basis figures total ${manualTotal} cents but the purchase cost ${totalCents} cents. ` +
          'They must match exactly, or cost of goods sold will not tie to purchases.',
      );
    }
    return {
      method,
      totalCents,
      notes: ['Basis entered manually.'],
      results: items.map((item, i) => ({
        ref: item.ref,
        basisCents: manual[i]!,
        share: totalCents === 0 ? 0 : manual[i]! / totalCents,
      })),
    };
  }

  let weights: number[];

  if (method === 'relative-fmv') {
    const valued = items.filter((i) => i.estimatedValueCents !== null && i.estimatedValueCents > 0);

    if (valued.length === 0) {
      // Nothing has a value on it, so relative value is meaningless. Falling
      // back is better than refusing, but the user needs to know the result is
      // an even split wearing a different label.
      notes.push(
        'No item had an estimated value, so the cost was split evenly instead. ' +
          'Add market values to allocate by relative value.',
      );
      weights = items.map((i) => i.quantity ?? 1);
    } else {
      if (valued.length < items.length) {
        const missing = items.length - valued.length;
        notes.push(
          `${missing} item${missing === 1 ? '' : 's'} had no estimated value and received zero basis. ` +
            'That is the correct result if they really are worthless, but check it: ' +
            'an item with zero basis is entirely taxable profit when it sells.',
        );
      }
      weights = items.map((i) => (i.estimatedValueCents ?? 0) * (i.quantity ?? 1));
      notes.push('Cost allocated in proportion to each item’s fair market value at the time of purchase.');
    }
  } else {
    weights = items.map((i) => i.quantity ?? 1);
    notes.push('Cost split evenly across items.');
  }

  const amounts = allocate(totalCents, weights);
  const weightTotal = weights.reduce((a, b) => a + b, 0);

  return {
    method,
    totalCents,
    notes,
    results: items.map((item, i) => ({
      ref: item.ref,
      basisCents: amounts[i]!,
      share: weightTotal === 0 ? 0 : weights[i]! / weightTotal,
    })),
  };
}

/**
 * Total cost of a purchase lot.
 *
 * Inbound shipping, non-recoverable sales tax and buyer's premiums are part of
 * what the goods cost you, not separate deductible expenses. Treating shipping
 * as an expense instead would deduct it immediately rather than when the item
 * sells, which overstates this year's costs and understates next year's.
 */
export function lotTotalCents(lot: {
  subtotalCents: Cents;
  shippingCents: Cents;
  taxCents: Cents;
  feesCents: Cents;
}): Cents {
  return lot.subtotalCents + lot.shippingCents + lot.taxCents + lot.feesCents;
}

export interface GradingAllocationInput {
  submission: {
    feeCents: Cents;
    shippingToCents: Cents;
    shippingBackCents: Cents;
    insuranceCents: Cents;
  };
  items: AllocationItem[];
  /**
   * Graders price per card by declared value tier, so an even split matches how
   * the bill was actually incurred. Allocating by value instead is available for
   * submissions where one card drove the cost.
   */
  method?: 'equal' | 'relative-fmv';
}

/**
 * Spread the cost of a grading submission across the cards in it.
 *
 * Grading is treated here as a cost that ATTACHES TO THE CARD rather than a
 * period expense, because it is money spent to improve a specific item held for
 * resale, and because the graded card is what eventually sells. That means it
 * reduces gain when the card sells rather than deducting this year.
 *
 * FOR A CARD HELD AS INVESTMENT this is not a choice at all, and that leg is
 * airtight. Reg. 1.212-1(k) makes costs of "developing or improving property"
 * part of the cost of that property rather than a deductible expense, and even
 * if you disagreed, IRC 67(h) — made permanent by the OBBB Act — disallows
 * every miscellaneous itemised deduction outright. So the ONLY route to any
 * benefit is basis. A $100 card with $25 of grading that sells for $300 is
 * $175 of gain, not $200.
 *
 * FOR A DEALER it is a timing question, and genuinely unsettled. UNICAP is off
 * (263A(i) exempts anyone under the 448(c) gross receipts test, which for 2026
 * is $32,000,000), and 471(c) lets a small business taxpayer conform to its own
 * books. So nothing affirmatively FORCES capitalisation — but nothing permits
 * current expensing either. No ruling, regulation or case addresses grading,
 * encapsulation or authentication fees for any collectible.
 *
 * This app capitalises, deliberately, and does not offer a switch. Capitalising
 * is the conservative position, it is the only workable method when a card may
 * sell in a later year, and it matches income with expense. Current expensing
 * is arguable rather than settled, works only if the books genuinely do it, and
 * switching either way is an accounting method change. A first-year sole
 * proprietor is not well served by a toggle between "safe" and "arguable"; if
 * you want the other treatment, that is a conversation with a CPA who will also
 * make your books match.
 */
export function allocateGradingCost(input: GradingAllocationInput): Allocation {
  const { submission, items } = input;
  const total =
    submission.feeCents + submission.shippingToCents + submission.shippingBackCents + submission.insuranceCents;

  const allocation = allocateBasis({
    totalCents: total,
    items,
    method: input.method === 'relative-fmv' ? 'relative-fmv' : 'equal',
  });

  return {
    ...allocation,
    notes: [
      'Grading fees, shipping both ways and insurance are added to the cost basis of the cards, ' +
        'so they reduce the gain when a card sells rather than being deducted now.',
      ...allocation.notes,
    ],
  };
}

/**
 * Reallocate a parent item's basis to the items that came out of it.
 *
 * Used when a sealed box is opened. The parent's entire basis moves to its
 * children — nothing is created or destroyed, so the ledger still foots.
 */
export function allocateOpening(
  parentBasisCents: Cents,
  contents: AllocationItem[],
  method: BasisAllocationMethod = 'relative-fmv',
): Allocation {
  if (contents.length === 0) {
    throw new AllocationError(
      'Opening a sealed item requires recording what came out of it, or its cost would vanish from the books.',
    );
  }
  const allocation = allocateBasis({ totalCents: parentBasisCents, items: contents, method });
  return {
    ...allocation,
    notes: [
      `The sealed item’s entire cost basis was moved to the ${contents.length} item${contents.length === 1 ? '' : 's'} it contained.`,
      ...allocation.notes,
    ],
  };
}
