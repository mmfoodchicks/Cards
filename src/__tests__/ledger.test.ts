import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, type Db } from '../db/index.js';
import { getItem, itemsInLot, listItems, updateItem } from '../db/repos.js';
import { recordPurchase, reallocateLot } from '../ledger/purchases.js';
import { openSealedItem, withdrawToPersonalUse } from '../ledger/inventory.js';
import { sum } from '../domain/money.js';

let db: Db;
beforeEach(() => {
  db = openMemoryDb();
});

const lot = (overrides: Partial<Parameters<typeof recordPurchase>[0]['lot']> = {}) => ({
  purchasedOn: '2026-09-01',
  vendor: 'Card show dealer',
  channel: 'card-show' as const,
  description: 'Booster box',
  subtotalCents: 16164,
  shippingCents: 0,
  taxCents: 0,
  feesCents: 0,
  paymentMethod: 'cash',
  resaleExemptionUsed: false,
  notes: null,
  receiptPath: null,
  ...overrides,
});

describe('recording a purchase', () => {
  it('allocates the whole cost across the items bought', () => {
    const result = recordPurchase(
      {
        lot: lot({ subtotalCents: 40000, shippingCents: 1200, taxCents: 0, feesCents: 0 }),
        items: [
          { description: 'Card A', kind: 'single', estimatedValueCents: 30000 },
          { description: 'Card B', kind: 'single', estimatedValueCents: 10000 },
        ],
      },
      db,
    );
    expect(result.totalCents).toBe(41200);
    expect(sum(result.items.map((i) => i.basisCents))).toBe(41200);
    // Inbound shipping rode along into basis rather than being expensed.
    expect(result.items[0]!.basisCents).toBeGreaterThan(30000);
  });

  it('refuses a purchase with no items rather than losing the money', () => {
    expect(() => recordPurchase({ lot: lot(), items: [] }, db)).toThrow(/at least one item/i);
  });

  it('rolls back completely if anything fails', () => {
    expect(() =>
      recordPurchase(
        {
          lot: lot(),
          allocationMethod: 'manual',
          items: [{ description: 'A', kind: 'single', manualBasisCents: 1 }],
        },
        db,
      ),
    ).toThrow();
    // The lot must not exist: a purchase with no items would be an orphan cost.
    expect(itemsInLot(1, db)).toHaveLength(0);
  });
});

describe('opening sealed product', () => {
  it('moves the box cost into the cards, weighted by what they are worth', () => {
    const purchase = recordPurchase(
      { lot: lot(), items: [{ description: '2026 Booster Box', kind: 'sealed-to-open', estimatedValueCents: 16164 }] },
      db,
    );
    const boxId = purchase.items[0]!.id;

    const opened = openSealedItem(
      {
        itemId: boxId,
        openedOn: '2026-09-05',
        contents: [
          { description: 'Charizard ex SIR', kind: 'single', estimatedValueCents: 260000 },
          { description: 'Bulk commons', kind: 'single', quantity: 359, estimatedValueCents: 100 },
        ],
      },
      db,
    );

    expect(sum(opened.created.map((i) => i.basisCents))).toBe(16164);
    // The chase card carries nearly all the cost, which is the point.
    expect(opened.created[0]!.basisCents).toBeGreaterThan(14000);

    const box = getItem(boxId, db)!;
    expect(box.status).toBe('opened');
    expect(box.basisCents).toBe(0);
  });

  it('dates the pulled cards to when the box was bought, not when it was opened', () => {
    // Holding period runs from acquisition, which matters for capital gain
    // treatment on anything held as an investment.
    const purchase = recordPurchase(
      { lot: lot({ purchasedOn: '2026-01-15' }), items: [{ description: 'Box', kind: 'sealed-to-open' }] },
      db,
    );
    const opened = openSealedItem(
      {
        itemId: purchase.items[0]!.id,
        openedOn: '2026-09-05',
        contents: [{ description: 'Hit', kind: 'single', estimatedValueCents: 50000 }],
      },
      db,
    );
    expect(opened.created[0]!.acquiredOn).toBe('2026-01-15');
  });

  it('will not open a box twice', () => {
    const purchase = recordPurchase({ lot: lot(), items: [{ description: 'Box', kind: 'sealed-to-open' }] }, db);
    const id = purchase.items[0]!.id;
    openSealedItem({ itemId: id, openedOn: '2026-09-05', contents: [{ description: 'Card', kind: 'single' }] }, db);
    expect(() =>
      openSealedItem({ itemId: id, openedOn: '2026-09-06', contents: [{ description: 'Card', kind: 'single' }] }, db),
    ).toThrow(/already been opened/i);
  });

  it('refuses to open a box without recording contents', () => {
    const purchase = recordPurchase({ lot: lot(), items: [{ description: 'Box', kind: 'sealed-to-open' }] }, db);
    expect(() =>
      openSealedItem({ itemId: purchase.items[0]!.id, openedOn: '2026-09-05', contents: [] }, db),
    ).toThrow(/vanish/i);
  });
});

describe('reallocating a lot', () => {
  it('re-spreads cost when values are corrected', () => {
    const purchase = recordPurchase(
      {
        lot: lot({ subtotalCents: 10000 }),
        items: [
          { description: 'A', kind: 'single', estimatedValueCents: 5000 },
          { description: 'B', kind: 'single', estimatedValueCents: 5000 },
        ],
      },
      db,
    );
    expect(purchase.items[0]!.basisCents).toBe(5000);

    // It turns out A is the valuable one.
    updateItem(purchase.items[0]!.id, { estimatedValueCents: 90000 }, 'corrected', db);
    updateItem(purchase.items[1]!.id, { estimatedValueCents: 10000 }, 'corrected', db);

    reallocateLot(purchase.lotId, 'relative-fmv', db);
    const items = itemsInLot(purchase.lotId, db);
    expect(sum(items.map((i) => i.basisCents))).toBe(10000);
    expect(items[0]!.basisCents).toBe(9000);
  });

  it('will not restate a lot whose purchases have all been settled', () => {
    const purchase = recordPurchase({ lot: lot(), items: [{ description: 'Box', kind: 'sealed-to-open' }] }, db);
    openSealedItem(
      { itemId: purchase.items[0]!.id, openedOn: '2026-09-05', contents: [{ description: 'Card', kind: 'single' }] },
      db,
    );
    expect(() => reallocateLot(purchase.lotId, 'equal', db)).toThrow(/already been sold or opened/i);
  });

  it('does not reach into cards that came out of an opened box', () => {
    // Those cards got their basis from the box. Spreading the lot across them
    // as well would allocate the same money twice.
    const purchase = recordPurchase(
      {
        lot: lot({ subtotalCents: 10000 }),
        items: [
          { description: 'Loose card', kind: 'single', estimatedValueCents: 5000 },
          { description: 'Box', kind: 'sealed-to-open', estimatedValueCents: 5000 },
        ],
      },
      db,
    );
    const boxId = purchase.items[1]!.id;
    openSealedItem(
      {
        itemId: boxId,
        openedOn: '2026-09-05',
        contents: [{ description: 'Pulled hit', kind: 'single', estimatedValueCents: 99999 }],
      },
      db,
    );

    reallocateLot(purchase.lotId, 'relative-fmv', db);

    const all = itemsInLot(purchase.lotId, db);
    // The whole lot cost is still accounted for exactly once.
    expect(sum(all.map((i) => i.basisCents))).toBe(10000);
    const pulled = all.find((i) => i.description === 'Pulled hit')!;
    expect(pulled.basisCents).toBe(5000);
  });
});

describe('personal use', () => {
  it('takes an item out of inventory without recording income', () => {
    const purchase = recordPurchase({ lot: lot(), items: [{ description: 'Keeper', kind: 'single' }] }, db);
    const item = withdrawToPersonalUse(purchase.items[0]!.id, 'adding to my own collection', db)!;
    expect(item.status).toBe('personal-use');
    expect(listItems({ status: ['on-hand'] }, db).total).toBe(0);
  });
});

describe('reallocating an opening', () => {
  it('corrects the split once real values are known', async () => {
    const { reallocateOpening } = await import('../ledger/inventory.js');
    const purchase = recordPurchase({ lot: lot({ subtotalCents: 16164 }), items: [{ description: 'Box', kind: 'sealed-to-open' }] }, db);
    const opened = openSealedItem(
      {
        itemId: purchase.items[0]!.id,
        openedOn: '2026-09-05',
        // No values known at opening time, so it split evenly.
        contents: [
          { description: 'Chase card', kind: 'single' },
          { description: 'Bulk', kind: 'single' },
        ],
      },
      db,
    );
    expect(opened.created[0]!.basisCents).toBe(8082);

    updateItem(opened.created[0]!.id, { estimatedValueCents: 260000 }, 'booked it', db);
    updateItem(opened.created[1]!.id, { estimatedValueCents: 100 }, 'booked it', db);

    reallocateOpening(purchase.items[0]!.id, 'relative-fmv', db);

    const chase = getItem(opened.created[0]!.id, db)!;
    const bulk = getItem(opened.created[1]!.id, db)!;
    expect(chase.basisCents + bulk.basisCents).toBe(16164);
    expect(chase.basisCents).toBeGreaterThan(16000);
  });
});
