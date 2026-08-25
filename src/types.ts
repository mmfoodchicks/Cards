/**
 * Shared domain types.
 *
 * Money is stored as integer cents everywhere. Floating point dollars sneak
 * rounding drift into discount percentages, and a deal finder that is wrong by
 * a cent on a $2,000 slab looks broken.
 */

export type Category =
  | 'pokemon'
  | 'baseball'
  | 'football'
  | 'basketball'
  | 'hockey'
  | 'soccer'
  | 'magic'
  | 'yugioh'
  | 'onepiece'
  | 'other';

/** Sealed product forms. `single` means an individual card, not sealed product. */
export type ProductType =
  | 'single'
  | 'booster-pack'
  | 'booster-bundle'
  | 'booster-box'
  | 'elite-trainer-box'
  | 'ultra-premium-collection'
  | 'blaster-box'
  | 'hobby-box'
  | 'hanger-box'
  | 'mega-box'
  | 'value-pack'
  | 'retail-box'
  | 'tin'
  | 'collection-box'
  | 'case'
  | 'unknown';

export type ListingType = 'fixed' | 'auction' | 'auction-with-bin' | 'best-offer' | 'unknown';

/** How a listing's benchmark price was derived. Drives which labels apply. */
export type BenchmarkKind =
  /** A real manufacturer suggested retail price. Only sealed product has one. */
  | 'msrp'
  /** Real completed-sale data from a comp provider. The gold standard for singles. */
  | 'sold-comp'
  /**
   * A sale we inferred ourselves: a listing we were tracking vanished while its
   * end date was still in the future, which usually means somebody bought it.
   * Weaker than a reported sale, far stronger than an asking price, and the
   * only comp source available without a restricted API or scraping.
   */
  | 'sold-inferred'
  /** Derived from asking prices we have observed. Biased high; discount it. */
  | 'ask-derived'
  /** No usable benchmark. The listing is shown but cannot be scored. */
  | 'none';

export type DealLabel =
  | 'steal'
  | 'great-deal'
  | 'good-deal'
  | 'fair'
  | 'above-market'
  /** Discount so extreme the listing is more likely a scam or a mis-parse. */
  | 'suspicious'
  /** Parsed and shown, but we have no benchmark to judge it against. */
  | 'unscored';

/** Grading companies whose slabs materially change a card's value. */
export type Grader = 'PSA' | 'BGS' | 'SGC' | 'CGC' | 'HGA' | 'TAG' | 'ISA' | 'GMA' | 'AGS' | 'CSG';

/** Structured identity extracted from a free-text listing title. */
export interface ParsedListing {
  category: Category;
  productType: ProductType;
  /** True when the listing is factory sealed product rather than a loose card. */
  sealed: boolean;
  /** Release year, when the title states one. */
  year: number | null;
  /** Canonicalised set name, e.g. "prismatic-evolutions" or "topps-chrome". */
  setSlug: string | null;
  /** The set name as printed in the title, for display. */
  setName: string | null;
  brand: string | null;
  /** Player or Pokemon name when we can isolate one. */
  subject: string | null;
  cardNumber: string | null;
  graded: boolean;
  grader: Grader | null;
  grade: number | null;
  /** Number of comparable units in the listing. 5 for "lot of 5 ETBs". */
  quantity: number;
  /** True when the listing bundles non-identical items, which defeats per-unit math. */
  mixedLot: boolean;
  /** Parallel / insert / variation terms found in the title. */
  variants: string[];
  /** Raw-card condition abbreviation (NM, LP, ...) when stated. */
  condition: string | null;
  /** Reasons the listing may be worthless or fraudulent. */
  redFlags: string[];
  /** Canonical key used to join against MSRP entries and price observations. */
  productKey: string | null;
  /** 0..1 confidence that the parse is correct. */
  parseConfidence: number;
}

/** A listing as returned by a source adapter, before parsing or scoring. */
export interface RawListing {
  source: string;
  sourceItemId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  currency: string;
  priceCents: number;
  /** null when the source does not disclose shipping (treated as unknown, not free). */
  shippingCents: number | null;
  listingType: ListingType;
  bidCount: number | null;
  /** ISO timestamp when an auction closes. */
  endsAt: string | null;
  condition: string | null;
  sellerName: string | null;
  sellerFeedbackPct: number | null;
  sellerFeedbackCount: number | null;
  locationCountry: string | null;
  /** Adapter-specific payload retained for debugging and future re-scoring. */
  raw?: unknown;
}

/** A listing after parsing, cost normalisation and scoring. */
export interface ScoredListing extends RawListing {
  id: string;
  parsed: ParsedListing;
  /** price + shipping + estimated tax, in cents. */
  landedCents: number;
  /** landedCents divided by quantity: what one unit costs you. */
  unitCents: number;
  benchmarkKind: BenchmarkKind;
  benchmarkCents: number | null;
  /** Human-readable description of what we compared against. */
  benchmarkLabel: string | null;
  /** Where the benchmark figure came from, for the user to check. */
  benchmarkSource: string | null;
  /** Positive means below benchmark. 0.25 = 25% under. */
  discountPct: number | null;
  label: DealLabel;
  /**
   * The headline flag: this is sealed product benchmarked against a real
   * manufacturer suggested retail price, and it is listed below it. Tracked
   * separately from `label` so that a listing 30% under MSRP is badged both
   * "STEAL" and "UNDER MSRP" instead of having to pick one.
   */
  underMsrp: boolean;
  /** True when the source did not disclose shipping, so landed cost is a floor. */
  shippingUnknown: boolean;
  /** 0..1 blend of benchmark quality, sample size and dispersion. */
  confidence: number;
  /** Ranking value used to sort the feed; higher is a better opportunity. */
  score: number;
  /** Human-readable notes explaining the score, shown in the UI. */
  notes: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

/** A price point used to build market baselines. */
export interface PriceObservation {
  productKey: string;
  observedAt: string;
  unitCents: number;
  /** `ask` is a live asking price; `sold` is reported; `sold-inferred` is a
   *  listing that disappeared before its end date. */
  kind: 'ask' | 'sold' | 'sold-inferred';
  source: string;
  listingId: string | null;
}

/** A computed fair-market estimate for one product key. */
export interface Baseline {
  productKey: string;
  valueCents: number;
  kind: BenchmarkKind;
  /** Number of observations behind the estimate. */
  n: number;
  /** Robust relative dispersion (MAD / median). */
  dispersion: number;
  confidence: number;
  computedAt: string;
}

/** One row of the seeded, user-editable MSRP catalog. */
export interface MsrpEntry {
  productKey: string;
  category: Category;
  brand: string;
  year: number;
  setName: string;
  productType: ProductType;
  msrpCents: number;
  packsPerUnit: number | null;
  cardsPerPack: number | null;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  /** Alternate spellings sellers use, matched when canonicalising titles. */
  aliases: string[];
  userEdited?: boolean;
}

/** A saved search that the scheduler re-runs on an interval. */
export interface Watch {
  id: number;
  name: string;
  query: string;
  sources: string[];
  category: Category | null;
  productType: ProductType | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  /** Only surface listings at least this far under the benchmark. */
  minDiscountPct: number;
  sealedOnly: boolean;
  gradedOnly: boolean;
  excludeLots: boolean;
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface Alert {
  id: number;
  listingId: string;
  watchId: number | null;
  label: DealLabel;
  discountPct: number | null;
  createdAt: string;
  notifiedAt: string | null;
  dismissed: boolean;
}
