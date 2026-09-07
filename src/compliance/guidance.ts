/**
 * Situational guidance.
 *
 * Generic tax tips are worthless. These fire only when the records show the
 * situation actually applies, and each one names the dollar consequence rather
 * than gesturing at "consult a professional".
 *
 * Everything here is a prompt to look into something, not a conclusion. Where
 * the law is genuinely fact-dependent — and the first item below is the clearest
 * example in this whole domain — it says so.
 */

import type { Cents } from '../domain/money.js';
import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import { getProfile } from '../db/repos.js';
import { isLongTerm } from '../reports/capitalGains.js';
import type { IsoDate } from '../domain/types.js';

export type GuidanceSeverity = 'opportunity' | 'caution' | 'information';

export interface Guidance {
  id: string;
  severity: GuidanceSeverity;
  title: string;
  /** Why this is showing, in terms of the user's own records. */
  because: string;
  body: string[];
  /** Roughly what is at stake, when it can be estimated. */
  worthCents?: Cents;
  /** Concrete next steps, in order. */
  steps?: string[];
}

export interface GuidanceInput {
  today?: Date;
  db?: Db;
}

export function guidanceFor(input: GuidanceInput = {}): Guidance[] {
  const db = input.db ?? getDb();
  const today = input.today ?? new Date();
  const todayIso = today.toISOString().slice(0, 10) as IsoDate;
  const profile = getProfile(db);
  const out: Guidance[] = [];

  out.push(...seedCardGuidance(db, profile.startedOn, todayIso));
  out.push(...nearLongTermGuidance(db, todayIso));
  out.push(...yearEndInventoryGuidance(db, todayIso));
  out.push(...zeroBasisGuidance(db));

  return out;
}

/**
 * The single highest-value piece of sequencing advice for someone starting out.
 *
 * A card held personally, sold BEFORE the business starts trading, is a capital
 * gain: no self-employment tax, and the rate on a long-held collectible is
 * capped at 28%. The same card sold after the business is running, on the same
 * accounts, alongside flips, is much harder to defend as anything other than
 * inventory — and if that argument loses, the ENTIRE gain, including everything
 * that accrued before the business existed, becomes ordinary income with
 * self-employment tax on top.
 *
 * There is no step-up when a personal card becomes inventory. Basis carries
 * over and character is tested at sale.
 */
function seedCardGuidance(db: Db, startedOn: IsoDate | null, today: IsoDate): Guidance[] {
  const held = db.prepare(`
    SELECT id, description, acquired_on AS acquiredOn, basis_cents AS basisCents,
           estimated_value_cents AS estimatedValueCents, status
    FROM inventory_items
    WHERE holding_intent = 'investment'
      AND status IN ('on-hand', 'listed', 'at-grading')
      AND estimated_value_cents IS NOT NULL
      AND estimated_value_cents > basis_cents
    ORDER BY (estimated_value_cents - basis_cents) DESC
    LIMIT 3
  `).all() as Array<{
    id: number; description: string; acquiredOn: string; basisCents: number;
    estimatedValueCents: number; status: string;
  }>;

  return held.map((item) => {
    const gain = item.estimatedValueCents - item.basisCents;
    // Self-employment tax is roughly 15.3% of 92.35% of profit. That is the
    // amount at stake purely from the classification, before any rate
    // difference between ordinary and capital treatment.
    const seTaxIfInventory = Math.round(gain * 0.153 * 0.9235);
    const longTerm = isLongTerm(item.acquiredOn, today);
    const businessStarted = startedOn !== null && startedOn <= today;

    return {
      id: `seed-card-${item.id}`,
      severity: 'opportunity' as const,
      title: `Selling "${item.description}" before you start trading is worth real money`,
      because:
        `You are holding it as a personal collection piece, acquired ${item.acquiredOn}, ` +
        `with about ${fmt(gain)} of gain on paper.`,
      worthCents: seTaxIfInventory,
      body: [
        `Sold out of your personal collection, this is a capital gain: reported on Form 8949, with NO ` +
          `self-employment tax. ${longTerm
            ? 'You have held it more than a year, so the rate is capped at 28% — and if your ordinary rate is lower, you simply pay that.'
            : 'You have held it a year or less, so it is a short-term gain taxed at ordinary rates. Holding past the one-year mark, if you can, changes that.'}`,
        `Sold as business inventory, the whole thing is ordinary income on Schedule C and picks up about ` +
          `${fmt(seTaxIfInventory)} of self-employment tax on top of income tax — including on all the ` +
          `appreciation that happened before the business existed. There is no step-up when a personal card ` +
          `becomes inventory.`,
        businessStarted
          ? 'Your business has already started trading, which makes the personal-collection position harder to ' +
            'hold — especially if this sells on the same account, alongside flips. Keep it completely separate ' +
            'and talk to a preparer before selling.'
          : 'Your business has not started trading yet, which is the strongest position you will ever be in for ' +
            'this. One sale of a personal item is not a trade or business, and there are no customers.',
        'This exact situation — one collection piece sold to seed a card business — has not been litigated on ' +
          'these facts. The closest authority favours you, but it is fact-dependent. Paper the position with a ' +
          'CPA BEFORE you sell, not after.',
      ],
      steps: businessStarted
        ? [
            'Keep this card entirely out of the business: separate storage, separate account, never listed alongside inventory.',
            'Print the personal collection schedule from Reports, date it and sign it.',
            'Talk to a CPA about the position before you sell.',
          ]
        : [
            'Sell it in your own name, from your own account, before you open a business account or list a single flip.',
            'Keep the records showing when you acquired it and what it cost.',
            'Report it on Form 8949 and Schedule D.',
            'Then put the after-tax cash into the business as your own capital contribution.',
          ],
    };
  });
}

/** Cards close to the one-year mark, where waiting changes the rate. */
function nearLongTermGuidance(db: Db, today: IsoDate): Guidance[] {
  const rows = db.prepare(`
    SELECT id, description, acquired_on AS acquiredOn, basis_cents AS basisCents,
           estimated_value_cents AS estimatedValueCents
    FROM inventory_items
    WHERE holding_intent = 'investment'
      AND status IN ('on-hand', 'listed')
      AND estimated_value_cents IS NOT NULL
      AND estimated_value_cents > basis_cents
  `).all() as Array<{ id: number; description: string; acquiredOn: string; basisCents: number; estimatedValueCents: number }>;

  const approaching = rows.filter((r) => {
    if (isLongTerm(r.acquiredOn, today)) return false;
    const anniversary = new Date(`${r.acquiredOn}T00:00:00Z`);
    anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
    const days = Math.round((anniversary.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    return days >= 0 && days <= 60;
  });

  if (approaching.length === 0) return [];

  return [
    {
      id: 'near-long-term',
      severity: 'information',
      title: `${approaching.length} collection card${approaching.length === 1 ? '' : 's'} approaching the one-year mark`,
      because: 'They are held for investment and will cross from short-term to long-term within two months.',
      body: [
        'Gain on a collectible held MORE than a year is capped at 28%; held a year or less it is taxed at your ' +
          'ordinary rate. The anniversary itself is still short-term — you need one more day past it.',
        'This only matters for cards held as personal collection. Inventory is ordinary income however long you hold it.',
      ],
      steps: approaching.map((r) => `"${r.description}" — acquired ${r.acquiredOn}`),
    },
  ];
}

/** The December buying misconception. */
function yearEndInventoryGuidance(db: Db, today: IsoDate): Guidance[] {
  const month = Number(today.slice(5, 7));
  if (month < 11) return [];

  const onHand = db.prepare(`
    SELECT COALESCE(SUM(basis_cents), 0) AS total, COUNT(*) AS n
    FROM inventory_items
    WHERE holding_intent = 'inventory' AND status IN ('on-hand', 'listed', 'at-grading')
  `).get() as { total: number; n: number };

  if (onHand.n === 0) return [];

  return [
    {
      id: 'year-end-inventory',
      severity: 'caution',
      title: 'Buying inventory before year end is not a tax deduction',
      because: `You are holding ${onHand.n} items with ${fmt(onHand.total)} of cost that has not been deducted yet.`,
      body: [
        'The cost of inventory is deducted when the item SELLS, not when you buy it. A December buying spree ' +
          'does not reduce this year\'s tax — it just moves cash into stock.',
        'What does reduce this year: supplies you actually use, equipment you place in service, fees you pay, ' +
          'and miles you drive.',
      ],
    },
  ];
}

/** Items carrying no cost at all, which are pure profit when they sell. */
function zeroBasisGuidance(db: Db): Guidance[] {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM inventory_items
    WHERE holding_intent = 'inventory'
      AND status IN ('on-hand', 'listed')
      AND basis_cents = 0
  `).get() as { n: number };

  if (row.n === 0) return [];

  return [
    {
      id: 'zero-basis',
      severity: 'caution',
      title: `${row.n} item${row.n === 1 ? '' : 's'} in stock with no cost recorded`,
      because: 'They will be entirely taxable profit when they sell.',
      body: [
        'That is the right answer if they genuinely cost nothing — bulk from an opened box where all the value ' +
          'sat in the hits, for instance.',
        'If it is a data-entry gap, fix it now. Reallocating a purchase after the items have sold is not ' +
          'possible, because their cost has already gone into a reported period.',
      ],
      steps: ['Open Inventory and filter to what is on hand.', 'Check anything showing a zero cost.'],
    },
  ];
}

function fmt(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
