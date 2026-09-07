import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, type Db } from '../db/index.js';
import { csvField, exportYear, toCsv } from '../reports/export.js';
import { recordPurchase } from '../ledger/purchases.js';
import { createExpense } from '../db/repos.js';

let db: Db;
beforeEach(() => { db = openMemoryDb(); });

describe('CSV writing', () => {
  it('quotes fields containing commas, quotes and newlines', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
  });

  it('defuses text a spreadsheet would treat as a formula', () => {
    // A card described as "-1st Edition" must not become a subtraction, and
    // "=cmd" must not become anything at all.
    expect(csvField('-1st Edition')).toBe("'-1st Edition");
    expect(csvField('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvField('@here')).toBe("'@here");
  });

  it('writes a header row and CRLF line endings', () => {
    const csv = toCsv([{ a: 1, b: 'two' }]);
    expect(csv).toBe('a,b\r\n1,two\r\n');
  });

  it('returns nothing for no rows rather than a stray header', () => {
    expect(toCsv([])).toBe('');
  });
});

describe('year export', () => {
  it('produces every file a preparer needs', () => {
    recordPurchase(
      {
        lot: {
          purchasedOn: '2026-03-01', vendor: 'Show dealer', channel: 'card-show',
          description: 'lot', subtotalCents: 10000, shippingCents: 0, taxCents: 0, feesCents: 0,
          paymentMethod: null, resaleExemptionUsed: false, notes: null, receiptPath: null,
        },
        items: [{ description: 'Card A', kind: 'single', estimatedValueCents: 10000 }],
      },
      db,
    );
    createExpense(
      { incurredOn: '2026-03-02', accountKey: 'shipping-supplies', vendor: 'Amazon',
        description: 'sleeves', amountCents: 1200, businessUsePercent: 100,
        paymentMethod: null, receiptPath: null, notes: null },
      db,
    );

    const files = exportYear(2026, db);
    const names = Object.keys(files).sort();
    expect(names.some((n) => n.includes('purchases.csv'))).toBe(true);
    expect(names.some((n) => n.includes('inventory.csv'))).toBe(true);
    expect(names.some((n) => n.includes('expenses.csv'))).toBe(true);
    expect(names.some((n) => n.includes('schedule-c-worksheet.json'))).toBe(true);
    expect(names.some((n) => n.includes('README'))).toBe(true);
  });

  it('writes money as decimal dollars, not cents, for the spreadsheet', () => {
    recordPurchase(
      {
        lot: {
          purchasedOn: '2026-03-01', vendor: 'v', channel: 'card-show', description: 'd',
          subtotalCents: 16164, shippingCents: 0, taxCents: 0, feesCents: 0,
          paymentMethod: null, resaleExemptionUsed: false, notes: null, receiptPath: null,
        },
        items: [{ description: 'Card', kind: 'single' }],
      },
      db,
    );
    const csv = exportYear(2026, db)['2026-01-purchases.csv']!;
    expect(csv).toContain('subtotal_dollars');
    expect(csv).toContain('161.64');
  });

  it('leads with a readme naming the headline figures and anything unresolved', () => {
    const readme = exportYear(2026, db)['2026-00-README.txt']!;
    expect(readme).toMatch(/Gross receipts \(line 1\)/);
    expect(readme).toMatch(/CHECK BEFORE FILING/);
    expect(readme).toMatch(/not tax advice/i);
  });
});
