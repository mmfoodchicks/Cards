/**
 * Form 1099-K — what the marketplaces will tell the IRS about you.
 *
 * The threshold moved twice in five years and the confusion it caused is still
 * doing damage, so the exact position matters.
 *
 * The American Rescue Plan Act of 2021 dropped the threshold to $600 with no
 * transaction count. The IRS delayed it three times and never enforced it. Then
 * the One, Big, Beautiful Bill Act retroactively repealed it outright, putting
 * the pre-2021 rule back: a third party settlement organisation files only when
 * gross payments exceed $20,000 AND the transaction count exceeds 200 — both
 * tests, not either (IR-2025-107 and Fact Sheet 2025-08, 23 October 2025).
 *
 * Three things follow, and every one of them catches people out:
 *
 *   1. THE THRESHOLD IS THE PLATFORM'S, NOT YOURS. It decides whether eBay has
 *      to mail a form. It decides nothing whatsoever about whether the money is
 *      taxable. The IRS says it in as many words: "All income, no matter the
 *      amount, is taxable unless the tax law says it isn't — even if you don't
 *      get a Form 1099-K." Selling $8,000 of cards with no form is $8,000 of
 *      reportable income.
 *
 *   2. CARD READERS HAVE NO THRESHOLD AT ALL. Payment card transactions are
 *      reported under a different paragraph of the same section, and it has no
 *      floor. Take one $40 payment on a Square reader at a card show and that
 *      $40 is on a 1099-K. This is the most common surprise for someone whose
 *      online sales are comfortably under $20,000.
 *
 *   3. THE FORM SHOWS A NUMBER YOU NEVER RECEIVED. It reports GROSS — the full
 *      amount buyers paid, including shipping they paid and sales tax the
 *      platform collected, before fees and before refunds. It will be higher
 *      than your bank deposits, sometimes by 20%. The return has to start from
 *      that gross figure and deduct the difference, or it stops matching a form
 *      the IRS already holds.
 *
 * So this module computes what each platform will report using the platform's
 * definition of gross, not the accounting one.
 */

import type { Cents } from '../domain/money.js';
import type { SalesChannel } from '../domain/types.js';
import { isUsable, valueOf, type TaxYearFigures } from './figures.js';

/** How a channel gets reported, which decides which threshold applies. */
export type ReportingBasis =
  /** A third party settlement organisation: both thresholds apply. */
  | 'settlement-organisation'
  /** Reported by the payment processor from the first cent, with no threshold. */
  | 'payment-card'
  /** Nobody reports it. You still do. */
  | 'self-reported';

interface ChannelRule {
  basis: ReportingBasis;
  label: string;
  note: string;
}

/**
 * In-person channels are the ambiguous ones: cash is reported by nobody, but
 * the same sale taken on a card reader is reported from the first cent. The
 * records cannot tell the two apart, so they are treated as self-reported and
 * the caller is told to check.
 */
const CHANNEL_RULES: Record<SalesChannel, ChannelRule> = {
  ebay: {
    basis: 'settlement-organisation',
    label: 'eBay',
    note: 'Managed payments makes eBay the settlement organisation, so it reports your gross.',
  },
  whatnot: {
    basis: 'settlement-organisation',
    label: 'Whatnot',
    note: 'Live breaks and auctions settle through Whatnot, which reports the gross.',
  },
  tcgplayer: {
    basis: 'settlement-organisation',
    label: 'TCGplayer',
    note: 'TCGplayer settles seller payments and reports them.',
  },
  comc: {
    basis: 'settlement-organisation',
    label: 'COMC',
    note: 'COMC holds and settles the proceeds, so it reports them.',
  },
  mercari: {
    basis: 'settlement-organisation',
    label: 'Mercari',
    note: 'Mercari settles payments and reports the gross.',
  },
  'fanatics-collect': {
    basis: 'settlement-organisation',
    label: 'Fanatics Collect',
    note: 'Auction proceeds settle through the platform and are reported.',
  },
  website: {
    basis: 'settlement-organisation',
    label: 'Own website',
    note:
      'Your processor reports this — Stripe, PayPal, Shopify Payments. Which thresholds apply depends on ' +
      'whether it is treated as a settlement organisation or as card acceptance, and card acceptance has no ' +
      'threshold. Assume you will get a form.',
  },
  'card-show': {
    basis: 'self-reported',
    label: 'Card show',
    note:
      'Cash and cheque are reported by nobody. But if ANY of this went through a card reader — Square, ' +
      'PayPal Zettle, Stripe Terminal — that part is a payment card transaction with no threshold, and it ' +
      'will appear on a 1099-K from the first cent.',
  },
  'local-in-person': {
    basis: 'self-reported',
    label: 'Local, in person',
    note:
      'Cash is reported by nobody. Peer-to-peer app payments marked as goods and services are, and a card ' +
      'reader is reported from the first cent.',
  },
  trade: {
    basis: 'self-reported',
    label: 'Trade',
    note:
      'No platform reports a trade, because no platform was involved. It is still a taxable disposition ' +
      'and still your income to report.',
  },
  other: {
    basis: 'self-reported',
    label: 'Other',
    note: 'No form assumed. Check how each of these was actually paid.',
  },
};

export interface ChannelReporting {
  channel: SalesChannel;
  label: string;
  basis: ReportingBasis;
  /**
   * Gross as the PLATFORM defines it: what buyers paid, including shipping they
   * paid and sales tax collected, before fees and before refunds.
   */
  reportableGrossCents: Cents;
  /** What actually rolls into Schedule C gross receipts (goods and shipping). */
  scheduleCReceiptsCents: Cents;
  /** The gap between the two, which the return has to explain away. */
  reconcilingCents: Cents;
  transactionCount: number;
  meetsDollarTest: boolean;
  meetsTransactionTest: boolean;
  /** True when a form is expected on these records alone. */
  formExpected: boolean;
  note: string;
}

export interface Reporting1099kSummary {
  year: number;
  channels: ChannelReporting[];
  /** Total the platforms are expected to report. */
  expectedOnFormsCents: Cents;
  formsExpected: number;
  /** Everything sold, form or no form. This is what gets reported. */
  totalReportableGrossCents: Cents;
  /** Channels short of the threshold, where income is taxable but unreported by anyone. */
  belowThresholdCents: Cents;
  explanation: string[];
  unverified: string[];
}

export interface SaleForReporting {
  channel: SalesChannel;
  grossCents: Cents;
  shippingChargedCents: Cents;
  salesTaxCollectedCents: Cents;
  refundedCents: Cents;
}

export function reporting1099k(
  sales: readonly SaleForReporting[],
  year: TaxYearFigures,
): Reporting1099kSummary {
  const explanation: string[] = [];
  const unverified: string[] = [];
  const f = year.figures;

  const dollarFigure = f['reporting.1099k.dollarThreshold'];
  const countFigure = f['reporting.1099k.transactionThreshold'];

  for (const fig of [dollarFigure, countFigure]) {
    if (fig && fig.confidence !== 'verified') {
      unverified.push(`${fig.label} (${fig.note ?? 'not confirmed against a primary source'})`);
    }
  }

  // Without a usable threshold the safe assumption is that everything is
  // reported, because over-preparing costs nothing and under-preparing means a
  // form arrives that the return does not match.
  const dollarThreshold = isUsable(dollarFigure) ? valueOf(dollarFigure) : 0;
  const countThreshold = isUsable(countFigure) ? valueOf(countFigure) : 0;

  const byChannel = new Map<SalesChannel, {
    reportable: number;
    receipts: number;
    count: number;
  }>();

  for (const sale of sales) {
    const bucket = byChannel.get(sale.channel) ?? { reportable: 0, receipts: 0, count: 0 };
    // Gross as the platform reports it: no reduction for refunds or fees.
    bucket.reportable += sale.grossCents + sale.shippingChargedCents + sale.salesTaxCollectedCents;
    bucket.receipts += sale.grossCents + sale.shippingChargedCents;
    bucket.count += 1;
    byChannel.set(sale.channel, bucket);
  }

  const channels: ChannelReporting[] = [];
  for (const [channel, bucket] of byChannel) {
    const rule = CHANNEL_RULES[channel];
    const meetsDollarTest = bucket.reportable > dollarThreshold;
    const meetsTransactionTest = bucket.count > countThreshold;

    let formExpected: boolean;
    switch (rule.basis) {
      case 'settlement-organisation':
        formExpected = meetsDollarTest && meetsTransactionTest;
        break;
      case 'payment-card':
        formExpected = bucket.count > 0;
        break;
      default:
        formExpected = false;
    }

    channels.push({
      channel,
      label: rule.label,
      basis: rule.basis,
      reportableGrossCents: bucket.reportable,
      scheduleCReceiptsCents: bucket.receipts,
      reconcilingCents: bucket.reportable - bucket.receipts,
      transactionCount: bucket.count,
      meetsDollarTest,
      meetsTransactionTest,
      formExpected,
      note: rule.note,
    });
  }

  channels.sort((a, b) => b.reportableGrossCents - a.reportableGrossCents);

  const expectedOnForms = sum(channels.filter((c) => c.formExpected).map((c) => c.reportableGrossCents));
  const total = sum(channels.map((c) => c.reportableGrossCents));
  const below = total - expectedOnForms;

  explanation.push(
    `A marketplace files a Form 1099-K only when it settles MORE than ${fmt(dollarThreshold)} for you and ` +
      `MORE than ${countThreshold} transactions. Both tests, not either.`,
  );
  explanation.push(
    'That threshold decides whether the platform sends a form. It decides nothing about whether the money ' +
      'is taxable — all of it is reportable either way.',
  );

  if (channels.some((c) => c.formExpected)) {
    explanation.push(
      `Expect ${channels.filter((c) => c.formExpected).length} form(s) totalling ${fmt(expectedOnForms)}. ` +
        'That figure includes shipping buyers paid and sales tax the platform collected, so it will be higher ' +
        'than the receipts on Schedule C line 1 and higher still than what reached your bank.',
    );
  }

  if (below > 0) {
    explanation.push(
      `${fmt(below)} is below the reporting thresholds, so no form will arrive for it. It is taxable ` +
        'regardless, and it is the part most likely to be left off a return by accident.',
    );
  }

  if (channels.some((c) => c.basis === 'self-reported' && c.transactionCount > 0)) {
    explanation.push(
      'In-person sales are recorded here as self-reported. If any of them were taken on a card reader, that ' +
        'part is a payment card transaction with NO threshold and will appear on a 1099-K from the first cent.',
    );
  }

  return {
    year: year.year,
    channels,
    expectedOnFormsCents: expectedOnForms,
    formsExpected: channels.filter((c) => c.formExpected).length,
    totalReportableGrossCents: total,
    belowThresholdCents: below,
    explanation,
    unverified,
  };
}

/**
 * How close a channel is to tripping the thresholds.
 *
 * Worth knowing in October rather than in January, because the answer changes
 * what you do: once a form is coming, the return has to reconcile to a gross
 * figure, and that is much easier if the fee and refund records were kept all
 * along instead of reconstructed afterwards.
 */
export interface ThresholdProgress {
  channel: ChannelReporting;
  /** Share of the dollar test met, capped at 1. */
  dollarProgress: number;
  /** Share of the transaction test met, capped at 1. */
  transactionProgress: number;
  /** The binding one: a form needs BOTH, so progress is the lesser of the two. */
  overallProgress: number;
}

export function thresholdProgress(
  summary: Reporting1099kSummary,
  year: TaxYearFigures,
): ThresholdProgress[] {
  const f = year.figures;
  const dollarFigure = f['reporting.1099k.dollarThreshold'];
  const countFigure = f['reporting.1099k.transactionThreshold'];
  const dollarThreshold = isUsable(dollarFigure) ? valueOf(dollarFigure) : 0;
  const countThreshold = isUsable(countFigure) ? valueOf(countFigure) : 0;

  return summary.channels
    .filter((c) => c.basis === 'settlement-organisation')
    .map((channel) => {
      const dollarProgress = dollarThreshold > 0
        ? Math.min(1, channel.reportableGrossCents / dollarThreshold)
        : 1;
      const transactionProgress = countThreshold > 0
        ? Math.min(1, channel.transactionCount / countThreshold)
        : 1;
      return {
        channel,
        dollarProgress,
        transactionProgress,
        overallProgress: Math.min(dollarProgress, transactionProgress),
      };
    })
    .sort((a, b) => b.overallProgress - a.overallProgress);
}

/** Channels that are close enough to a form to be worth preparing for. */
export function approachingThreshold(
  summary: Reporting1099kSummary,
  year: TaxYearFigures,
  within = 0.8,
): ThresholdProgress[] {
  return thresholdProgress(summary, year).filter(
    (p) => !p.channel.formExpected && p.overallProgress >= within,
  );
}

function sum(values: readonly number[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}

function fmt(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
