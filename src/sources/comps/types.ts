/**
 * Comp providers answer "what is this card actually worth?".
 *
 * They are separate from marketplace adapters, which answer "what is for sale
 * right now?". Singles have no MSRP, so without at least one of these the app
 * can only price sealed product — which is why one free provider is wired up
 * out of the box.
 */

import type { ParsedListing } from '../../types.js';

export interface CompQuote {
  valueCents: number;
  /** What the number represents, shown to the user so they can judge it. */
  basis: string;
  /** Number of sales behind the figure, when the provider reports one. */
  sampleSize: number | null;
  provider: string;
  detail?: Record<string, unknown>;
}

export interface CompProvider {
  id: string;
  displayName: string;
  isConfigured(): boolean;
  unavailableReason(): string | null;
  /** Which hobbies and item shapes this provider can price. */
  supports(parsed: ParsedListing): boolean;
  quote(parsed: ParsedListing): Promise<CompQuote | null>;
}
