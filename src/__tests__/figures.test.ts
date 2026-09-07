import { describe, expect, it } from 'vitest';
import { staleFigures, unverifiedFigures } from '../tax/figures.js';
import { availableYears, taxYear } from '../tax/registry.js';

/**
 * The dangerous failure mode for tax software is not being wrong loudly, it is
 * carrying last year's number forward quietly. These guard the claim the app
 * makes about its own figures, so the `reviewed` flag cannot drift into being
 * decorative.
 */
describe('figure integrity', () => {
  for (const year of availableYears()) {
    const figures = taxYear(year)!;

    it(`${year}: every figure names an authority and a source`, () => {
      for (const f of Object.values(figures.figures)) {
        expect(f.authority, `${f.key} has no authority`).toBeTruthy();
        expect(f.source, `${f.key} has no source`).toMatch(/^https?:\/\//);
      }
    });

    it(`${year}: no figure is carried over from another tax year`, () => {
      expect(staleFigures(figures).map((f) => f.key)).toEqual([]);
      for (const f of Object.values(figures.figures)) {
        expect(f.year, `${f.key} is stamped ${f.year}`).toBe(year);
      }
    });

    it(`${year}: the reviewed flag matches reality`, () => {
      const unverified = unverifiedFigures(figures).map((f) => f.key);
      if (figures.reviewed) {
        // Claiming the year is reviewed means claiming every figure was checked
        // against a primary source. Adding one that was not must break this.
        expect(unverified, 'reviewed is true but these are unverified').toEqual([]);
        expect(figures.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(figures.brackets?.confidence).toBe('verified');
      } else {
        expect(figures.reviewedOn).toBeNull();
      }
    });

    it(`${year}: rate schedules cover every filing status without gaps`, () => {
      const tables = figures.brackets;
      if (!tables) return;
      const statuses = [
        'single', 'married-joint', 'married-separate',
        'head-of-household', 'qualifying-surviving-spouse',
      ] as const;
      for (const status of statuses) {
        const brackets = tables.byStatus[status];
        expect(brackets, `${status} has no schedule`).toBeDefined();
        expect(brackets.length).toBeGreaterThan(0);
        expect(brackets[0]!.fromCents).toBe(0);
        expect(brackets.at(-1)!.toCents).toBeNull();
        // Rates must climb; a schedule that dips would mean a transcription slip.
        for (let i = 1; i < brackets.length; i += 1) {
          expect(brackets[i]!.rate).toBeGreaterThan(brackets[i - 1]!.rate);
          expect(brackets[i]!.fromCents).toBe(brackets[i - 1]!.toCents);
        }
      }
    });

    it(`${year}: money figures are whole cents, never dollars by mistake`, () => {
      // A figure meant as cents but entered as dollars is off by 100x and would
      // sail through every other check. Anything above 1 is money here.
      for (const f of Object.values(figures.figures)) {
        if (f.value > 1) {
          expect(Number.isInteger(f.value), `${f.key} = ${f.value} is not a whole number of cents`).toBe(true);
        }
      }
    });
  }
});
