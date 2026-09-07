import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, type Db } from '../db/index.js';
import { updateProfile } from '../db/repos.js';
import { guidanceFor } from '../compliance/guidance.js';
import { recordPurchase } from '../ledger/purchases.js';

let db: Db;
beforeEach(() => { db = openMemoryDb(); });

const lot = (over: Record<string, unknown> = {}) => ({
  purchasedOn: '2024-03-01', vendor: 'v', channel: 'personal-collection' as const,
  description: 'd', subtotalCents: 8000, shippingCents: 0, taxCents: 0, feesCents: 0,
  paymentMethod: null, resaleExemptionUsed: false, notes: null, receiptPath: null, ...over,
});

describe('the seed card', () => {
  it('quantifies what the classification is worth, and says sell it first', () => {
    recordPurchase(
      {
        lot: lot(),
        items: [{ description: 'Ohtani RC at PSA', kind: 'single', holdingIntent: 'investment', estimatedValueCents: 260000 }],
      },
      db,
    );

    const guidance = guidanceFor({ today: new Date('2026-09-07T00:00:00Z'), db });
    const seed = guidance.find((g) => g.id.startsWith('seed-card-'))!;
    expect(seed).toBeDefined();
    // $2,520 of gain, self-employment tax at roughly 14.13% of it.
    expect(seed.worthCents).toBe(Math.round(252000 * 0.153 * 0.9235));
    expect(seed.body.join(' ')).toMatch(/no step-up/i);
    expect(seed.steps!.join(' ')).toMatch(/before you open a business account/i);
  });

  it('changes its advice once the business has started trading', () => {
    recordPurchase(
      {
        lot: lot(),
        items: [{ description: 'Ohtani RC', kind: 'single', holdingIntent: 'investment', estimatedValueCents: 260000 }],
      },
      db,
    );
    updateProfile({ startedOn: '2026-06-01' }, db);

    const seed = guidanceFor({ today: new Date('2026-09-07T00:00:00Z'), db })
      .find((g) => g.id.startsWith('seed-card-'))!;
    expect(seed.body.join(' ')).toMatch(/already started trading/i);
    expect(seed.steps!.join(' ')).toMatch(/entirely out of the business/i);
  });

  it('says nothing about a card held as ordinary inventory', () => {
    recordPurchase(
      {
        lot: lot({ channel: 'card-show' }),
        items: [{ description: 'Flip stock', kind: 'single', holdingIntent: 'inventory', estimatedValueCents: 260000 }],
      },
      db,
    );
    const guidance = guidanceFor({ today: new Date('2026-09-07T00:00:00Z'), db });
    expect(guidance.some((g) => g.id.startsWith('seed-card-'))).toBe(false);
  });

  it('notes the holding period, since it changes the rate', () => {
    recordPurchase(
      {
        lot: lot({ purchasedOn: '2026-08-01' }),
        items: [{ description: 'Recent buy', kind: 'single', holdingIntent: 'investment', estimatedValueCents: 260000 }],
      },
      db,
    );
    const seed = guidanceFor({ today: new Date('2026-09-07T00:00:00Z'), db })
      .find((g) => g.id.startsWith('seed-card-'))!;
    expect(seed.body.join(' ')).toMatch(/year or less/i);
  });
});

describe('holding period warnings', () => {
  it('flags collection cards about to cross the one-year mark', () => {
    recordPurchase(
      {
        lot: lot({ purchasedOn: '2025-10-15' }),
        items: [{ description: 'Nearly long-term', kind: 'single', holdingIntent: 'investment', estimatedValueCents: 50000 }],
      },
      db,
    );
    const guidance = guidanceFor({ today: new Date('2026-09-07T00:00:00Z'), db });
    const near = guidance.find((g) => g.id === 'near-long-term')!;
    expect(near).toBeDefined();
    expect(near.body.join(' ')).toMatch(/anniversary itself is still short-term/i);
  });
});

describe('year end', () => {
  it('warns in November that buying inventory is not a deduction', () => {
    recordPurchase(
      {
        lot: lot({ channel: 'card-show', purchasedOn: '2026-11-20' }),
        items: [{ description: 'Stock', kind: 'single', holdingIntent: 'inventory' }],
      },
      db,
    );
    const guidance = guidanceFor({ today: new Date('2026-11-25T00:00:00Z'), db });
    expect(guidance.some((g) => g.id === 'year-end-inventory')).toBe(true);
  });

  it('stays quiet in the middle of the year', () => {
    recordPurchase(
      {
        lot: lot({ channel: 'card-show', purchasedOn: '2026-05-20' }),
        items: [{ description: 'Stock', kind: 'single', holdingIntent: 'inventory' }],
      },
      db,
    );
    const guidance = guidanceFor({ today: new Date('2026-05-25T00:00:00Z'), db });
    expect(guidance.some((g) => g.id === 'year-end-inventory')).toBe(false);
  });
});

describe('zero-basis stock', () => {
  it('points out items that will be entirely taxable profit', () => {
    recordPurchase(
      {
        lot: lot({ channel: 'card-show', subtotalCents: 10000 }),
        items: [
          { description: 'The hit', kind: 'single', holdingIntent: 'inventory', estimatedValueCents: 100000 },
          { description: 'Bulk', kind: 'single', holdingIntent: 'inventory', estimatedValueCents: 0 },
        ],
      },
      db,
    );
    const guidance = guidanceFor({ today: new Date('2026-09-07T00:00:00Z'), db });
    const zero = guidance.find((g) => g.id === 'zero-basis')!;
    expect(zero).toBeDefined();
    expect(zero.body.join(' ')).toMatch(/right answer if they genuinely cost nothing/i);
  });
});
