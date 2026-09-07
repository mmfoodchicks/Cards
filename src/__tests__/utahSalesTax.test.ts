import { describe, expect, it } from 'vitest';
import { DAVIS_COUNTY_RATES, rateFor, salesTaxFor } from '../tax/utah/salesTax.js';

describe('Davis County rates', () => {
  it('knows every city in the county', () => {
    expect(DAVIS_COUNTY_RATES.length).toBeGreaterThanOrEqual(16);
    expect(rateFor('Layton')?.rate).toBe(0.0725);
    expect(rateFor('Sunset')?.rate).toBe(0.0715);
  });

  it('has only two distinct rates, differing by the municipal zoo tax', () => {
    const rates = new Set(DAVIS_COUNTY_RATES.map((r) => r.rate));
    expect([...rates].sort()).toEqual([0.0715, 0.0725]);
  });

  it('matches case-insensitively, since people type city names loosely', () => {
    expect(rateFor('layton')?.jurisdiction).toBe('Layton');
    expect(rateFor('  KAYSVILLE ')?.rate).toBe(0.0725);
  });

  it('returns nothing for a city it does not know, rather than a nearby rate', () => {
    expect(rateFor('Provo')).toBeNull();
  });
});

describe('what to charge', () => {
  const base = { saleCents: 10000, homeJurisdiction: 'Layton' };

  it('leaves marketplace sales alone', () => {
    const advice = salesTaxFor({ ...base, context: 'marketplace' });
    expect(advice.youCollect).toBe(false);
    expect(advice.explanation).toMatch(/collects and remits this for you/i);
  });

  it('charges the home rate on a local sale', () => {
    const advice = salesTaxFor({ ...base, context: 'own-location' });
    expect(advice.rate).toBe(0.0725);
    expect(advice.taxCents).toBe(725);
  });

  it('charges the SHOW city rate at a show, not the home rate', () => {
    // This is the one that catches people: a Layton seller at a Sunset show
    // charges Sunset's rate, because a temporary event is sourced to the event.
    const advice = salesTaxFor({ ...base, context: 'temporary-event', eventJurisdiction: 'Sunset' });
    expect(advice.rate).toBe(0.0715);
    expect(advice.taxCents).toBe(715);
    expect(advice.explanation).toMatch(/not your home rate/i);
  });

  it('says to look it up rather than guessing at an unknown venue', () => {
    const advice = salesTaxFor({ ...base, context: 'temporary-event', eventJurisdiction: 'St George' });
    expect(advice.youCollect).toBe(true);
    expect(advice.rate).toBeNull();
    expect(advice.taxCents).toBeNull();
    expect(advice.explanation).toMatch(/look it up/i);
  });

  it('uses the buyer location for a direct shipment inside Utah', () => {
    const advice = salesTaxFor({ ...base, context: 'shipped-to-utah-buyer', buyerJurisdiction: 'Bountiful' });
    expect(advice.rate).toBe(0.0725);
    expect(advice.sourcingRule).toMatch(/where the buyer receives/i);
  });

  it('charges no Utah tax on an out-of-state shipment', () => {
    const advice = salesTaxFor({ ...base, context: 'out-of-state' });
    expect(advice.youCollect).toBe(false);
    expect(advice.taxCents).toBeNull();
  });
});
