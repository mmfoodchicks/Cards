/**
 * Tax figures, and the rules about them.
 *
 * Every rate, threshold, fee and deadline this application uses lives in a
 * `TaxFigure` carrying the tax year it applies to, the authority behind it, a
 * source URL, and a confidence rating. The UI shows all of that next to any
 * number it computes.
 *
 * The reason is simple: this is not tax advice, and the person using it needs to
 * be able to check any figure against the source before he files. Software that
 * asserts "your self-employment tax is $4,182" with no way to see where 15.3%
 * came from is asking to be trusted more than it deserves.
 *
 * Two kinds of figure behave very differently and must not be confused:
 *
 *   STATUTORY   Written into the code and unchanged for years — the 15.3% SE
 *               tax rate, the 92.35% net earnings multiplier, the $200,000
 *               additional Medicare threshold (deliberately not indexed). Safe
 *               to hard-code.
 *   INDEXED     Adjusted every year by the IRS or the legislature — the Social
 *               Security wage base, the standard mileage rate, the 471(c)
 *               gross receipts test, standard deductions, brackets. These MUST
 *               be re-checked each year, and a stale one silently produces a
 *               wrong return.
 */

import type { FilingStatus } from '../domain/types.js';

export type FigureConfidence =
  /** Checked against the primary source named in `source`. */
  | 'verified'
  /** From a credible secondary source; primary source not reachable. */
  | 'reported'
  /** Could not be confirmed. The app must not compute silently from these. */
  | 'unverified';

export type FigureKind = 'statutory' | 'indexed';

export interface TaxFigure<T = number> {
  /** Short stable key, e.g. `se.socialSecurityWageBase`. */
  key: string;
  label: string;
  value: T;
  /** Tax year the figure applies to. */
  year: number;
  kind: FigureKind;
  /** The legal authority: a code section, regulation, or revenue procedure. */
  authority: string;
  /** Where to go and check it. */
  source: string;
  confidence: FigureConfidence;
  /** Anything the user should know before relying on it. */
  note?: string;
}

export function figure<T>(spec: TaxFigure<T>): TaxFigure<T> {
  return spec;
}

/**
 * Read a figure's value, refusing to compute from something unverified.
 *
 * An unverified figure is worse than a missing one: it produces a confident
 * wrong answer. Callers that can degrade gracefully should check
 * `isUsable` first and show the gap to the user instead.
 */
export function valueOf<T>(f: TaxFigure<T>): T {
  if (f.confidence === 'unverified') {
    throw new UnverifiedFigureError(f as TaxFigure<unknown>);
  }
  return f.value;
}

export function isUsable<T>(f: TaxFigure<T> | undefined): f is TaxFigure<T> {
  return f !== undefined && f.confidence !== 'unverified';
}

export class UnverifiedFigureError extends Error {
  constructor(readonly figureRef: TaxFigure<unknown>) {
    super(
      `The figure "${figureRef.label}" for ${figureRef.year} has not been verified against ${figureRef.authority}. ` +
        `Check ${figureRef.source} and update it before relying on this calculation.`,
    );
    this.name = 'UnverifiedFigureError';
  }
}

/** Every figure the app knows about, for a single tax year. */
export interface TaxYearFigures {
  year: number;
  /** True once every indexed figure for the year has been checked. */
  reviewed: boolean;
  reviewedOn: string | null;
  figures: Record<string, TaxFigure<number>>;
  /** Non-numeric facts: rate tables, brackets, deadline dates. */
  brackets: BracketTables | null;
  deadlines: TaxDeadline[];
}

export interface TaxBracket {
  /** Lower bound of the bracket in cents, inclusive. */
  fromCents: number;
  /** Upper bound in cents, exclusive. null means no upper bound. */
  toCents: number | null;
  rate: number;
}

/**
 * Rate schedules, one per filing status.
 *
 * A single flat list would be a trap: every status has its own breakpoints, and
 * married-filing-separately in particular is NOT the same as single — it tracks
 * half of the joint schedule, so its top bracket starts far earlier.
 */
export interface BracketTables {
  authority: string;
  source: string;
  confidence: FigureConfidence;
  byStatus: Record<FilingStatus, TaxBracket[]>;
}

export interface TaxDeadline {
  key: string;
  jurisdiction: 'federal' | 'state' | 'county' | 'city';
  title: string;
  detail: string;
  formNumber: string | null;
  /** ISO date. Already adjusted for weekends and holidays where known. */
  dueOn: string;
  appliesWhen: string | null;
  source: string;
  confidence: FigureConfidence;
}

/** Figures whose confidence is below `verified`, for the UI to surface. */
export function unverifiedFigures(year: TaxYearFigures): TaxFigure<number>[] {
  return Object.values(year.figures).filter((f) => f.confidence !== 'verified');
}

/**
 * Indexed figures that were last checked for an earlier year.
 *
 * The dangerous failure mode for tax software is not being wrong loudly, it is
 * carrying last year's number forward quietly.
 */
export function staleFigures(year: TaxYearFigures): TaxFigure<number>[] {
  return Object.values(year.figures).filter((f) => f.kind === 'indexed' && f.year !== year.year);
}
