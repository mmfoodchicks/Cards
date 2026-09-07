/**
 * Tax year registry.
 *
 * Figures are looked up by year and never silently substituted. Asking for a
 * year the app does not have returns nothing rather than quietly handing back
 * last year's numbers, because a stale indexed figure is the most likely way
 * this application produces a wrong return.
 */

import { FIGURES_2026 } from './years/2026.js';
import type { TaxFigure, TaxYearFigures } from './figures.js';
import { staleFigures, unverifiedFigures } from './figures.js';

const YEARS: Record<number, TaxYearFigures> = {
  2026: FIGURES_2026,
};

export function taxYear(year: number): TaxYearFigures | null {
  return YEARS[year] ?? null;
}

export function availableYears(): number[] {
  return Object.keys(YEARS).map(Number).sort();
}

export class MissingTaxYearError extends Error {
  constructor(readonly year: number) {
    super(
      `No tax figures are on file for ${year}. Rates, thresholds and mileage change every year, ` +
        `so the app will not compute ${year} figures from another year's numbers. ` +
        `Add a figures file for ${year} and check each indexed value against its source.`,
    );
    this.name = 'MissingTaxYearError';
  }
}

export function requireTaxYear(year: number): TaxYearFigures {
  const found = taxYear(year);
  if (!found) throw new MissingTaxYearError(year);
  return found;
}

export interface FigureHealth {
  year: number;
  reviewed: boolean;
  reviewedOn: string | null;
  unverified: TaxFigure<number>[];
  stale: TaxFigure<number>[];
  /** Figures the user should check before filing. */
  needsAttention: TaxFigure<number>[];
}

/**
 * What is not trustworthy about this year's figures.
 *
 * Surfaced prominently rather than buried: the honest state of a tax
 * application is "here is what I am sure of and here is what you need to check".
 */
export function figureHealth(year: number): FigureHealth | null {
  const figures = taxYear(year);
  if (!figures) return null;
  const unverified = unverifiedFigures(figures);
  const stale = staleFigures(figures);
  const seen = new Set<string>();
  const needsAttention = [...unverified, ...stale].filter((f) => {
    if (seen.has(f.key)) return false;
    seen.add(f.key);
    return true;
  });
  return {
    year: figures.year,
    reviewed: figures.reviewed,
    reviewedOn: figures.reviewedOn,
    unverified,
    stale,
    needsAttention,
  };
}

/** A figure's value, or null when it is not safe to use. */
export function figureValue(year: number, key: string): number | null {
  const figures = taxYear(year);
  const found = figures?.figures[key];
  if (!found || found.confidence === 'unverified') return null;
  return found.value;
}

export function figureRef(year: number, key: string): TaxFigure<number> | null {
  return taxYear(year)?.figures[key] ?? null;
}
