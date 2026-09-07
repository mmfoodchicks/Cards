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
