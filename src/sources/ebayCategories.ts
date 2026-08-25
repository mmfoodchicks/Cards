/**
 * eBay category IDs relevant to trading cards.
 *
 * Two things make this table load-bearing rather than cosmetic:
 *
 *  1. Some categories sell things that are NOT the product — break slots,
 *     repacks, supplies, player-built decks. A $12 "break spot" sitting next to
 *     a $400 sealed box would wreck every price baseline, so those categories
 *     are excluded by default.
 *  2. Pokemon booster boxes get listed under BOTH "CCG Sealed Packs" and
 *     "CCG Sealed Boxes" depending on the seller, so sealed sweeps have to
 *     query both and de-duplicate.
 */

import type { Category, ProductType } from '../types.js';

export interface EbayCategory {
  id: string;
  name: string;
  /** Excluded from default sweeps because its listings are not the product. */
  excludeFromPricing?: boolean;
}

export const EBAY_CATEGORIES = {
  sportsSingles: { id: '261328', name: 'Sports Trading Card Singles' },
  sportsSealedPacks: { id: '261331', name: 'Sealed Sports Trading Card Packs' },
  sportsSealedBoxes: { id: '261332', name: 'Sealed Sports Trading Card Boxes' },
  sportsSealedCases: { id: '261333', name: 'Sealed Sports Trading Card Cases' },
  sportsSets: { id: '261330', name: 'Sports Trading Card Sets' },
  sportsBreaks: { id: '261334', name: 'Sports Trading Card Box & Case Breaks', excludeFromPricing: true },

  ccgSingles: { id: '183454', name: 'CCG Individual Cards' },
  ccgSealedPacks: { id: '183456', name: 'CCG Sealed Packs' },
  ccgSealedBoxes: { id: '261044', name: 'CCG Sealed Boxes' },
  ccgSealedCases: { id: '261045', name: 'CCG Sealed Cases' },
  ccgSealedDecks: { id: '183457', name: 'CCG Sealed Decks & Kits' },
  ccgMixedLots: { id: '183455', name: 'CCG Mixed Card Lots', excludeFromPricing: true },
  ccgBreaks: { id: '261337', name: 'CCG Box & Case Breaks', excludeFromPricing: true },
  ccgRepacks: { id: '463773', name: 'CCG Repacks', excludeFromPricing: true },
  ccgSupplies: { id: '183460', name: 'CCG Supplies & Accessories', excludeFromPricing: true },
  ccgPlayerDecks: { id: '183458', name: 'CCG Player-Built Decks', excludeFromPricing: true },
} as const satisfies Record<string, EbayCategory>;

/** Condition IDs eBay requires on card singles listings. */
export const CONDITION_IDS = {
  graded: '2750',
  ungraded: '4000',
  newSealed: '1000',
} as const;

const SPORTS_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  'baseball', 'football', 'basketball', 'hockey', 'soccer',
]);

const SEALED_TYPES: ReadonlySet<ProductType> = new Set<ProductType>([
  'booster-pack', 'booster-bundle', 'booster-box', 'elite-trainer-box',
  'ultra-premium-collection', 'blaster-box', 'hobby-box', 'hanger-box',
  'mega-box', 'value-pack', 'retail-box', 'tin', 'collection-box', 'case',
]);

/**
 * Which eBay categories to sweep for a given hobby and product shape.
 *
 * Each category costs one API call against the daily quota, so this returns the
 * smallest useful set rather than everything plausible.
 */
export function categoriesFor(opts: {
  category?: Category | null;
  productType?: ProductType | null;
  sealedOnly?: boolean;
}): EbayCategory[] {
  const isSports = opts.category ? SPORTS_CATEGORIES.has(opts.category) : null;
  const wantsSealed = opts.sealedOnly === true || (opts.productType != null && SEALED_TYPES.has(opts.productType));
  const wantsSingles = opts.productType === 'single';

  const sports: EbayCategory[] = [];
  const ccg: EbayCategory[] = [];

  if (wantsSingles) {
    sports.push(EBAY_CATEGORIES.sportsSingles);
    ccg.push(EBAY_CATEGORIES.ccgSingles);
  } else if (wantsSealed) {
    sports.push(EBAY_CATEGORIES.sportsSealedBoxes, EBAY_CATEGORIES.sportsSealedPacks);
    // Sellers split booster boxes across both CCG sealed categories.
    ccg.push(EBAY_CATEGORIES.ccgSealedBoxes, EBAY_CATEGORIES.ccgSealedPacks);
  } else {
    sports.push(EBAY_CATEGORIES.sportsSingles, EBAY_CATEGORIES.sportsSealedBoxes);
    ccg.push(EBAY_CATEGORIES.ccgSingles, EBAY_CATEGORIES.ccgSealedBoxes);
  }

  if (isSports === true) return sports;
  if (isSports === false) return ccg;
  return [...sports, ...ccg];
}

/** Categories whose listings must never feed a price baseline. */
export function isExcludedFromPricing(categoryId: string): boolean {
  return Object.values(EBAY_CATEGORIES).some(
    (c) => c.id === categoryId && (c as EbayCategory).excludeFromPricing === true,
  );
}
