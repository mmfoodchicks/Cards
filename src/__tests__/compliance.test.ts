import { describe, expect, it } from 'vitest';
import { complianceChecklist } from '../compliance/checklist.js';
import { DAVIS_COUNTY_CITIES, citiesNeedingConfirmation, licensingFor } from '../compliance/davisCounty.js';
import { deadlinesForYear, upcomingDeadlines } from '../compliance/calendar.js';
import type { BusinessProfile } from '../domain/types.js';

const profile = (overrides: Partial<BusinessProfile> = {}): BusinessProfile => ({
  id: 1, businessName: 'Test', ownerName: 'Owner', entityType: 'sole-proprietor', ein: null,
  state: 'UT', county: 'Davis', city: 'Layton', accountingMethod: 'cash', inventoryMethod: 'inventory',
  startedOn: '2026-06-01', filingStatus: 'single', otherIncomeCents: 0, otherWithholdingCents: 0,
  priorYearTaxCents: null, priorYearAgiCents: null, homeOfficeSqFt: null, homeTotalSqFt: null,
  updatedAt: new Date().toISOString(), ...overrides,
});

describe('Davis County city licensing', () => {
  it('covers every city in the county plus the unincorporated area', () => {
    expect(DAVIS_COUNTY_CITIES.length).toBeGreaterThanOrEqual(15);
    expect(licensingFor('Layton')).not.toBeNull();
    expect(licensingFor('Unincorporated Davis County')).not.toBeNull();
  });

  it('records that the answer differs by city, which is the whole point', () => {
    // Generic "check with your city" advice is useless precisely because these
    // are not the same.
    expect(licensingFor('Layton')!.requirement).toBe('required');
    expect(licensingFor('Kaysville')!.requirement).toBe('exempt-if-low-impact');
    expect(licensingFor('Farmington')!.requirement).toBe('exempt-if-low-impact');
  });

  it('flags cities whose fee could not be read, instead of inventing one', () => {
    const unknown = citiesNeedingConfirmation();
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown.every((c) => c.homeBusinessFee === null)).toBe(true);
  });

  it('matches city names loosely, since people type them casually', () => {
    expect(licensingFor('layton')!.city).toBe('Layton');
    expect(licensingFor('  west point ')!.city).toBe('West Point');
  });
});

describe('the checklist', () => {
  it('names the specific city requirement rather than saying "check locally"', () => {
    const tasks = complianceChecklist(profile({ city: 'Layton' }));
    const licence = tasks.find((t) => t.id === 'local-business-licence')!;
    expect(licence.title).toMatch(/Layton/);
    expect(licence.estimatedCost).toMatch(/Free for low impact/i);
  });

  it('says when a city does not require one', () => {
    const tasks = complianceChecklist(profile({ city: 'Kaysville' }));
    const licence = tasks.find((t) => t.id === 'local-business-licence')!;
    expect(licence.title).toMatch(/may not be required/i);
  });

  it('surfaces the city-specific traps', () => {
    const clinton = complianceChecklist(profile({ city: 'Clinton' }));
    const rules = clinton.find((t) => t.id === 'local-home-occupation')!;
    expect(rules.detail).toMatch(/fire safety inspection/i);
  });

  it('asks for the city when none is set, rather than guessing', () => {
    const tasks = complianceChecklist(profile({ city: '' }));
    const licence = tasks.find((t) => t.id === 'local-business-licence')!;
    expect(licence.detail).toMatch(/Set your city in Settings/i);
  });

  it('does not present Utah rules to a business in another state', () => {
    const tasks = complianceChecklist(profile({ state: 'NV', city: 'Reno' }));
    expect(tasks.some((t) => t.id === 'ut-sales-tax-licence')).toBe(false);
    expect(tasks.some((t) => t.id === 'state-unknown')).toBe(true);
  });

  it('always includes the federal basics', () => {
    const tasks = complianceChecklist(profile());
    expect(tasks.some((t) => t.id === 'fed-estimated-tax')).toBe(true);
    expect(tasks.some((t) => t.id === 'fed-recordkeeping')).toBe(true);
  });
});

describe('deadlines', () => {
  it('lists the four estimated payments plus the annual returns', () => {
    const deadlines = deadlinesForYear(2026);
    expect(deadlines.filter((d) => d.id.startsWith('est-'))).toHaveLength(4);
    expect(deadlines.some((d) => d.formNumber?.includes('Schedule C'))).toBe(true);
  });

  it('marks the September instalment imminent a week out', () => {
    const upcoming = upcomingDeadlines(2026, new Date('2026-09-07T00:00:00Z'));
    const q3 = upcoming.find((d) => d.id === 'est-2026-q3')!;
    expect(q3.urgency).toBe('imminent');
    expect(q3.daysAway).toBe(8);
  });

  it('keeps showing a deadline that just passed, rather than hiding it', () => {
    // Hiding it the moment it passes is how people find out in April.
    const justAfter = upcomingDeadlines(2026, new Date('2026-06-20T00:00:00Z'));
    expect(justAfter.some((d) => d.id === 'est-2026-q2' && d.urgency === 'overdue')).toBe(true);
  });

  it('lets a long-past deadline drop off the calendar', () => {
    // A deadline three months gone is noise on a calendar. Missed instalments
    // stay tracked in the estimated tax plan, which is where acting on them
    // actually belongs.
    const muchLater = upcomingDeadlines(2026, new Date('2026-09-07T00:00:00Z'));
    expect(muchLater.some((d) => d.id === 'est-2026-q1')).toBe(false);
    expect(muchLater.some((d) => d.id === 'est-2026-q3')).toBe(true);
  });
});

describe('the state fee bar for home businesses', () => {
  it('covers every Davis County city, including West Bountiful', () => {
    const cities = DAVIS_COUNTY_CITIES.map((c) => c.city);
    // West Bountiful is a separate city from Bountiful and was missing.
    expect(cities).toContain('West Bountiful');
    expect(cities).toContain('Bountiful');
    // Every jurisdiction in the sales tax table that is a city should have an
    // entry here, or a seller could be told nothing about where they live.
    expect(cities.length).toBeGreaterThanOrEqual(16);
  });

  it('flags a fee charged as the price of operating, but not one merely offered', () => {
    // 10-1-203(9)(a) expressly permits an administrative fee for a licence an
    // exempt owner REQUESTS, and (8)(a) allows a fee where offsite impact
    // materially exceeds ordinary residential use. Neither needs a caveat. A
    // flat fee to OPERATE a no-impact home business is the one that does.
    const permitted = /request|want one|optional|impact|customers come|patrons|employees|conditional use|penalty|free/i;

    for (const city of DAVIS_COUNTY_CITIES) {
      const fee = city.homeBusinessFee;
      if (!fee || !/\$\d/.test(fee) || permitted.test(fee)) continue;
      const text = [city.summary, ...city.watchOut].join(' ');
      expect(text, `${city.city} charges ${fee} to operate with no reference to 10-1-203`)
        .toMatch(/10-1-203/);
    }
  });

  it('names the statutory fee bar so a seller can cite it', () => {
    const clinton = DAVIS_COUNTY_CITIES.find((c) => c.city === 'Clinton')!;
    expect(clinton.homeBusinessFee).toBe('$47');
    expect(clinton.watchOut.join(' ')).toMatch(/10-1-203\(8\)\(a\)/);
    // Sunset's ordinance defers to state law by its own opening words.
    const sunset = DAVIS_COUNTY_CITIES.find((c) => c.city === 'Sunset')!;
    expect(sunset.summary).toMatch(/Unless exempted by state, federal or local law/);
  });

  it('does not assert a city permits a home card business when that was unverifiable', () => {
    const wb = DAVIS_COUNTY_CITIES.find((c) => c.city === 'West Bountiful')!;
    expect(wb.verified).toBe(false);
    expect(wb.watchOut.join(' ')).toMatch(/do not assume/i);
  });
});


describe('a date is not a duty', () => {
  const sep8 = new Date('2026-09-08T00:00:00Z');
  const thinking = { hasStarted: false, projectedTaxCents: 0, hasSales: false, owesSalesTax: false };
  const trading = { hasStarted: true, projectedTaxCents: 50000, hasSales: true, owesSalesTax: false };

  it('does not tell someone who has not started that an instalment is due', () => {
    // The worst possible first impression: you open the app having done
    // nothing, and it says a tax payment is due in seven days with penalty
    // language. That teaches people to ignore the calendar entirely.
    const q3 = upcomingDeadlines(2026, sep8, 45, thinking).find((d) => d.id === 'est-2026-q3')!;
    expect(q3.applies).toBe(false);
    expect(q3.urgency).toBe('later');
    expect(q3.notApplicable).toMatch(/have not started trading/i);
  });

  it('does tell someone who is trading and owes tax', () => {
    const q3 = upcomingDeadlines(2026, sep8, 45, trading).find((d) => d.id === 'est-2026-q3')!;
    expect(q3.applies).toBe(true);
    expect(q3.urgency).toBe('imminent');
    expect(q3.notApplicable).toBeNull();
  });

  it('stays quiet about an instalment when trading has begun but nothing is owed', () => {
    const q3 = upcomingDeadlines(2026, sep8, 45, { ...trading, projectedTaxCents: 0 })
      .find((d) => d.id === 'est-2026-q3')!;
    expect(q3.applies).toBe(false);
    expect(q3.notApplicable).toMatch(/no tax owed so far/i);
  });

  it('does not expect a 1099-K for someone with no sales', () => {
    // Checked in January, when that date is actually in the window.
    const jan = new Date('2027-01-10T00:00:00Z');
    const form = upcomingDeadlines(2026, jan, 45, thinking).find((d) => d.id === '1099k-2026')!;
    expect(form).toBeDefined();
    expect(form.applies).toBe(false);
    expect(form.notApplicable).toMatch(/no sales recorded/i);

    const withSales = upcomingDeadlines(2026, jan, 45, trading).find((d) => d.id === '1099k-2026')!;
    expect(withSales.applies).toBe(true);
  });

  it('still shows the annual return, which applies to everyone', () => {
    const ret = upcomingDeadlines(2026, new Date('2027-04-01T00:00:00Z'), 45, thinking)
      .find((d) => d.id === 'return-2026')!;
    expect(ret).toBeDefined();
    expect(ret.applies).toBe(true);
  });

  it('assumes everything applies when no situation is given', () => {
    // Callers that cannot describe the taxpayer get the cautious answer.
    const q3 = upcomingDeadlines(2026, sep8).find((d) => d.id === 'est-2026-q3')!;
    expect(q3.applies).toBe(true);
  });
});
