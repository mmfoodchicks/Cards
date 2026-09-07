/**
 * Utah sales tax for a Davis County seller.
 *
 * Two things make this worth encoding rather than looking up each time.
 *
 * FIRST, the rate depends on WHERE THE SALE HAPPENS, not where you live. A
 * home-based Layton seller charges the Layton rate on a local sale, but at a
 * show in Sunset charges the Sunset rate — Utah sources sales at a temporary
 * event to the event location. Getting that backwards under-collects or
 * over-collects on every transaction at the table.
 *
 * SECOND, most online sales are not yours to collect at all. Marketplaces are
 * required to collect and remit as marketplace facilitators, so eBay, Whatnot
 * and TCGplayer handle it. What is left for you is in-person sales and direct
 * sales you make yourself — which is exactly the part people forget, because
 * it is the small part.
 *
 * RATES CHANGE QUARTERLY. The Tax Commission republishes the combined rate
 * chart every quarter, so these carry an effective date and the app says when
 * they were last checked rather than presenting them as permanent.
 */

import type { IsoDate } from '../../domain/types.js';
import { applyRate, type Cents } from '../../domain/money.js';

export const RATE_SOURCE = 'https://tax.utah.gov/sales/rates';
export const RATE_CHART_Q3_2026 = 'https://files.tax.utah.gov/tax/salestax/rate/26q3combined.pdf';

/**
 * Combined rates for Davis County jurisdictions.
 *
 * Every jurisdiction in the county carries the same base stack of state, local
 * option, county option and transit components totalling 7.15%. Twelve of the
 * fifteen add a 0.10% municipal botanical, cultural and zoo tax on top, which
 * is the only thing that differentiates them.
 */
export interface JurisdictionRate {
  jurisdiction: string;
  locationCode: string;
  rate: number;
}

export const DAVIS_COUNTY_RATES: JurisdictionRate[] = [
  { jurisdiction: 'Davis County (unincorporated)', locationCode: '06-000', rate: 0.0715 },
  { jurisdiction: 'Bountiful', locationCode: '06-004', rate: 0.0725 },
  { jurisdiction: 'Centerville', locationCode: '06-006', rate: 0.0725 },
  { jurisdiction: 'Clearfield', locationCode: '06-008', rate: 0.0725 },
  { jurisdiction: 'Clinton', locationCode: '06-059', rate: 0.0725 },
  { jurisdiction: 'Farmington', locationCode: '06-017', rate: 0.0725 },
  { jurisdiction: 'Fruit Heights', locationCode: '06-010', rate: 0.0715 },
  { jurisdiction: 'Kaysville', locationCode: '06-026', rate: 0.0725 },
  { jurisdiction: 'Layton', locationCode: '06-030', rate: 0.0725 },
  { jurisdiction: 'North Salt Lake', locationCode: '06-035', rate: 0.0725 },
  { jurisdiction: 'South Weber', locationCode: '06-045', rate: 0.0725 },
  { jurisdiction: 'Sunset', locationCode: '06-048', rate: 0.0715 },
  { jurisdiction: 'Syracuse', locationCode: '06-049', rate: 0.0725 },
  { jurisdiction: 'West Bountiful', locationCode: '06-061', rate: 0.0725 },
  { jurisdiction: 'West Point', locationCode: '06-056', rate: 0.0715 },
  { jurisdiction: 'Woods Cross', locationCode: '06-057', rate: 0.0725 },
];

/** When these rates were taken from the Tax Commission chart. */
export const RATES_EFFECTIVE_FROM: IsoDate = '2026-07-01';
/** The last quarter confirmed to carry the same rates. */
export const RATES_CONFIRMED_THROUGH: IsoDate = '2026-12-31';

export function rateFor(jurisdiction: string): JurisdictionRate | null {
  const needle = jurisdiction.trim().toLowerCase();
  return (
    DAVIS_COUNTY_RATES.find((r) => r.jurisdiction.toLowerCase() === needle) ??
    DAVIS_COUNTY_RATES.find((r) => r.jurisdiction.toLowerCase().startsWith(needle)) ??
    null
  );
}

export type SaleContext =
  /** Sold through a marketplace that collects and remits as a facilitator. */
  | 'marketplace'
  /** In person at your own fixed place of business, including from home. */
  | 'own-location'
  /** At a card show, convention or other temporary event. */
  | 'temporary-event'
  /** Shipped directly to a Utah buyer, not through a marketplace. */
  | 'shipped-to-utah-buyer'
  /** Shipped to a buyer outside Utah. */
  | 'out-of-state';

export interface SalesTaxAdvice {
  /** Whether YOU have to collect, as opposed to a platform doing it. */
  youCollect: boolean;
  rate: number | null;
  jurisdiction: string | null;
  taxCents: Cents | null;
  explanation: string;
  /** How Utah decides which rate applies to this kind of sale. */
  sourcingRule: string;
}

export interface SalesTaxInput {
  context: SaleContext;
  /** Taxable amount, before tax. */
  saleCents: Cents;
  /** Where you are based. Used for sales at your own location. */
  homeJurisdiction: string;
  /** Where the event is. Used for temporary events. */
  eventJurisdiction?: string;
  /** Where the buyer is. Used for direct shipments to Utah buyers. */
  buyerJurisdiction?: string;
}

/**
 * What to charge, and why.
 *
 * Returns null rates rather than guessing when the jurisdiction is unknown —
 * charging a made-up rate is worse than saying you need to look it up.
 */
export function salesTaxFor(input: SalesTaxInput): SalesTaxAdvice {
  switch (input.context) {
    case 'marketplace':
      return {
        youCollect: false,
        rate: null,
        jurisdiction: null,
        taxCents: null,
        explanation:
          'The marketplace collects and remits this for you as a marketplace facilitator. Do not collect it ' +
          'again, and do not include it in your own gross receipts — it never becomes your money.',
        sourcingRule: 'Marketplace facilitator rules put the obligation on the platform, not on you.',
      };

    case 'out-of-state':
      return {
        youCollect: false,
        rate: null,
        jurisdiction: null,
        taxCents: null,
        explanation:
          'No Utah tax on a sale shipped out of state. Another state may have its own economic nexus threshold, ' +
          'but a small seller is very unlikely to cross one.',
        sourcingRule: 'Utah tax applies to sales sourced to Utah.',
      };

    case 'temporary-event': {
      const where = input.eventJurisdiction ?? '';
      const found = rateFor(where);
      return {
        youCollect: true,
        rate: found?.rate ?? null,
        jurisdiction: found?.jurisdiction ?? null,
        taxCents: found ? applyRate(input.saleCents, found.rate) : null,
        explanation: found
          ? `A sale at a show is sourced to where the show is, so charge the ${found.jurisdiction} rate of ` +
            `${(found.rate * 100).toFixed(2)}% — not your home rate.`
          : `Sales at a show are sourced to the event location, so you need the rate for ${where || 'that city'}. ` +
            'Look it up on the Tax Commission rate chart before the event.',
        sourcingRule:
          'Utah sources sales at a temporary event to the event location, not the seller’s place of business.',
      };
    }

    case 'own-location': {
      const found = rateFor(input.homeJurisdiction);
      return {
        youCollect: true,
        rate: found?.rate ?? null,
        jurisdiction: found?.jurisdiction ?? null,
        taxCents: found ? applyRate(input.saleCents, found.rate) : null,
        explanation: found
          ? `Sold from your own location, so charge the ${found.jurisdiction} rate of ${(found.rate * 100).toFixed(2)}%.`
          : `Look up the combined rate for ${input.homeJurisdiction || 'your city'} on the Tax Commission chart.`,
        sourcingRule: 'A sale made at your fixed place of business is sourced to that place of business.',
      };
    }

    case 'shipped-to-utah-buyer': {
      const found = rateFor(input.buyerJurisdiction ?? '');
      return {
        youCollect: true,
        rate: found?.rate ?? null,
        jurisdiction: found?.jurisdiction ?? null,
        taxCents: found ? applyRate(input.saleCents, found.rate) : null,
        explanation: found
          ? `Shipped to a Utah buyer, so the rate is where they receive it: ${found.jurisdiction} at ` +
            `${(found.rate * 100).toFixed(2)}%.`
          : 'A direct shipment to a Utah buyer is taxed at the buyer’s location. If they are outside Davis ' +
            'County, use the Tax Commission’s address look-up rather than these rates.',
        sourcingRule: 'A shipped sale is sourced to where the buyer receives the goods.',
      };
    }
  }
}

/** Practical notes that apply whatever the sale. */
export const SALES_TAX_NOTES = [
  'Sales tax you collect is not income. It is the state’s money passing through your hands, and it should not ' +
    'sit in the same account as your profit.',
  'Rates change quarterly. These were taken from the chart effective 1 July 2026 and confirmed unchanged through ' +
    'the end of the year — re-check them each quarter.',
  'Buying inventory for resale can be exempt from sales tax using an exemption certificate. That applies only to ' +
    'genuine resale stock, not to supplies you use up or a card you decide to keep.',
  'Once you hold a sales tax licence you must file returns on the schedule assigned to you, including for ' +
    'periods with no sales. A zero return still has to be filed.',
];
