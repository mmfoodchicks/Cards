/**
 * The source adapter contract.
 *
 * Every marketplace the app can watch implements this. Adapters return RAW
 * listings only — they do no parsing, no pricing and no scoring, so a new
 * marketplace can be added without touching the deal engine.
 */

import type { Category, ProductType, RawListing } from '../types.js';

export interface SourceQuery {
  /** Free-text keywords, as the user typed them. */
  q: string;
  category?: Category | null;
  productType?: ProductType | null;
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  /** Restrict to graded slabs, raw cards, or both. */
  condition?: 'graded' | 'raw' | 'any';
  sealedOnly?: boolean;
  /** Include auctions as well as fixed-price listings. */
  includeAuctions?: boolean;
  /** Max listings to return across all pages. */
  limit?: number;
  /** Only listings created after this instant, for incremental polling. */
  since?: Date | null;
}

export interface SourceResult {
  listings: RawListing[];
  /** API calls consumed, for quota accounting. */
  callsUsed: number;
  /** Non-fatal problems worth showing the user. */
  warnings: string[];
}

export interface SourceCapabilities {
  /** Can return completed sales, not just live listings. */
  soldComps: boolean;
  auctions: boolean;
  /** Can restrict results to graded slabs. */
  gradedFilter: boolean;
  /** Requires credentials the user must obtain themselves. */
  needsCredentials: boolean;
}

export interface SourceAdapter {
  /** Stable identifier stored on every listing row. */
  id: string;
  displayName: string;
  capabilities: SourceCapabilities;
  /** False when credentials are missing; the UI explains what to set up. */
  isConfigured(): boolean;
  /** Human-readable reason the adapter is unavailable, when it is. */
  unavailableReason(): string | null;
  search(query: SourceQuery): Promise<SourceResult>;
}
