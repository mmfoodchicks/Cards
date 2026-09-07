/**
 * The deadline calendar.
 *
 * Deadlines are generated per year rather than stored, so the app always shows
 * real upcoming dates rather than a list that quietly went stale. Dates that
 * fall on a weekend shift forward; federal holidays can shift them further, so
 * anything close to the wire should be checked against the agency's own
 * calendar.
 */

import type { Deadline } from '../domain/types.js';
import { estimatedPeriods, daysUntil } from '../tax/estimatedTax.js';

export function deadlinesForYear(year: number): Deadline[] {
  const deadlines: Deadline[] = [];

  for (const period of estimatedPeriods(year)) {
    deadlines.push({
      id: `est-${year}-q${period.quarter}`,
      jurisdiction: 'federal',
      title: `Quarterly estimated tax — instalment ${period.quarter}`,
      detail:
        `Covers income earned ${period.periodStart} to ${period.periodEnd}. Missing an instalment triggers an ` +
        'underpayment penalty that accrues from this date and cannot be undone by paying more in April.',
      formNumber: '1040-ES',
      dueOn: period.dueOn,
      appliesWhen: 'You expect to owe $1,000 or more for the year.',
      url: 'https://www.irs.gov/forms-pubs/about-form-1040-es',
    });
  }

  deadlines.push({
    id: `return-${year}`,
    jurisdiction: 'federal',
    title: 'File Form 1040 with Schedule C and Schedule SE',
    detail:
      'The annual return reporting business profit and self-employment tax. An extension gives more time to ' +
      'FILE, never more time to PAY — tax owed is still due on the original date.',
    formNumber: '1040, Schedule C, Schedule SE',
    dueOn: `${year + 1}-04-15`,
    appliesWhen: null,
    url: 'https://www.irs.gov/forms-pubs/about-form-1040',
  });

  deadlines.push({
    id: `ut-return-${year}`,
    jurisdiction: 'state',
    title: 'File Utah individual income tax return',
    detail: 'Utah return reporting the same business profit, taxed at the state flat rate.',
    formNumber: 'TC-40',
    dueOn: `${year + 1}-04-15`,
    appliesWhen: 'You are a Utah resident.',
    url: 'https://incometax.utah.gov/',
  });

  deadlines.push({
    id: `1099k-${year}`,
    jurisdiction: 'federal',
    title: 'Expect Form 1099-K from marketplaces',
    detail:
      'Platforms report gross payments — including sales tax they collected, shipping the buyer paid, and ' +
      'before their fees and any refunds. That figure will be HIGHER than what you banked, and the return has ' +
      'to reconcile to it. Check each one against your own records when it arrives. If a form does NOT come, ' +
      'the income is taxable anyway — the threshold is the platform\'s filing duty, not your reporting duty.',
    formNumber: '1099-K',
    dueOn: `${year + 1}-01-31`,
    appliesWhen:
      'A platform settled MORE than $20,000 for you across MORE than 200 transactions — both tests. ' +
      'Card-reader sales have no threshold and are reported from the first cent.',
    url: 'https://www.irs.gov/businesses/understanding-your-form-1099-k',
  });

  return deadlines.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

export interface UpcomingDeadline extends Deadline {
  daysAway: number;
  urgency: 'overdue' | 'imminent' | 'soon' | 'later';
}

/**
 * Deadlines worth showing right now.
 *
 * Looks back a little as well as forward: a deadline that passed last week is
 * more urgent than one three months out, and hiding it the moment it passes is
 * how people find out in April.
 */
export function upcomingDeadlines(year: number, today: Date, lookBackDays = 45): UpcomingDeadline[] {
  const candidates = [...deadlinesForYear(year), ...deadlinesForYear(year - 1)];

  return candidates
    .map((deadline) => {
      const daysAway = daysUntil(deadline.dueOn, today);
      const urgency: UpcomingDeadline['urgency'] =
        daysAway < 0 ? 'overdue' : daysAway <= 14 ? 'imminent' : daysAway <= 45 ? 'soon' : 'later';
      return { ...deadline, daysAway, urgency };
    })
    .filter((d) => d.daysAway >= -lookBackDays && d.daysAway <= 120)
    .sort((a, b) => a.daysAway - b.daysAway);
}
