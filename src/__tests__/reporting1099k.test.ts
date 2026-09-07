import { describe, expect, it } from 'vitest';
import {
  approachingThreshold,
  reporting1099k,
  thresholdProgress,
  type SaleForReporting,
} from '../tax/reporting1099k.js';
import { FIGURES_2026 } from '../tax/years/2026.js';
import { valueOf } from '../tax/figures.js';

const year = FIGURES_2026;

function sale(over: Partial<SaleForReporting> = {}): SaleForReporting {
  return {
    channel: 'ebay',
    grossCents: 10000,
    shippingChargedCents: 500,
    salesTaxCollectedCents: 700,
    refundedCents: 0,
    ...over,
  };
}

function many(n: number, over: Partial<SaleForReporting> = {}): SaleForReporting[] {
  return Array.from({ length: n }, () => sale(over));
}

describe('Form 1099-K thresholds', () => {
  it('holds the restored $20,000 and 200 transaction thresholds', () => {
    expect(valueOf(year.figures['reporting.1099k.dollarThreshold']!)).toBe(2000000);
    expect(valueOf(year.figures['reporting.1099k.transactionThreshold']!)).toBe(200);
    // The ARPA $600 rule was repealed retroactively; carrying it would be wrong.
    expect(valueOf(year.figures['reporting.1099k.dollarThreshold']!)).not.toBe(60000);
  });

  it('requires BOTH tests, not either', () => {
    // Well over the dollar test, nowhere near the transaction count.
    const bigTicket = reporting1099k(many(10, { grossCents: 500000 }), year);
    const ebay = bigTicket.channels.find((c) => c.channel === 'ebay')!;
    expect(ebay.meetsDollarTest).toBe(true);
    expect(ebay.meetsTransactionTest).toBe(false);
    expect(ebay.formExpected).toBe(false);

    // Over the count, nowhere near the dollars.
    const bulk = reporting1099k(
      many(250, { grossCents: 300, shippingChargedCents: 0, salesTaxCollectedCents: 0 }),
      year,
    );
    const bulkEbay = bulk.channels.find((c) => c.channel === 'ebay')!;
    expect(bulkEbay.meetsTransactionTest).toBe(true);
    expect(bulkEbay.meetsDollarTest).toBe(false);
    expect(bulkEbay.formExpected).toBe(false);
  });

  it('expects a form once both tests are exceeded', () => {
    const summary = reporting1099k(many(201, { grossCents: 12000 }), year);
    const ebay = summary.channels.find((c) => c.channel === 'ebay')!;
    expect(ebay.meetsDollarTest).toBe(true);
    expect(ebay.meetsTransactionTest).toBe(true);
    expect(ebay.formExpected).toBe(true);
    expect(summary.formsExpected).toBe(1);
  });

  it('treats the thresholds as strict — exactly at the line is under it', () => {
    // Exactly 200 transactions and exactly $20,000 of gross: the statute says
    // "exceeds", so neither test is met.
    const exact = reporting1099k(
      many(200, { grossCents: 10000, shippingChargedCents: 0, salesTaxCollectedCents: 0 }),
      year,
    );
    const ebay = exact.channels.find((c) => c.channel === 'ebay')!;
    expect(ebay.reportableGrossCents).toBe(2000000);
    expect(ebay.transactionCount).toBe(200);
    expect(ebay.meetsDollarTest).toBe(false);
    expect(ebay.meetsTransactionTest).toBe(false);
    expect(ebay.formExpected).toBe(false);
  });

  it('reports gross the way the platform does: shipping and sales tax in, refunds not out', () => {
    const summary = reporting1099k(
      [sale({ grossCents: 100000, shippingChargedCents: 1200, salesTaxCollectedCents: 7150, refundedCents: 50000 })],
      year,
    );
    const ebay = summary.channels.find((c) => c.channel === 'ebay')!;
    // Refund does NOT reduce it, and tax and shipping are included.
    expect(ebay.reportableGrossCents).toBe(108350);
    // Schedule C receipts are goods plus shipping charged, without sales tax.
    expect(ebay.scheduleCReceiptsCents).toBe(101200);
    // The gap the return has to explain is the sales tax held for the state.
    expect(ebay.reconcilingCents).toBe(7150);
  });

  it('says plainly that below-threshold income is still taxable', () => {
    const summary = reporting1099k(many(5, { grossCents: 40000 }), year);
    expect(summary.formsExpected).toBe(0);
    expect(summary.belowThresholdCents).toBeGreaterThan(0);
    expect(summary.explanation.join(' ')).toMatch(/taxable regardless|decides nothing about whether the money/i);
  });

  it('warns that a card reader at a show has no threshold', () => {
    const summary = reporting1099k([sale({ channel: 'card-show', grossCents: 4000 })], year);
    const show = summary.channels.find((c) => c.channel === 'card-show')!;
    expect(show.basis).toBe('self-reported');
    expect(show.formExpected).toBe(false);
    expect(show.note).toMatch(/card reader/i);
    expect(summary.explanation.join(' ')).toMatch(/NO threshold|first cent/i);
  });

  it('keeps channels separate, because the threshold is per platform', () => {
    // $15,000 across two platforms is one form on neither.
    const summary = reporting1099k(
      [
        ...many(120, { channel: 'ebay', grossCents: 12500, shippingChargedCents: 0, salesTaxCollectedCents: 0 }),
        ...many(120, { channel: 'whatnot', grossCents: 12500, shippingChargedCents: 0, salesTaxCollectedCents: 0 }),
      ],
      year,
    );
    expect(summary.totalReportableGrossCents).toBe(3000000);
    expect(summary.formsExpected).toBe(0);
    for (const c of summary.channels) {
      expect(c.meetsTransactionTest).toBe(false);
    }
  });

  it('measures progress toward the binding test', () => {
    // Half the dollars, a tenth of the transactions: the count is binding.
    const summary = reporting1099k(
      many(20, { grossCents: 50000, shippingChargedCents: 0, salesTaxCollectedCents: 0 }),
      year,
    );
    const [progress] = thresholdProgress(summary, year);
    expect(progress!.dollarProgress).toBeCloseTo(0.5, 5);
    expect(progress!.transactionProgress).toBeCloseTo(0.1, 5);
    expect(progress!.overallProgress).toBeCloseTo(0.1, 5);
    expect(approachingThreshold(summary, year)).toHaveLength(0);
  });

  it('flags a channel closing in on both tests', () => {
    const summary = reporting1099k(
      many(170, { grossCents: 10000, shippingChargedCents: 0, salesTaxCollectedCents: 0 }),
      year,
    );
    const near = approachingThreshold(summary, year);
    expect(near).toHaveLength(1);
    expect(near[0]!.channel.channel).toBe('ebay');
    expect(near[0]!.channel.formExpected).toBe(false);
  });

  it('does not chase in-person channels toward a threshold that never applies', () => {
    const summary = reporting1099k(many(300, { channel: 'card-show', grossCents: 20000 }), year);
    expect(thresholdProgress(summary, year)).toHaveLength(0);
  });

  it('reports no unverified figures, since both thresholds are statutory', () => {
    const summary = reporting1099k([sale()], year);
    expect(summary.unverified).toEqual([]);
  });
});
