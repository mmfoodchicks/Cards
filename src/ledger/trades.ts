/**
 * Trades — swapping cards for cards.
 *
 * THE THING PEOPLE GET WRONG: a trade is a taxable event. No money changed
 * hands, so it feels like nothing happened, and that intuition is expensive.
 *
 * Treas. Reg. 1.1001-1(a): "the gain or loss realized from the conversion of
 * property into cash, OR FROM THE EXCHANGE OF PROPERTY FOR OTHER PROPERTY
 * differing materially either in kind or in extent, is treated as income or as
 * loss sustained." And the amount realized "is the sum of any money received
 * plus THE FAIR MARKET VALUE OF ANY PROPERTY (other than money) received."
 *
 * So trading a card worth $750 with $50 of basis for two boxes is a $700 gain,
 * recognised on the day of the trade, whether or not you ever sell the boxes.
 *
 * AND NO, SECTION 1031 DOES NOT SAVE YOU. Like-kind exchange treatment was
 * limited to REAL PROPERTY by the 2017 Act, for exchanges completed after
 * 31 December 2017. IRC 1031(a)(1) now reads "on the exchange of real property
 * held for productive use in a trade or business or for investment... solely
 * for real property of like kind". Cards are not real property. There is no
 * deferral available, and the old "trades aren't taxable" folklore predates the
 * change by design.
 *
 * WHAT YOU GET BACK. The property you receive takes a basis equal to its fair
 * market value — you paid for it with something worth that much. So the two
 * boxes come in at their FMV, and that is the cost that gets allocated across
 * the cards when you open them.
 *
 * HOW THIS IS MODELLED. A trade is recorded as a disposition AND an acquisition
 * in one transaction, because doing only half of it is how the books go wrong:
 * record the boxes and forget the card, and the card sits in inventory forever
 * while the gain never appears. Reusing the sale and purchase machinery means
 * the trade flows into cost of goods sold, capital gains, and the Schedule C
 * worksheet through exactly the same paths as everything else.
 */

import type { Cents } from '../domain/money.js';
import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import { createSale, getItem, type SaleLineInput } from '../db/repos.js';
import { recordPurchase, type PurchaseItemInput } from './purchases.js';
import type { InventoryItem, IsoDate } from '../domain/types.js';

export class TradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradeError';
  }
}

export interface TradeInput {
  tradedOn: IsoDate;
  /** Item ids you are giving away. */
  givenUpItemIds: number[];
  /** What you got, each with the fair market value you are assigning to it. */
  received: Array<PurchaseItemInput & { fairMarketValueCents: Cents }>;
  /** Who you traded with, for the record. */
  counterparty?: string | null;
  /** Cash you also paid (positive) or received (negative), if the trade was uneven. */
  cashAdjustmentCents?: Cents;
  notes?: string | null;
}

export interface TradeResult {
  saleId: number;
  lotId: number;
  /** Fair market value of everything received — the amount realized. */
  amountRealizedCents: Cents;
  /** Total basis of what you handed over. */
  basisGivenUpCents: Cents;
  /** The taxable gain, recognised on the day of the trade. */
  gainCents: Cents;
  givenUp: InventoryItem[];
  receivedItems: InventoryItem[];
  /** Plain-language account of what just happened, for the confirmation screen. */
  explanation: string[];
  warnings: string[];
}

export function recordTrade(input: TradeInput, db: Db = getDb()): TradeResult {
  if (input.givenUpItemIds.length === 0) {
    throw new TradeError('A trade needs at least one item going out, or it is just a purchase.');
  }
  if (input.received.length === 0) {
    throw new TradeError('A trade needs at least one item coming in, or it is just a disposal.');
  }

  const givenUp: InventoryItem[] = [];
  for (const id of input.givenUpItemIds) {
    const item = getItem(id, db);
    if (!item) throw new TradeError(`No item with id ${id}.`);
    if (item.status === 'sold') throw new TradeError(`"${item.description}" has already been disposed of.`);
    givenUp.push(item);
  }

  for (const r of input.received) {
    if (r.fairMarketValueCents <= 0) {
      throw new TradeError(
        `"${r.description}" needs a fair market value. What you receive is what measures the gain, so a ` +
          'trade cannot be recorded without it.',
      );
    }
  }

  const cash = input.cashAdjustmentCents ?? 0;
  const fmvReceived = sum(input.received.map((r) => r.fairMarketValueCents));

  // Amount realized is the value of what came in, less any cash you also handed
  // over to balance the trade. Cash you RECEIVED adds to it.
  const amountRealized = fmvReceived - cash;
  const basisGivenUp = sum(givenUp.map((i) => i.basisCents));
  const gain = amountRealized - basisGivenUp;

  const explanation: string[] = [];
  const warnings: string[] = [];

  const anyInvestment = givenUp.some((i) => i.holdingIntent === 'investment');
  const anyInventory = givenUp.some((i) => i.holdingIntent === 'inventory');

  const run = db.transaction(() => {
    // The disposition. Recorded as a sale whose proceeds happen to be property,
    // so it reaches cost of goods sold and capital gains by the normal route.
    const lines: SaleLineInput[] = allocateProceeds(givenUp, amountRealized);
    const sale = createSale(
      {
        soldOn: input.tradedOn,
        channel: 'trade',
        orderRef: null,
        buyerState: null,
        grossCents: Math.max(0, amountRealized),
        shippingChargedCents: 0,
        salesTaxCollectedCents: 0,
        salesTaxRemittedByPlatform: false,
        platformFeeCents: 0,
        paymentProcessingFeeCents: 0,
        shippingCostCents: 0,
        otherFeeCents: 0,
        refundedCents: 0,
        notes: tradeNote('out', input),
      },
      lines,
      db,
    );

    // The acquisition. What you received is bought for what it is worth, so the
    // lot total is the fair market value received plus any cash you added.
    const purchase = recordPurchase(
      {
        lot: {
          purchasedOn: input.tradedOn,
          vendor: input.counterparty ?? 'trade',
          channel: 'trade',
          description: `Received in trade on ${input.tradedOn}`,
          subtotalCents: fmvReceived,
          shippingCents: 0,
          taxCents: 0,
          feesCents: 0,
          paymentMethod: null,
          resaleExemptionUsed: false,
          notes: tradeNote('in', input),
          receiptPath: null,
        },
        items: input.received.map((r) => ({
          ...r,
          // Each item's own fair market value is both its basis and its weight,
          // so the allocation lands exactly on the values entered.
          estimatedValueCents: r.fairMarketValueCents,
        })),
        allocationMethod: 'relative-fmv',
      },
      db,
    );

    return { saleId: sale.id, lotId: purchase.lotId, receivedItems: purchase.items };
  });

  const { saleId, lotId, receivedItems } = run();

  explanation.push(
    `You handed over ${givenUp.length} item${givenUp.length === 1 ? '' : 's'} carrying ${fmt(basisGivenUp)} of ` +
      `cost, and received property worth ${fmt(fmvReceived)}${cash !== 0 ? ` plus ${fmt(Math.abs(cash))} of cash ${cash > 0 ? 'paid' : 'received'}` : ''}.`,
  );
  explanation.push(
    `That is a realised ${gain >= 0 ? 'gain' : 'loss'} of ${fmt(Math.abs(gain))}, taxable in ${input.tradedOn.slice(0, 4)} — ` +
      'on the day of the trade, not when you eventually sell what you got.',
  );
  explanation.push(
    `The items you received come in at ${fmt(fmvReceived)} of basis, which is what they were worth. That is ` +
      'the cost that gets spread across the cards when you open them.',
  );

  warnings.push(
    'No money changed hands, but tax is still due. Section 1031 like-kind exchange was limited to REAL ' +
      'property in 2017 and does not cover cards — so there is no deferral available here.',
  );

  if (anyInvestment && anyInventory) {
    warnings.push(
      'This trade mixes a personal collection item with business inventory. They are taxed differently — ' +
        'capital gain versus ordinary income plus self-employment tax — so consider recording them as two ' +
        'separate trades rather than one.',
    );
  } else if (anyInvestment) {
    warnings.push(
      'What you gave up was held as a personal collection piece, so this is a capital gain on Form 8949, ' +
        'with no self-employment tax. Keep the evidence of what the cards you received were worth.',
    );
  } else {
    warnings.push(
      'What you gave up was business inventory, so the gain is ordinary income on Schedule C and carries ' +
        'self-employment tax.',
    );
  }

  warnings.push(
    'The fair market value you assign IS the tax figure. Write down where it came from — a sold comp, the ' +
      'other side\'s asking price, a price guide on the day — because it is the number that would be ' +
      'questioned.',
  );

  return {
    saleId,
    lotId,
    amountRealizedCents: amountRealized,
    basisGivenUpCents: basisGivenUp,
    gainCents: gain,
    givenUp,
    receivedItems,
    explanation,
    warnings,
  };
}

/**
 * Split the amount realized across the items handed over.
 *
 * By relative basis when there is any, so a trade of several cards attributes
 * proceeds sensibly; evenly when everything has zero basis. The parts always
 * foot to the total.
 */
function allocateProceeds(items: readonly InventoryItem[], amountRealized: Cents): SaleLineInput[] {
  const total = Math.max(0, amountRealized);
  const basisTotal = sum(items.map((i) => i.basisCents));

  const weights = basisTotal > 0 ? items.map((i) => i.basisCents) : items.map(() => 1);
  const weightTotal = sum(weights);

  // Largest remainder, so the parts add up to the total exactly.
  const exact = weights.map((w) => (total * w) / weightTotal);
  const floors = exact.map(Math.floor);
  let remainder = total - sum(floors);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const parts = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k += 1, remainder -= 1) {
    parts[order[k]!.i] = parts[order[k]!.i]! + 1;
  }

  return items.map((item, i) => ({
    itemId: item.id,
    quantity: item.quantity,
    allocatedGrossCents: parts[i]!,
    cogsCents: item.basisCents,
  }));
}

function tradeNote(direction: 'in' | 'out', input: TradeInput): string {
  const who = input.counterparty ? ` with ${input.counterparty}` : '';
  const base = direction === 'out'
    ? `Traded away${who} on ${input.tradedOn}. Proceeds are the fair market value of what was received.`
    : `Received in trade${who} on ${input.tradedOn}. Basis is fair market value at the date of the trade.`;
  return input.notes ? `${base} ${input.notes}` : base;
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function fmt(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
