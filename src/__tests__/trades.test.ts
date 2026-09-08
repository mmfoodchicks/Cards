import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, type Db } from '../db/index.js';
import { recordPurchase } from '../ledger/purchases.js';
import { recordTrade, TradeError } from '../ledger/trades.js';
import { getItem, listItems } from '../db/repos.js';
import { capitalGainsForYear } from '../reports/capitalGains.js';
import { profitAndLoss } from '../reports/profitLoss.js';

let db: Db;
beforeEach(() => { db = openMemoryDb(); });

/** Buys one card for `cost` cents and returns its item id. */
function buyCard(cost: number, intent: 'inventory' | 'investment' = 'inventory', on = '2026-02-01'): number {
  const r = recordPurchase({
    lot: {
      purchasedOn: on, vendor: 'shop', channel: 'card-show', description: 'a card',
      subtotalCents: cost, shippingCents: 0, taxCents: 0, feesCents: 0,
      paymentMethod: null, resaleExemptionUsed: false, notes: null, receiptPath: null,
    },
    items: [{ description: 'Prizm Caleb Williams RC', kind: 'single', holdingIntent: intent }],
  }, db);
  return r.items[0]!.id;
}

const twoJumboBoxes = [
  { description: 'Jumbo box #1', kind: 'sealed-to-open' as const, fairMarketValueCents: 37500 },
  { description: 'Jumbo box #2', kind: 'sealed-to-open' as const, fairMarketValueCents: 37500 },
];

describe('trading cards for cards', () => {
  it('recognises gain on the day of the trade, though no money moved', () => {
    // A $750 card with $50 of basis, traded for two boxes worth $375 each.
    const id = buyCard(5000);
    const r = recordTrade({ tradedOn: '2026-09-08', givenUpItemIds: [id], received: twoJumboBoxes }, db);

    expect(r.amountRealizedCents).toBe(75000);
    expect(r.basisGivenUpCents).toBe(5000);
    expect(r.gainCents).toBe(70000);
    expect(r.explanation.join(' ')).toMatch(/taxable in 2026 — on the day of the trade/i);
  });

  it('says plainly that section 1031 does not help', () => {
    const id = buyCard(5000);
    const r = recordTrade({ tradedOn: '2026-09-08', givenUpItemIds: [id], received: twoJumboBoxes }, db);
    // Like-kind exchange was limited to real property in 2017.
    expect(r.warnings.join(' ')).toMatch(/1031.*limited to REAL property/is);
    expect(r.warnings.join(' ')).toMatch(/no deferral/i);
  });

  it('gives what you received a basis equal to its fair market value', () => {
    const id = buyCard(5000);
    const r = recordTrade({ tradedOn: '2026-09-08', givenUpItemIds: [id], received: twoJumboBoxes }, db);

    expect(r.receivedItems).toHaveLength(2);
    for (const box of r.receivedItems) expect(box.basisCents).toBe(37500);
    // Total basis in equals total value received — nothing created, nothing lost.
    expect(r.receivedItems.reduce((a, b) => a + b.basisCents, 0)).toBe(75000);
  });

  it('takes the traded card out of inventory, so it cannot be sold twice', () => {
    const id = buyCard(5000);
    recordTrade({ tradedOn: '2026-09-08', givenUpItemIds: [id], received: twoJumboBoxes }, db);

    expect(getItem(id, db)!.status).toBe('sold');
    const onHand = listItems({ status: ['on-hand'] }, db).items.map((i) => i.description);
    expect(onHand).not.toContain('Prizm Caleb Williams RC');
    expect(onHand).toContain('Jumbo box #1');
  });

  it('flows into Schedule C when the card was inventory', () => {
    const id = buyCard(5000, 'inventory');
    recordTrade({ tradedOn: '2026-09-08', givenUpItemIds: [id], received: twoJumboBoxes }, db);

    const pl = profitAndLoss(2026, {}, db);
    // The trade is receipts of $750 with $50 of cost relieved.
    expect(pl.grossReceiptsCents).toBe(75000);
    expect(pl.cogs.cogsFromSalesCents).toBe(5000);
  });

  it('flows into capital gains when the card was a collection piece', () => {
    const id = buyCard(5000, 'investment', '2019-04-02');
    recordTrade({ tradedOn: '2026-09-08', givenUpItemIds: [id], received: twoJumboBoxes }, db);

    const cg = capitalGainsForYear(2026, db);
    expect(cg.dispositions).toHaveLength(1);
    expect(cg.dispositions[0]!.proceedsCents).toBe(75000);
    expect(cg.dispositions[0]!.gainCents).toBe(70000);
    expect(cg.longTermGainCents).toBe(70000);
    // Held since 2019, so it gets the collectibles rate rather than ordinary.
    expect(cg.dispositions[0]!.term).toBe('long-term');
  });

  it('keeps it out of Schedule C when it was a collection piece', () => {
    const id = buyCard(5000, 'investment', '2019-04-02');
    recordTrade({ tradedOn: '2026-09-08', givenUpItemIds: [id], received: twoJumboBoxes }, db);
    // A personal disposition is not business receipts.
    expect(profitAndLoss(2026, {}, db).grossReceiptsCents).toBe(0);
  });

  it('handles cash on top of the cards', () => {
    // Traded the card AND paid $100 to make up the difference.
    const id = buyCard(5000);
    const r = recordTrade({
      tradedOn: '2026-09-08', givenUpItemIds: [id], received: twoJumboBoxes, cashAdjustmentCents: 10000,
    }, db);

    // Paying cash reduces what the card itself realised.
    expect(r.amountRealizedCents).toBe(65000);
    expect(r.gainCents).toBe(60000);
    // But the boxes still cost their full value.
    expect(r.receivedItems.reduce((a, b) => a + b.basisCents, 0)).toBe(75000);
  });

  it('splits proceeds across several cards by their relative cost', () => {
    const a = buyCard(9000);
    const b = buyCard(1000);
    const r = recordTrade({
      tradedOn: '2026-09-08', givenUpItemIds: [a, b],
      received: [{ description: 'One box', kind: 'sealed-to-open', fairMarketValueCents: 20000 }],
    }, db);
    expect(r.gainCents).toBe(10000);
    expect(profitAndLoss(2026, {}, db).grossReceiptsCents).toBe(20000);
  });

  it('warns when a trade mixes collection and inventory', () => {
    const a = buyCard(5000, 'investment');
    const b = buyCard(5000, 'inventory');
    const r = recordTrade({
      tradedOn: '2026-09-08', givenUpItemIds: [a, b], received: twoJumboBoxes,
    }, db);
    expect(r.warnings.join(' ')).toMatch(/mixes a personal collection item with business inventory/i);
  });

  it('insists on a value for what you received, because that IS the tax figure', () => {
    const id = buyCard(5000);
    expect(() => recordTrade({
      tradedOn: '2026-09-08', givenUpItemIds: [id],
      received: [{ description: 'mystery box', kind: 'sealed-to-open', fairMarketValueCents: 0 }],
    }, db)).toThrow(/needs a fair market value/i);
  });

  it('refuses a one-sided trade', () => {
    const id = buyCard(5000);
    expect(() => recordTrade({ tradedOn: '2026-09-08', givenUpItemIds: [], received: twoJumboBoxes }, db))
      .toThrow(TradeError);
    expect(() => recordTrade({ tradedOn: '2026-09-08', givenUpItemIds: [id], received: [] }, db))
      .toThrow(/just a disposal/i);
  });

  it('will not trade away a card twice', () => {
    const id = buyCard(5000);
    recordTrade({ tradedOn: '2026-09-08', givenUpItemIds: [id], received: twoJumboBoxes }, db);
    expect(() => recordTrade({ tradedOn: '2026-09-09', givenUpItemIds: [id], received: twoJumboBoxes }, db))
      .toThrow(/already been disposed of/i);
  });

  it('records a loss when the trade went against you', () => {
    const id = buyCard(100000);
    const r = recordTrade({ tradedOn: '2026-09-08', givenUpItemIds: [id], received: twoJumboBoxes }, db);
    expect(r.gainCents).toBe(-25000);
    expect(r.explanation.join(' ')).toMatch(/realised loss of \$250\.00/i);
  });
});
