/**
 * Card valuation — what a card is worth, as distinct from what it cost.
 *
 * THE ONE RULE THIS MODULE EXISTS TO ENFORCE: nothing here may ever reach cost
 * basis. A value is an estimate from a third party about a market; a basis is a
 * fact about money you spent. They are different kinds of thing and the tax
 * computation only ever uses the second. Everything produced here lands in
 * `estimatedValueCents`, which appears in zero of the tax computation files and
 * is guarded by tests in basis.test.ts.
 *
 * What a value IS legitimately good for:
 *   - splitting the cost of a box or a lot across its contents by relative fair
 *     market value (Treas. Reg. 1.61-6), where only the RATIOS matter
 *   - deciding what to sell, and when
 *   - insurance and the personal collection schedule
 *   - the guidance engine's dealer-versus-investor arithmetic
 *
 * What it is NOT good for: inventory on Schedule C, which is carried at cost.
 */

import type { Cents } from '../domain/money.js';
import type { IsoDate } from '../domain/types.js';

/**
 * What kind of number a quote actually is.
 *
 * Conflating these is the single worst failure a valuation tool can commit. A
 * raw Charizard and a PSA 10 Charizard are the same card and can differ by
 * fifty times in price. Every quote must say which one it is, and the app must
 * never silently apply one to the other.
 */
export type QuoteBasis =
  /** An asking/market price for the UNGRADED card. */
  | 'raw-market'
  /** A price specific to a stated grade from a stated grader. */
  | 'graded'
  /** An actual completed sale. The gold standard, and the hardest to get. */
  | 'sold-comp'
  /** Entered by the user from their own research. */
  | 'manual';

export interface ValuationQuote {
  sourceKey: string;
  sourceName: string;
  /** What the number means. Never omit this. */
  basis: QuoteBasis;
  valueCents: Cents;
  /** Which field the source called this, so it can be traced back. */
  fieldName: string;
  currency: 'USD';
  /** When the source computed it, when known. */
  asOf: IsoDate | null;
  /** What was matched, in the source's own words, so a wrong match is visible. */
  matchedName: string;
  /**
   * The printing this quote is for — Normal, Holofoil, Reverse Holofoil, 1st
   * Edition. Never null in practice for TCG, and never to be dropped: a reverse
   * holo and its base printing are different cards at different prices, and
   * collapsing them is a smaller version of confusing raw with graded.
   */
  variant: string | null;
  /** The source's identifier for the thing matched. */
  matchedId: string | null;
  /** Anything the user must know before trusting the number. */
  caveats: string[];
  /** Direct link to the source page, where one exists. */
  url: string | null;
}

/** A candidate match, before the user has confirmed it is the right card. */
export interface ValuationCandidate {
  matchedId: string;
  matchedName: string;
  /** Set, expansion or product group. */
  groupName: string | null;
  /** Card number within the set, when the source publishes one. */
  number: string | null;
  /** Printing or variant — Normal, Holofoil, Reverse Holofoil, 1st Edition. */
  variant: string | null;
  quotes: ValuationQuote[];
  url: string | null;
}

export interface ValuationSearch {
  /** Free text — a card name. */
  query: string;
  /** Source-specific category, e.g. a TCGCSV categoryId. */
  category?: string;
  /** Source-specific set/group. Narrowing by set is what makes matching reliable. */
  group?: string;
  limit?: number;
}

export interface ValuationResult {
  sourceKey: string;
  sourceName: string;
  candidates: ValuationCandidate[];
  /**
   * True when the search was answered but nothing matched. Distinct from an
   * error: "no comps for this card" is a real, useful answer.
   */
  searched: boolean;
  notes: string[];
}

/**
 * A source of card values.
 *
 * Deliberately narrow. A source resolves a set list and searches within one
 * set — it does NOT take a free-text card title and guess. The previous version
 * of this app tried exactly that and produced confident nonsense: "Pokemon 151
 * ETB" parsed as a quantity of 151, base cards matched against their own
 * parallels, and grading detection that stopped at the first alias it saw. The
 * user picking the set removes the entire class of failure.
 */
export interface ValuationSource {
  key: string;
  name: string;
  /** What this source can and cannot tell you, in plain words. */
  description: string;
  /** True when it needs a key the user has not supplied. */
  requiresKey: boolean;
  configured: boolean;
  /** What kinds of number it returns. */
  provides: readonly QuoteBasis[];
  /** Categories it covers, for the picker. */
  categories(): Promise<Array<{ id: string; name: string }>>;
  /** Sets within a category. */
  groups(categoryId: string): Promise<Array<{ id: string; name: string; releasedOn: IsoDate | null }>>;
  search(input: ValuationSearch): Promise<ValuationResult>;
}

export class ValuationError extends Error {
  constructor(message: string, readonly sourceKey: string) {
    super(message);
    this.name = 'ValuationError';
  }
}
