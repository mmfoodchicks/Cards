/** Configuration, read once from the environment. */

import 'dotenv/config';
import { fromRoot } from './util/paths.js';

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(v) ? v : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = (process.env[name] ?? '').toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

export const config = {
  port: num('PORT', 8787),
  host: str('HOST', '0.0.0.0'),
  databasePath: fromRoot(str('DATABASE_PATH', './data/cardhawk.db')),
  currency: str('CURRENCY', 'USD'),
  marketplace: str('MARKETPLACE', 'EBAY_US'),
  estTaxRate: num('EST_TAX_RATE', 0.07),
  /** Used when a source reports no shipping cost at all. */
  assumedShippingCents: Math.round(num('ASSUMED_SHIPPING_DOLLARS', 0) * 100),

  ebay: {
    clientId: str('EBAY_CLIENT_ID'),
    clientSecret: str('EBAY_CLIENT_SECRET'),
    env: str('EBAY_ENV', 'production') as 'production' | 'sandbox',
    epnCampaignId: str('EBAY_EPN_CAMPAIGN_ID'),
    /**
     * eBay's calculated-shipping estimates and its price+shipping sort are both
     * inaccurate without a buyer location, so send one.
     */
    shipToZip: str('EBAY_SHIP_TO_ZIP', '10001'),
    shipToCountry: str('EBAY_SHIP_TO_COUNTRY', 'US'),
  },

  priceChartingToken: str('PRICECHARTING_TOKEN'),
  pokemonTcgApiKey: str('POKEMONTCG_API_KEY'),

  alerts: {
    ntfyTopic: str('NTFY_TOPIC'),
    ntfyServer: str('NTFY_SERVER', 'https://ntfy.sh'),
    webhookUrl: str('ALERT_WEBHOOK_URL'),
    minDiscountPct: num('ALERT_MIN_DISCOUNT_PCT', 20) / 100,
  },

  scheduler: {
    enabled: bool('SCHEDULER_ENABLED', true),
    /** How often the scheduler wakes up to see which watches are due. */
    tickSeconds: num('SCHEDULER_TICK_SECONDS', 60),
  },

  /**
   * eBay's Browse API allows 5,000 calls/day on a free keyset, shared across
   * every user of the application. A runaway loop can burn a whole day in
   * minutes, so the budget is enforced locally rather than discovered via 429s.
   */
  maxApiCallsPerDay: num('MAX_API_CALLS_PER_DAY', 4500),

  logLevel: str('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
} as const;

export type Config = typeof config;

export function ebayConfigured(): boolean {
  return config.ebay.clientId !== '' && config.ebay.clientSecret !== '';
}
