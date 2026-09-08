/**
 * The valuation registry.
 *
 * WHY THERE IS NO EBAY ADAPTER HERE, since that is what everyone asks for first.
 *
 * eBay's sold-price data is closed. Verified against eBay's own documentation
 * rather than taken from a blog:
 *
 *   - The Finding API, which carried `findCompletedItems`, was decommissioned
 *     on 2025-02-04. eBay names the Browse API as its replacement.
 *   - The Browse API returns ACTIVE listings only. Its published OpenAPI spec
 *     was downloaded and searched: `lastSoldDate`, `lastSoldPrice` and
 *     `itemSales` occur zero times in 407 KB of schema.
 *   - The Marketplace Insights API is the only eBay endpoint that returns sold
 *     prices, and it is restricted to invited partners. Its spec URL now
 *     returns 404 while the Browse spec returns 200 — eBay has withdrawn it
 *     from the public surface entirely.
 *
 * So an individual developer cannot get eBay sold comps at any price. That is
 * not a gap to work around later; it is a fact to design around, and this
 * module does.
 *
 * WHAT EXISTS INSTEAD is one free source covering trading card games, and
 * nothing free covering sports cards. Rather than paper over that, the registry
 * reports honestly what it can and cannot value, so a sports card falls through
 * to manual entry with an explanation instead of to a wrong number.
 */

import { TcgCsvSource } from './tcgcsv.js';
import type { ValuationSource } from './types.js';

export * from './types.js';
export { TcgCsvSource } from './tcgcsv.js';

/** What a source cannot help with, phrased for the person reading it. */
export interface CoverageGap {
  what: string;
  why: string;
  instead: string;
}

/**
 * Categories no configured source covers.
 *
 * Sports cards are the big one and the user's own situation: his graded card is
 * a Topps Chrome, and there is no free source of sports card sold comps. Saying
 * so is more useful than returning a TCG price for it.
 */
export const COVERAGE_GAPS: CoverageGap[] = [
  {
    what: 'Sports cards — Topps, Panini, Bowman, Upper Deck',
    why:
      'No free source publishes sold comps for them. eBay\'s sold data is restricted to invited partners, ' +
      'and the paid aggregators that do cover sports start around $49 a month.',
    instead:
      'Look the card up yourself — eBay sold listings while signed in, or 130point — and type the number in. ' +
      'The app records where it came from and when, which is what matters for using it later.',
  },
  {
    what: 'Graded cards of any kind',
    why:
      'The free source carries the RAW market price only. A PSA 10 can be worth many times an ungraded copy, ' +
      'so applying a raw price to a slab would not be an approximation — it would be a different card.',
    instead:
      'Enter the graded value manually, noting the grader and grade. The app keeps them separate so a raw ' +
      'price can never be mistaken for a graded one.',
  },
  {
    what: 'Actual completed sales, for anything',
    why:
      'The free source gives a computed market price from live listings, not a list of what things sold for. ' +
      'Real sold comps are behind either an invitation from eBay or a paid subscription.',
    instead: 'Treat the number as an indication, not evidence. For anything that matters, keep your own comps.',
  },
];

const SOURCES = new Map<string, ValuationSource>();

export function registerSource(source: ValuationSource): void {
  SOURCES.set(source.key, source);
}

export function getSource(key: string): ValuationSource | null {
  return SOURCES.get(key) ?? null;
}

export function listSources(): ValuationSource[] {
  return [...SOURCES.values()];
}

/** Wire up the default sources. Idempotent, so repeated calls are harmless. */
export function registerDefaultSources(options: { tcgcsv?: TcgCsvSource } = {}): void {
  if (!SOURCES.has('tcgcsv')) registerSource(options.tcgcsv ?? new TcgCsvSource());
}

/** For tests, so one suite cannot leak sources into another. */
export function clearSources(): void {
  SOURCES.clear();
}
