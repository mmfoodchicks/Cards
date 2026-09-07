import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, type Db } from '../db/index.js';
import { createSale, updateProfile } from '../db/repos.js';
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


describe('marketplace reporting', () => {
  const sale = (over: Record<string, unknown> = {}) => ({
    soldOn: '2026-05-01' as const, channel: 'ebay' as const, orderRef: null, buyerState: 'UT',
    grossCents: 10000, shippingChargedCents: 500, salesTaxCollectedCents: 715,
    salesTaxRemittedByPlatform: true, platformFeeCents: 1300, paymentProcessingFeeCents: 0,
    shippingCostCents: 400, otherFeeCents: 0, refundedCents: 0, notes: null, ...over,
  });

  it('says the income is taxable when no form is coming', () => {
    for (let i = 0; i < 5; i += 1) createSale(sale(), [], db);

    const g = guidanceFor({ today: new Date('2026-09-07T00:00:00Z'), db })
      .find((x) => x.id === 'reporting-1099k-below')!;
    expect(g).toBeDefined();
    expect(g.body.join(' ')).toMatch(/all income, no matter the amount, is taxable/i);
    expect(g.body.join(' ')).toMatch(/\$600 rule changed which platforms must file/i);
  });

  it('warns about the gross figure once both thresholds are passed', () => {
    // 201 sales at $120 of goods clears $20,000 and 200 transactions.
    for (let i = 0; i < 201; i += 1) createSale(sale({ grossCents: 12000 }), [], db);

    const all = guidanceFor({ today: new Date('2026-09-07T00:00:00Z'), db });
    const g = all.find((x) => x.id === 'reporting-1099k-expected')!;
    expect(g).toBeDefined();
    expect(g.body.join(' ')).toMatch(/includes shipping buyers paid and sales tax/i);
    // The "no form is coming" note must NOT also fire.
    expect(all.find((x) => x.id === 'reporting-1099k-below')).toBeUndefined();
  });

  it('gives notice while a platform is still approaching the threshold', () => {
    for (let i = 0; i < 170; i += 1) {
      createSale(sale({ grossCents: 12000 }), [], db);
    }
    const g = guidanceFor({ today: new Date('2026-09-07T00:00:00Z'), db })
      .find((x) => x.id === 'reporting-1099k-approaching')!;
    expect(g).toBeDefined();
    expect(g.because).toMatch(/eBay/);
  });

  it('flags card readers at shows, which have no threshold', () => {
    createSale(sale({ channel: 'card-show', grossCents: 4000, salesTaxCollectedCents: 286 }), [], db);

    const g = guidanceFor({ today: new Date('2026-09-07T00:00:00Z'), db })
      .find((x) => x.id === 'reporting-1099k-card-reader')!;
    expect(g).toBeDefined();
    expect(g.body.join(' ')).toMatch(/first cent/i);
  });

  it('stays quiet when there are no sales at all', () => {
    const ids = guidanceFor({ today: new Date('2026-09-07T00:00:00Z'), db }).map((g) => g.id);
    expect(ids.filter((id) => id.startsWith('reporting-1099k'))).toEqual([]);
  });
});
