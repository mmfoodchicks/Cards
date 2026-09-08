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
import { approachingThreshold, reporting1099k } from '../tax/reporting1099k.js';
import { incomeTax } from '../tax/incomeTax.js';
import { selfEmploymentTax } from '../tax/selfEmployment.js';
import type { TaxYearFigures } from '../tax/figures.js';
import { taxYear } from '../tax/registry.js';
import { startupCosts, type StartupExpense } from '../tax/startupCosts.js';
import type { FilingStatus, IsoDate, SalesChannel } from '../domain/types.js';

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
  out.push(...marketplaceReportingGuidance(db, todayIso));
  out.push(...startupCostGuidance(db, profile.startedOn, todayIso));
  out.push(...tradeGuidance(db, todayIso));

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

  const year = Number(today.slice(0, 4));
  const figures = taxYear(year);
  const profile = getProfile(db);

  return held.map((item) => {
    const gain = item.estimatedValueCents - item.basisCents;
    const longTerm = isLongTerm(item.acquiredOn, today);
    const businessStarted = startedOn !== null && startedOn <= today;

    // What the classification is actually worth, computed both ways rather than
    // quoted as the raw self-employment tax.
    //
    // Quoting the SE tax alone overstates it, often badly. Ordinary treatment
    // costs the SE tax, but it also brings the deduction for half of that tax
    // AND the section 199A deduction, which together claw a good deal of it
    // back. Meanwhile capital treatment is not free either: a collectible is
    // taxed up to 28%. The number worth showing is the difference.
    const cost = classificationCost(gain, item.acquiredOn, today, profile, figures);

    return {
      id: `seed-card-${item.id}`,
      severity: 'opportunity' as const,
      title: `Selling "${item.description}" before you start trading is worth real money`,
      because:
        `You are holding it as a personal collection piece, acquired ${item.acquiredOn}, ` +
        `with about ${fmt(gain)} of gain on paper.`,
      worthCents: cost.differenceCents,
      body: [
        `Sold out of your personal collection, this is a capital gain: reported on Form 8949, with NO ` +
          `self-employment tax. ${longTerm
            ? 'You have held it more than a year, so the rate is capped at 28% — and if your ordinary rate is lower, you simply pay that.'
            : 'You have held it a year or less, so it is a short-term gain taxed at ordinary rates. Holding past the one-year mark, if you can, changes that.'}`,
        cost.explanation,
        `There is no step-up when a personal card becomes inventory: the basis carries over and the character ` +
          `is tested at sale, so ALL the appreciation — including everything that accrued before the business ` +
          `existed — is caught.`,
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

/**
 * Trades, which feel free and are not.
 *
 * No money changes hands, so nothing feels like it happened. The regulation
 * disagrees: Reg. 1.1001-1(a) treats "the exchange of property for other
 * property differing materially either in kind or in extent" as a realisation
 * event, and the amount realised is "the fair market value of any property
 * (other than money) received."
 *
 * The folklore that trades are tax-free is not merely wrong, it is out of date
 * in a specific way worth naming: like-kind exchange under section 1031 used to
 * cover personal property, and the 2017 Act limited it to REAL property for
 * exchanges after 31 December 2017. So the rule people half-remember was real
 * once. It just has not applied to cards for years.
 */
function tradeGuidance(db: Db, today: IsoDate): Guidance[] {
  const year = Number(today.slice(0, 4));
  const row = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(gross_cents), 0) AS gross
    FROM sales
    WHERE channel = 'trade' AND sold_on BETWEEN @from AND @to
  `).get({ from: `${year}-01-01`, to: `${year}-12-31` }) as { n: number; gross: number };

  if (row.n === 0) return [];

  return [
    {
      id: 'trades-are-taxable',
      severity: 'caution',
      title: `${row.n} trade${row.n === 1 ? '' : 's'} this year, and ${row.n === 1 ? 'it counts' : 'they count'} as income`,
      because: `You recorded ${fmt(row.gross)} of property received in trade during ${year}.`,
      body: [
        'A trade is a taxable disposition. The gain is the value of what you received less the cost of what ' +
          'you gave up, and it is taxed in the year of the trade — not when you eventually sell what you got.',
        'Section 1031 does not help. Like-kind exchange was limited to REAL property in 2017; it has not ' +
          'covered cards since. The "trades are not taxable" rule people remember was real once and is not now.',
        'Because no cash came in, the tax on a trade has to be funded from somewhere else. That is the part ' +
          'that catches people — a good trade can leave you owing money you never received.',
      ],
      steps: [
        'Keep evidence of what the cards you received were worth on the day — that value IS the tax figure.',
        'Set aside the tax on the gain now, since the trade itself produced no cash to pay it with.',
      ],
    },
  ];
}

/**
 * What the platforms are about to tell the IRS about you.
 *
 * Two failure modes, opposite in shape and both expensive.
 *
 * The first is assuming no form means no tax. It is the single most common
 * misconception in online reselling, and the retroactive repeal of the $600
 * rule made it worse by convincing people something changed about taxability.
 * Nothing did. The threshold governs whether eBay must file a form; the income
 * was always reportable.
 *
 * The second is being surprised in January by a form showing thousands more
 * than you banked, and having no fee or refund records to bridge the gap.
 * Knowing a form is coming while there is still time to keep those records is
 * the whole point of firing this early.
 */
function marketplaceReportingGuidance(db: Db, today: IsoDate): Guidance[] {
  const year = Number(today.slice(0, 4));
  const figures = taxYear(year);
  if (!figures) return [];

  const sales = db.prepare(`
    SELECT channel,
           gross_cents                AS grossCents,
           shipping_charged_cents     AS shippingChargedCents,
           sales_tax_collected_cents  AS salesTaxCollectedCents,
           refunded_cents             AS refundedCents
    FROM sales
    WHERE sold_on BETWEEN @from AND @to
  `).all({ from: `${year}-01-01`, to: `${year}-12-31` }) as Array<{
    channel: string;
    grossCents: number;
    shippingChargedCents: number;
    salesTaxCollectedCents: number;
    refundedCents: number;
  }>;

  if (sales.length === 0) return [];

  const summary = reporting1099k(
    sales.map((s) => ({
      channel: s.channel as SalesChannel,
      grossCents: s.grossCents,
      shippingChargedCents: s.shippingChargedCents,
      salesTaxCollectedCents: s.salesTaxCollectedCents,
      refundedCents: s.refundedCents,
    })),
    figures,
  );

  const out: Guidance[] = [];

  const withForms = summary.channels.filter((c) => c.formExpected);
  if (withForms.length > 0) {
    const gap = sum(withForms.map((c) => c.reconcilingCents));
    out.push({
      id: 'reporting-1099k-expected',
      severity: 'caution',
      title: `${withForms.length} platform${withForms.length === 1 ? '' : 's'} will send you a 1099-K`,
      because:
        `${withForms.map((c) => c.label).join(', ')} passed both tests — over $20,000 settled and over ` +
        '200 transactions.',
      body: [
        `The forms will total about ${fmt(summary.expectedOnFormsCents)}. That is gross: it includes shipping ` +
          'buyers paid and sales tax the platform collected, and it is not reduced by fees or refunds.',
        `Roughly ${fmt(gap)} of that is sales tax the platform already sent to the state on your behalf. It is ` +
          'not your income, but it IS on the form, so the return has to show where it went.',
        'Start Schedule C line 1 from the gross figure and deduct down. Reporting the net payout instead is the ' +
          'mistake that makes a return disagree with a form the IRS already holds.',
      ],
      steps: [
        'Keep the annual fee and refund statement from each platform.',
        'Run Reports → Schedule C worksheet and check line 1 against the sum of the forms.',
        'Reconcile each form in January before filing, not after a notice arrives.',
      ],
    });
  }

  const near = approachingThreshold(summary, figures);
  if (near.length > 0) {
    out.push({
      id: 'reporting-1099k-approaching',
      severity: 'information',
      title: `${near.map((p) => p.channel.label).join(', ')} closing in on a 1099-K`,
      because:
        near
          .map(
            (p) =>
              `${p.channel.label}: ${fmt(p.channel.reportableGrossCents)} across ` +
              `${p.channel.transactionCount} sales.`,
          )
          .join(' '),
      body: [
        'A form needs BOTH more than $20,000 and more than 200 transactions on that one platform. Crossing ' +
          'only one of them means no form.',
        'This changes nothing about what you owe. It changes how closely the return is matched against ' +
          'third-party data, which is a reason to have the fee and refund records straight now rather than in April.',
      ],
    });
  }

  if (summary.belowThresholdCents > 0 && withForms.length === 0) {
    out.push({
      id: 'reporting-1099k-below',
      severity: 'caution',
      title: 'No 1099-K is coming, and the income is taxable anyway',
      because: `${fmt(summary.belowThresholdCents)} of sales this year sits below every reporting threshold.`,
      body: [
        'The IRS puts it plainly: all income, no matter the amount, is taxable unless the law says it is not — ' +
          'even if you do not get a Form 1099-K.',
        'The repeal of the $600 rule changed which platforms must file. It changed nothing about what you must report.',
        'Your own records are the only record of this income, which is exactly why they have to be right.',
      ],
    });
  }

  const inPerson = summary.channels.filter((c) => c.basis === 'self-reported' && c.transactionCount > 0);
  if (inPerson.length > 0) {
    out.push({
      id: 'reporting-1099k-card-reader',
      severity: 'information',
      title: 'Card-reader sales at shows have no threshold at all',
      because: `You recorded ${sum(inPerson.map((c) => c.transactionCount))} in-person sale(s) this year.`,
      body: [
        'Cash is reported by nobody. But a payment card transaction is reported from the first cent — there is ' +
          'no $20,000 floor and no transaction count for it.',
        'So a single $40 swipe on a Square reader at a Layton show puts you on a 1099-K, even if everything ' +
          'else you did all year was cash.',
        'If you use a reader, expect a form from the processor and reconcile it like any other.',
      ],
    });
  }

  return out;
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Money spent before the doors open.
 *
 * Section 195 is the deduction people most often lose outright, because the
 * costs land in the wrong mental bucket. Driving to a show to see what sells,
 * an hour with a CPA on how to set this up, the city licence, a subscription to
 * a price guide — all of it is deductible, and all of it is invisible unless it
 * was written down at the time.
 *
 * The trap runs the other way too. Cards bought before opening feel like a
 * start-up cost and are not: they are inventory, and their cost only comes back
 * when they sell. Someone who spends $8,000 on wax in March expecting an $8,000
 * deduction in April is going to be unpleasantly surprised.
 */
function startupCostGuidance(db: Db, startedOn: IsoDate | null, today: IsoDate): Guidance[] {
  const rows = db.prepare(`
    SELECT id, incurred_on AS incurredOn, account_key AS accountKey,
           description, amount_cents AS amountCents
    FROM expenses
    ORDER BY incurred_on
  `).all() as StartupExpense[];

  // Before there is a start date, the advice is about keeping the records at
  // all — which is the part that cannot be fixed retrospectively.
  if (startedOn === null) {
    return [
      {
        id: 'startup-not-started',
        severity: 'opportunity',
        title: 'Money you spend before opening is deductible — if you record it now',
        because: 'You have not set a date for when the business starts trading, so nothing is being tracked as a start-up cost.',
        body: [
          'Section 195 lets you deduct up to $5,000 of pre-opening costs in the year the business begins, ' +
            'with the rest spread over 180 months. Show admissions and travel to scout the market, an hour ' +
            'with a CPA, the city licence, a price-guide subscription — all of it counts.',
          'None of it is recoverable if it was never written down. This is the single most commonly lost ' +
            'deduction for a new business, and the window is open right now.',
          'Cards you buy before opening are NOT start-up costs. They are inventory: the cost comes back ' +
            'through cost of goods sold when they sell, however much you spend.',
          'The business "begins" when it first offers cards for sale — the first live listing or the first ' +
            'show table. Not when you decided to do it, and not when you bought your first box.',
        ],
        steps: [
          'Record pre-opening spending as it happens, under the Startup costs account.',
          'Set your start date in Settings once you list or sell your first card.',
        ],
      },
    ];
  }

  const year = Number(today.slice(0, 4));
  const result = startupCosts(rows, startedOn, year);
  if (!result) return [];

  if (result.qualifyingCents === 0) {
    // Only worth raising in the year trading began; after that the moment has passed.
    if (Number(startedOn.slice(0, 4)) !== year) return [];
    return [
      {
        id: 'startup-none-recorded',
        severity: 'caution',
        title: 'No start-up costs are recorded, which is unusual',
        because: `Your business began trading on ${startedOn} and nothing is recorded before that date.`,
        body: [
          'Almost nobody starts a card business without spending something first — a show ticket, mileage to ' +
            'scout, a licence, an hour of advice, a subscription.',
          'Up to $5,000 of it is deductible in this year, and it is lost entirely if it was never recorded.',
        ],
        steps: ['Look back through your card statements for anything before ' + startedOn + '.'],
      },
    ];
  }

  return [
    {
      id: 'startup-costs',
      severity: 'opportunity',
      title: `${fmt(result.firstYearDeductionCents)} of start-up costs is deductible this year`,
      because: `${fmt(result.qualifyingCents)} was spent before you began trading on ${startedOn}.`,
      worthCents: result.firstYearDeductionCents,
      body: [...result.explanation, ...result.warnings],
      steps: [
        'The election is automatic — nothing is attached to the return.',
        'Keep the receipts: pre-opening costs are the ones a preparer will ask about.',
      ],
    },
  ];
}

/**
 * What treating one card as inventory rather than a collection piece costs.
 *
 * Both paths are priced against the same other income, so the answer is the
 * genuine difference rather than a headline rate:
 *
 *   AS A CAPITAL ASSET   No self-employment tax. A collectible held more than
 *                        a year is taxed at the ordinary rate but capped at
 *                        28%; held a year or less it is simply ordinary.
 *   AS INVENTORY         Ordinary income, plus self-employment tax — but the
 *                        deduction for half of that tax and the section 199A
 *                        deduction both push back, so the net cost is
 *                        meaningfully less than the self-employment tax alone.
 */
function classificationCost(
  gainCents: Cents,
  acquiredOn: IsoDate,
  today: IsoDate,
  profile: { filingStatus: FilingStatus; otherIncomeCents: Cents },
  figures: TaxYearFigures | null,
): { differenceCents: Cents; explanation: string } {
  const seOnly = Math.round(gainCents * 0.153 * 0.9235);

  // Without rate schedules there is no honest way to compare the two, so fall
  // back to the self-employment tax and say that is what is being quoted.
  if (!figures || !figures.brackets) {
    return {
      differenceCents: seOnly,
      explanation:
        `Sold as business inventory it is ordinary income on Schedule C and picks up about ${fmt(seOnly)} of ` +
        'self-employment tax on top of income tax. No rate schedules are loaded for this year, so that is the ' +
        'self-employment tax alone rather than the full difference.',
    };
  }

  const base = { otherIncomeCents: profile.otherIncomeCents, filingStatus: profile.filingStatus };
  const baseline = incomeTax({ businessProfitCents: 0, ...base }, figures).totalTaxCents;

  const longTerm = isLongTerm(acquiredOn, today);
  const asCapital = incomeTax({
    businessProfitCents: 0,
    ...base,
    ...(longTerm ? { collectiblesGainCents: gainCents } : { shortTermGainCents: gainCents }),
  }, figures).totalTaxCents - baseline;

  const se = selfEmploymentTax({
    netProfitCents: gainCents,
    wagesCents: profile.otherIncomeCents,
    filingStatus: profile.filingStatus,
  }, figures);
  const asInventory =
    incomeTax({
      businessProfitCents: gainCents,
      ...base,
      selfEmploymentDeductionCents: se.deductionCents,
    }, figures).totalTaxCents - baseline + se.totalCents;

  return {
    differenceCents: Math.max(0, asInventory - asCapital),
    explanation:
      `Priced both ways against your other income: about ${fmt(asCapital)} as a capital asset, about ` +
      `${fmt(asInventory)} as inventory — ${fmt(se.totalCents)} of that being self-employment tax, partly ` +
      'offset by the deduction for half of it and the section 199A deduction.',
  };
}

function fmt(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
