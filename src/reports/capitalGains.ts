/**
 * Capital gains on cards held for investment — Form 8949 and Schedule D.
 *
 * Cards held as investments rather than as stock in trade never touch Schedule
 * C. Their gain is capital gain, and if the card was held for MORE than one
 * year it is "collectibles gain", which lands in a rate group capped at 28%.
 *
 * Why this module exists at all, and why it matters more than it looks:
 *
 *   A card sold out of a personal collection carries no self-employment tax.
 *   The same card sold as business inventory does — 15.3% on top of income tax.
 *   On a $2,400 gain that difference is roughly $339, before the rate
 *   difference between ordinary and capital treatment.
 *
 *   Character is tested asset by asset at the moment of sale, not once for the
 *   whole person. Someone can run a card business and still hold a personal
 *   collection, and courts have said so — but the burden is on the taxpayer,
 *   and it is won or lost on documentation and segregation.
 *
 * Two hard rules encoded here:
 *
 *   HOLDING PERIOD starts the day AFTER acquisition, and "long-term" means held
 *   for MORE than one year. Exactly one year is short-term. Sending a card to a
 *   grader is not a disposition and does not restart the clock.
 *
 *   THERE IS NO STEP-UP when a personal card is moved into business inventory.
 *   Basis carries over and the entire gain, including everything that accrued
 *   before the business existed, becomes ordinary income subject to SE tax.
 *
 * None of this is tax advice, and this specific situation — one collection
 * piece sold to seed a card business — is fact-dependent. The report exists so
 * the position can be seen, documented and taken to a preparer.
 */

import type { Cents } from '../domain/money.js';
import { sum } from '../domain/money.js';
import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import type { IsoDate } from '../domain/types.js';

/** Maximum rate on long-term collectibles gain. Statutory, not indexed. */
export const COLLECTIBLES_MAX_RATE = 0.28;
export const COLLECTIBLES_AUTHORITY = 'IRC 1(h)(4)-(5); collectibles defined at IRC 408(m)';

export type GainTerm = 'short-term' | 'long-term';

export interface CapitalDisposition {
  itemId: number;
  description: string;
  acquiredOn: IsoDate;
  soldOn: IsoDate;
  /** Sale price less selling costs, which reduce the amount realised. */
  proceedsCents: Cents;
  basisCents: Cents;
  gainCents: Cents;
  term: GainTerm;
  daysHeld: number;
  /** True when long-term gain on a collectible, so the 28% cap applies. */
  collectiblesRate: boolean;
}

export interface CapitalGainsReport {
  year: number;
  dispositions: CapitalDisposition[];
  shortTermGainCents: Cents;
  longTermGainCents: Cents;
  /** The part of long-term gain taxed in the 28% group. */
  collectiblesGainCents: Cents;
  totalGainCents: Cents;
  notes: string[];
}

/**
 * Whether a holding period is long-term.
 *
 * The clock starts the day after acquisition, and the gain is long-term only if
 * the asset was held MORE than one year — so a card bought 1 January and sold
 * the following 1 January is SHORT-term, and selling one day later is not.
 */
export function isLongTerm(acquiredOn: IsoDate, soldOn: IsoDate): boolean {
  const acquired = new Date(`${acquiredOn}T00:00:00Z`);
  const sold = new Date(`${soldOn}T00:00:00Z`);
  if (Number.isNaN(acquired.getTime()) || Number.isNaN(sold.getTime())) return false;

  // Holding begins the day after acquisition; one year later is the earliest
  // date that is still short-term.
  const oneYearOn = new Date(acquired);
  oneYearOn.setUTCFullYear(oneYearOn.getUTCFullYear() + 1);
  return sold.getTime() > oneYearOn.getTime();
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Capital dispositions for the year: sales of items held for investment.
 *
 * Selling costs (platform fees, processing, postage) reduce the amount realised
 * rather than being deducted, because an investor gets no deduction for them —
 * miscellaneous itemised deductions are disallowed. Netting them against
 * proceeds is the only way they ever count.
 */
export function capitalGainsForYear(year: number, db: Db = getDb()): CapitalGainsReport {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const rows = db.prepare(`
    SELECT
      i.id            AS itemId,
      i.description   AS description,
      i.acquired_on   AS acquiredOn,
      s.sold_on       AS soldOn,
      sl.allocated_gross_cents AS grossCents,
      sl.cogs_cents   AS basisCents,
      s.gross_cents   AS saleGrossCents,
      s.platform_fee_cents + s.payment_processing_fee_cents + s.other_fee_cents + s.shipping_cost_cents AS sellingCostsCents
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    JOIN inventory_items i ON i.id = sl.item_id
    WHERE i.holding_intent = 'investment'
      AND s.sold_on BETWEEN @from AND @to
    ORDER BY s.sold_on, i.id
  `).all({ from, to }) as Array<{
    itemId: number; description: string; acquiredOn: string; soldOn: string;
    grossCents: number; basisCents: number; saleGrossCents: number; sellingCostsCents: number;
  }>;

  const dispositions: CapitalDisposition[] = rows.map((r) => {
    // Spread the sale's selling costs across its lines in proportion to what
    // each contributed, so a multi-item sale nets correctly.
    const share = r.saleGrossCents > 0 ? r.grossCents / r.saleGrossCents : 1;
    const proceeds = r.grossCents - Math.round(r.sellingCostsCents * share);
    const longTerm = isLongTerm(r.acquiredOn, r.soldOn);
    return {
      itemId: r.itemId,
      description: r.description,
      acquiredOn: r.acquiredOn,
      soldOn: r.soldOn,
      proceedsCents: proceeds,
      basisCents: r.basisCents,
      gainCents: proceeds - r.basisCents,
      term: longTerm ? 'long-term' : 'short-term',
      daysHeld: daysBetween(r.acquiredOn, r.soldOn),
      collectiblesRate: longTerm,
    };
  });

  const shortTerm = dispositions.filter((d) => d.term === 'short-term');
  const longTerm = dispositions.filter((d) => d.term === 'long-term');

  const notes: string[] = [];
  if (dispositions.length > 0) {
    notes.push(
      'These are cards you recorded as held for investment, not as stock in trade. They belong on Form 8949 ' +
        'and Schedule D, not on Schedule C, and they are not subject to self-employment tax.',
    );
  }
  if (longTerm.length > 0) {
    notes.push(
      'Gain on collectibles held more than a year is taxed at your ordinary rate but capped at 28%. ' +
        'If your ordinary rate is below 28%, the cap does not bite and you simply pay your normal rate.',
    );
  }
  const nearMiss = shortTerm.filter((d) => d.daysHeld >= 330 && d.daysHeld <= 366);
  if (nearMiss.length > 0) {
    notes.push(
      `${nearMiss.length} sale${nearMiss.length === 1 ? '' : 's'} missed long-term treatment by a matter of days. ` +
        'Holding past the one-year mark, where you have the choice, changes the rate.',
    );
  }

  return {
    year,
    dispositions,
    shortTermGainCents: sum(shortTerm.map((d) => d.gainCents)),
    longTermGainCents: sum(longTerm.map((d) => d.gainCents)),
    collectiblesGainCents: sum(longTerm.filter((d) => d.collectiblesRate).map((d) => d.gainCents)),
    totalGainCents: sum(dispositions.map((d) => d.gainCents)),
    notes,
  };
}

/**
 * The schedule of items designated as held for investment.
 *
 * There is no statutory safe harbour for identifying a collectible as held for
 * investment — the provision that gives securities dealers a bright-line rule
 * is limited to securities. So a dated, contemporaneous written schedule is not
 * a formality: it is the best available evidence, and the case law that lets a
 * dealer hold personal pieces turned on exactly this kind of segregation.
 *
 * Exported so it can be printed, dated and kept.
 */
export interface InvestmentScheduleEntry {
  itemId: number;
  description: string;
  category: string | null;
  setName: string | null;
  year: number | null;
  acquiredOn: IsoDate;
  basisCents: Cents;
  estimatedValueCents: Cents | null;
  status: string;
  /** When the item was first recorded, which is when the designation was made. */
  designatedOn: string;
  certNumber: string | null;
  notes: string | null;
}

export function investmentSchedule(db: Db = getDb()): {
  generatedAt: string;
  entries: InvestmentScheduleEntry[];
  totalBasisCents: Cents;
  totalValueCents: Cents;
  guidance: string[];
} {
  const entries = db.prepare(`
    SELECT id AS itemId, description, category, set_name AS setName, year,
           acquired_on AS acquiredOn, basis_cents AS basisCents,
           estimated_value_cents AS estimatedValueCents, status,
           created_at AS designatedOn, cert_number AS certNumber, notes
    FROM inventory_items
    WHERE holding_intent = 'investment'
    ORDER BY acquired_on, id
  `).all() as InvestmentScheduleEntry[];

  return {
    generatedAt: new Date().toISOString(),
    entries,
    totalBasisCents: sum(entries.map((e) => e.basisCents)),
    totalValueCents: sum(entries.map((e) => e.estimatedValueCents ?? 0)),
    guidance: [
      'Print this, date it and sign it. A contemporaneous written schedule is the strongest evidence available ' +
        'that these cards are held for investment rather than as inventory.',
      'Keep these cards physically separate from business inventory, and never buy or sell them through the ' +
        'business bank account.',
      'Do not list them for sale — no listings, no show table, no stream. Sales effort is the factor that most ' +
        'often defeats an investment position.',
      'Their cost never appears in business purchases, and they are not part of business inventory at year end.',
    ],
  };
}
