import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, type Db } from '../db/index.js';
import { createExpense, createSale, updateProfile } from '../db/repos.js';
import { recordPurchase } from '../ledger/purchases.js';
import { openSealedItem } from '../ledger/inventory.js';
import { cogsForYear } from '../reports/cogs.js';
import { profitAndLoss } from '../reports/profitLoss.js';
import { capitalGainsForYear, isLongTerm, investmentSchedule } from '../reports/capitalGains.js';
import { inventoryAsOf } from '../reports/inventory.js';

let db: Db;
beforeEach(() => {
  db = openMemoryDb();
});

const lotBase = {
  vendor: 'Dealer',
  channel: 'card-show' as const,
  description: 'purchase',
  shippingCents: 0,
  taxCents: 0,
  feesCents: 0,
  paymentMethod: null,
  resaleExemptionUsed: false,
  notes: null,
  receiptPath: null,
};

const saleBase = {
  channel: 'ebay' as const,
  orderRef: null,
  buyerState: 'UT',
  shippingChargedCents: 0,
  salesTaxCollectedCents: 0,
  salesTaxRemittedByPlatform: true,
  platformFeeCents: 0,
  paymentProcessingFeeCents: 0,
  shippingCostCents: 0,
  otherFeeCents: 0,
  refundedCents: 0,
  notes: null,
};

describe('cost of goods sold', () => {
  it('ties both ways when a box is bought, opened and one card sells', () => {
    const purchase = recordPurchase(
      {
        lot: { ...lotBase, purchasedOn: '2026-03-01', subtotalCents: 16164 },
        items: [{ description: 'Booster box', kind: 'sealed-to-open' }],
      },
      db,
    );
    const opened = openSealedItem(
      {
        itemId: purchase.items[0]!.id,
        openedOn: '2026-03-02',
        contents: [
          { description: 'Chase', kind: 'single', estimatedValueCents: 260000 },
          { description: 'Bulk', kind: 'single', estimatedValueCents: 1000 },
        ],
      },
      db,
    );

    const chase = opened.created[0]!;
    createSale({ ...saleBase, soldOn: '2026-06-01', grossCents: 260000 },
      [{ itemId: chase.id, quantity: 1, allocatedGrossCents: 260000, cogsCents: chase.basisCents }], db);

    const report = cogsForYear(2026, db);
    // The whole box cost is accounted for: what sold, plus what is still here.
    expect(report.purchasesCents).toBe(16164);
    expect(report.cogsCents).toBe(chase.basisCents);
    expect(report.cogsFromSalesCents).toBe(chase.basisCents);
    expect(report.differenceCents).toBe(0);
    expect(report.warning).toBeNull();
  });

  it('subtracts items taken for personal use from purchases', async () => {
    const purchase = recordPurchase(
      {
        lot: { ...lotBase, purchasedOn: '2026-03-01', subtotalCents: 10000 },
        items: [
          { description: 'Keeper', kind: 'single', estimatedValueCents: 5000 },
          { description: 'Flip', kind: 'single', estimatedValueCents: 5000 },
        ],
      },
      db,
    );
    const { withdrawToPersonalUse } = await import('../ledger/inventory.js');
    withdrawToPersonalUse(purchase.items[0]!.id, 'for my collection', db);

    const report = cogsForYear(2026, db);
    expect(report.personalWithdrawalsCents).toBe(5000);
    expect(report.purchasesCents).toBe(5000);
  });

  it('keeps cards held for investment out of business purchases entirely', () => {
    // An investment card is not stock in trade. Its cost belongs in basis until
    // it sells on Form 8949, never in Schedule C purchases.
    recordPurchase(
      {
        lot: { ...lotBase, purchasedOn: '2026-02-01', subtotalCents: 20000 },
        items: [{ description: 'Personal collection piece', kind: 'single', holdingIntent: 'investment' }],
      },
      db,
    );
    recordPurchase(
      {
        lot: { ...lotBase, purchasedOn: '2026-02-01', subtotalCents: 5000 },
        items: [{ description: 'Flip stock', kind: 'single', holdingIntent: 'inventory' }],
      },
      db,
    );

    const report = cogsForYear(2026, db);
    expect(report.purchasesCents).toBe(5000);
    expect(inventoryAsOf('2026-12-31', db).inventoryBasisCents).toBe(5000);
    expect(inventoryAsOf('2026-12-31', db).investmentBasisCents).toBe(20000);
  });

  it('flags books that do not tie rather than reporting a confident wrong number', () => {
    const purchase = recordPurchase(
      { lot: { ...lotBase, purchasedOn: '2026-01-05', subtotalCents: 10000 }, items: [{ description: 'Card', kind: 'single' }] },
      db,
    );
    // A sale recorded with the wrong basis, which is exactly the sort of hand
    // edit that silently breaks a set of books.
    createSale({ ...saleBase, soldOn: '2026-05-05', grossCents: 30000 },
      [{ itemId: purchase.items[0]!.id, quantity: 1, allocatedGrossCents: 30000, cogsCents: 4000 }], db);

    const report = cogsForYear(2026, db);
    expect(report.differenceCents).not.toBe(0);
    expect(report.warning).toMatch(/disagree/i);
  });
});

describe('profit and loss', () => {
  it('treats shipping charged to the buyer as income and the label as a cost', () => {
    const purchase = recordPurchase(
      { lot: { ...lotBase, purchasedOn: '2026-01-01', subtotalCents: 1000 }, items: [{ description: 'Card', kind: 'single' }] },
      db,
    );
    createSale(
      { ...saleBase, soldOn: '2026-02-01', grossCents: 5000, shippingChargedCents: 500, shippingCostCents: 400 },
      [{ itemId: purchase.items[0]!.id, quantity: 1, allocatedGrossCents: 5000, cogsCents: 1000 }],
      db,
    );
    createExpense(
      { incurredOn: '2026-02-01', accountKey: 'shipping-out', vendor: 'USPS', description: 'label',
        amountCents: 400, businessUsePercent: 100, paymentMethod: null, receiptPath: null, notes: null },
      db,
    );

    const pl = profitAndLoss(2026, {}, db);
    // Receipts include the shipping the buyer paid, not just the card price.
    expect(pl.grossReceiptsCents).toBe(5500);
    expect(pl.cogsCents).toBe(1000);
    const shipping = pl.expenseLines.find((l) => l.accountKey === 'shipping-out')!;
    expect(shipping.deductibleCents).toBe(400);
  });

  it('applies the business-use share to mixed-use costs', () => {
    createExpense(
      { incurredOn: '2026-03-01', accountKey: 'internet-phone', vendor: 'ISP', description: 'internet',
        amountCents: 10000, businessUsePercent: 30, paymentMethod: null, receiptPath: null, notes: null },
      db,
    );
    const pl = profitAndLoss(2026, {}, db);
    const line = pl.expenseLines.find((l) => l.accountKey === 'internet-phone')!;
    expect(line.grossCents).toBe(10000);
    expect(line.deductibleCents).toBe(3000);
  });

  it('halves business meals when the limit is known, and says so when it is not', () => {
    createExpense(
      { incurredOn: '2026-03-01', accountKey: 'meals', vendor: 'Diner', description: 'lunch at show',
        amountCents: 4000, businessUsePercent: 100, paymentMethod: null, receiptPath: null, notes: null },
      db,
    );

    const limited = profitAndLoss(2026, { mealsDeductiblePercent: 0.5 }, db);
    expect(limited.expenseLines.find((l) => l.accountKey === 'meals')!.deductibleCents).toBe(2000);

    const unknown = profitAndLoss(2026, {}, db);
    expect(unknown.expenseLines.find((l) => l.accountKey === 'meals')!.deductibleCents).toBe(4000);
    expect(unknown.warnings.join(' ')).toMatch(/meals has not been verified/i);
  });

  it('will not let the home office deduction create a loss', () => {
    const purchase = recordPurchase(
      { lot: { ...lotBase, purchasedOn: '2026-01-01', subtotalCents: 1000 }, items: [{ description: 'Card', kind: 'single' }] },
      db,
    );
    createSale({ ...saleBase, soldOn: '2026-02-01', grossCents: 2000 },
      [{ itemId: purchase.items[0]!.id, quantity: 1, allocatedGrossCents: 2000, cogsCents: 1000 }], db);

    const pl = profitAndLoss(2026, { homeOfficeCents: 500000 }, db);
    expect(pl.netProfitCents).toBe(0);
    expect(pl.warnings.join(' ')).toMatch(/cannot create or deepen a business loss/i);
  });

  it('warns about sales tax it collected but a platform did not remit', () => {
    const purchase = recordPurchase(
      { lot: { ...lotBase, purchasedOn: '2026-01-01', subtotalCents: 100 }, items: [{ description: 'Card', kind: 'single' }] },
      db,
    );
    createSale(
      { ...saleBase, soldOn: '2026-04-01', channel: 'card-show', grossCents: 10000,
        salesTaxCollectedCents: 725, salesTaxRemittedByPlatform: false },
      [{ itemId: purchase.items[0]!.id, quantity: 1, allocatedGrossCents: 10000, cogsCents: 100 }],
      db,
    );
    const pl = profitAndLoss(2026, {}, db);
    // Sales tax is the state's money, not receipts.
    expect(pl.grossReceiptsCents).toBe(10000);
    expect(pl.salesTaxCollectedCents).toBe(725);
    expect(pl.warnings.join(' ')).toMatch(/belongs to the state/i);
  });

  it('values mileage at the rate in force on the day it was driven', async () => {
    const { createTrip } = await import('../db/repos.js');
    // The 2026 rate rose from 72.5c to 76c on 1 July, so a single annual rate
    // would misstate both of these trips.
    createTrip(
      { drivenOn: '2026-05-01', purpose: 'Card show', fromLocation: 'Home', toLocation: 'Layton',
        miles: 40, roundTrip: true, odometerStart: null, odometerEnd: null, notes: null },
      db,
    );
    createTrip(
      { drivenOn: '2026-08-01', purpose: 'Card show', fromLocation: 'Home', toLocation: 'Ogden',
        miles: 100, roundTrip: false, odometerStart: null, odometerEnd: null, notes: null },
      db,
    );

    const pl = profitAndLoss(2026, {}, db);
    expect(pl.mileage.totalMiles).toBe(180);
    expect(pl.mileage.bands).toHaveLength(2);
    // 80 miles at 72.5c plus 100 miles at 76c.
    expect(pl.mileage.deductionCents).toBe(5800 + 7600);
    const vehicle = pl.expenseLines.find((l) => l.accountKey === 'vehicle')!;
    expect(vehicle.deductibleCents).toBe(13400);
    expect(vehicle.limitNote).toMatch(/72\.5c/);
  });

  it('leaves out miles driven on dates with no rate on file, and says so', async () => {
    const { createTrip } = await import('../db/repos.js');
    createTrip(
      { drivenOn: '2031-05-01', purpose: 'Future show', fromLocation: null, toLocation: null,
        miles: 50, roundTrip: false, odometerStart: null, odometerEnd: null, notes: null },
      db,
    );
    const pl = profitAndLoss(2031, {}, db);
    expect(pl.mileage.deductionCents).toBe(0);
    expect(pl.mileage.unratedMiles).toBe(50);
    expect(pl.warnings.join(' ')).toMatch(/no standard mileage rate on file/i);
  });
});

describe('holding period', () => {
  it('needs MORE than a year, so the anniversary itself is short-term', () => {
    expect(isLongTerm('2025-01-01', '2026-01-01')).toBe(false);
    expect(isLongTerm('2025-01-01', '2026-01-02')).toBe(true);
  });

  it('handles a leap-year acquisition', () => {
    expect(isLongTerm('2024-02-29', '2025-02-28')).toBe(false);
    expect(isLongTerm('2024-02-29', '2025-03-02')).toBe(true);
  });
});

describe('capital gains', () => {
  it('reports an investment card on the capital side, net of selling costs', () => {
    const purchase = recordPurchase(
      {
        lot: { ...lotBase, purchasedOn: '2023-06-01', subtotalCents: 20000 },
        items: [{ description: 'Graded rookie', kind: 'single', holdingIntent: 'investment' }],
      },
      db,
    );
    createSale(
      { ...saleBase, soldOn: '2026-04-01', grossCents: 260000, platformFeeCents: 33800 },
      [{ itemId: purchase.items[0]!.id, quantity: 1, allocatedGrossCents: 260000, cogsCents: 20000 }],
      db,
    );

    const report = capitalGainsForYear(2026, db);
    expect(report.dispositions).toHaveLength(1);
    const d = report.dispositions[0]!;
    expect(d.term).toBe('long-term');
    // Selling costs reduce the amount realised; an investor cannot deduct them.
    expect(d.proceedsCents).toBe(226200);
    expect(d.gainCents).toBe(206200);
    expect(report.collectiblesGainCents).toBe(206200);
    expect(report.notes.join(' ')).toMatch(/capped at 28%/i);
  });

  it('keeps investment sales out of the Schedule C profit and loss', () => {
    const purchase = recordPurchase(
      {
        lot: { ...lotBase, purchasedOn: '2023-06-01', subtotalCents: 20000 },
        items: [{ description: 'Collection piece', kind: 'single', holdingIntent: 'investment' }],
      },
      db,
    );
    createSale({ ...saleBase, soldOn: '2026-04-01', grossCents: 260000 },
      [{ itemId: purchase.items[0]!.id, quantity: 1, allocatedGrossCents: 260000, cogsCents: 20000 }], db);

    const pl = profitAndLoss(2026, {}, db);
    // The sale itself is still recorded, but its cost never hits COGS and the
    // books must not claim it does.
    expect(pl.cogs.cogsFromSalesCents).toBe(0);
    expect(pl.cogs.purchasesCents).toBe(0);
  });

  it('produces a dated schedule of investment holdings to print and sign', () => {
    recordPurchase(
      {
        lot: { ...lotBase, purchasedOn: '2024-01-01', subtotalCents: 20000 },
        items: [{ description: 'Collection piece', kind: 'single', holdingIntent: 'investment' }],
      },
      db,
    );
    const schedule = investmentSchedule(db);
    expect(schedule.entries).toHaveLength(1);
    expect(schedule.totalBasisCents).toBe(20000);
    expect(schedule.guidance.join(' ')).toMatch(/never buy or sell them through the business bank account/i);
  });
});


/**
 * A personal collection card is not business income, however it is disposed of.
 *
 * This was live: selling a $2,600 collection piece put $2,600 into Schedule C
 * gross receipts, where it would attract self-employment tax — the exact
 * opposite of the advice the app gives about that card. COGS was already
 * filtered on holding intent; receipts were not.
 */
describe('personal dispositions stay off Schedule C', () => {
  function collectionCard(db: Db, cost = 5000) {
    return recordPurchase({
      lot: {
        purchasedOn: '2019-04-02', vendor: 'me', channel: 'personal-collection',
        description: 'collection card', subtotalCents: cost, shippingCents: 0, taxCents: 0,
        feesCents: 0, paymentMethod: null, resaleExemptionUsed: false, notes: null, receiptPath: null,
      },
      items: [{ description: 'Ohtani RC', kind: 'single', holdingIntent: 'investment' }],
    }, db).items[0]!;
  }

  function inventoryCard(db: Db, cost = 5000) {
    return recordPurchase({
      lot: {
        purchasedOn: '2026-01-05', vendor: 'shop', channel: 'card-show',
        description: 'stock', subtotalCents: cost, shippingCents: 0, taxCents: 0,
        feesCents: 0, paymentMethod: null, resaleExemptionUsed: false, notes: null, receiptPath: null,
      },
      items: [{ description: 'Stock card', kind: 'single', holdingIntent: 'inventory' }],
    }, db).items[0]!;
  }

  const sale = (over: Record<string, unknown> = {}) => ({
    soldOn: '2026-05-01' as const, channel: 'ebay' as const, orderRef: null, buyerState: null,
    grossCents: 260000, shippingChargedCents: 0, salesTaxCollectedCents: 0,
    salesTaxRemittedByPlatform: true, platformFeeCents: 0, paymentProcessingFeeCents: 0,
    shippingCostCents: 0, otherFeeCents: 0, refundedCents: 0, notes: null, ...over,
  });

  it('excludes an ordinary sale of a collection piece', () => {
    const db = openMemoryDb();
    const item = collectionCard(db);
    createSale(sale(), [{ itemId: item.id, quantity: 1, allocatedGrossCents: 260000, cogsCents: 5000 }], db);

    const pl = profitAndLoss(2026, {}, db);
    expect(pl.grossReceiptsCents).toBe(0);
    expect(pl.cogsCents).toBe(0);
  });

  it('still counts an ordinary sale of inventory in full', () => {
    const db = openMemoryDb();
    const item = inventoryCard(db);
    createSale(sale({ grossCents: 20000 }), [{ itemId: item.id, quantity: 1, allocatedGrossCents: 20000, cogsCents: 5000 }], db);
    expect(profitAndLoss(2026, {}, db).grossReceiptsCents).toBe(20000);
  });

  it('splits a sale that mixed the two, rather than including or dropping it whole', () => {
    const db = openMemoryDb();
    const personal = collectionCard(db);
    const stock = inventoryCard(db);
    // One order, $1,000: $750 of it was the collection piece.
    createSale(
      sale({ grossCents: 100000, shippingChargedCents: 1000, platformFeeCents: 1300 }),
      [
        { itemId: personal.id, quantity: 1, allocatedGrossCents: 75000, cogsCents: 5000 },
        { itemId: stock.id, quantity: 1, allocatedGrossCents: 25000, cogsCents: 5000 },
      ],
      db,
    );

    const pl = profitAndLoss(2026, {}, db);
    // A quarter of the order was business, so a quarter of everything counts.
    expect(pl.grossReceiptsCents).toBe(25250);
  });

  it('warns when fees recorded on sales are being deducted nowhere', () => {
    // The sale form captures fees; the expense ledger is what actually deducts
    // them. A user who fills in one and not the other overstates their profit,
    // and the report should say so rather than quietly letting it happen.
    const db = openMemoryDb();
    const item = inventoryCard(db);
    createSale(
      sale({ grossCents: 20000, platformFeeCents: 2600, shippingCostCents: 700 }),
      [{ itemId: item.id, quantity: 1, allocatedGrossCents: 20000, cogsCents: 5000 }],
      db,
    );
    const pl = profitAndLoss(2026, {}, db);
    expect(pl.warnings.join(' ')).toMatch(/33\.00 dollars of platform fees.*NONE of it is in your expenses/is);
  });

  it('warns to reconcile when fees appear in both places, and deducts only the expenses', () => {
    const db = openMemoryDb();
    const item = inventoryCard(db);
    createSale(
      sale({ grossCents: 20000, shippingCostCents: 400 }),
      [{ itemId: item.id, quantity: 1, allocatedGrossCents: 20000, cogsCents: 5000 }],
      db,
    );
    createExpense(
      { incurredOn: '2026-05-01', accountKey: 'shipping-out', vendor: 'USPS', description: 'label',
        amountCents: 400, businessUsePercent: 100, paymentMethod: null, receiptPath: null, notes: null },
      db,
    );
    const pl = profitAndLoss(2026, {}, db);
    // Counted once, from the expense ledger — never doubled.
    expect(pl.expenseLines.find((l) => l.accountKey === 'shipping-out')!.deductibleCents).toBe(400);
    expect(pl.warnings.join(' ')).toMatch(/Only the expenses are deducted here/i);
  });

  it('counts a sale with no lines in full, which is the right default', () => {
    // Nothing links it to an item, so it cannot be classified. Almost every
    // unlinked sale is an ordinary business sale.
    const db = openMemoryDb();
    createSale(sale({ grossCents: 5000 }), [], db);
    expect(profitAndLoss(2026, {}, db).grossReceiptsCents).toBe(5000);
  });
});
