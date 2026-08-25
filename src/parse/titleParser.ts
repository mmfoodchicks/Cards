/**
 * Extracts structured product identity from a free-text listing title.
 *
 * Everything downstream depends on this: a listing we cannot identify cannot be
 * priced, and a listing we identify *wrongly* produces a fake bargain. The
 * parser therefore prefers to return `productKey: null` over guessing, and
 * reports a `parseConfidence` the scorer uses to suppress low-trust matches.
 */

import type { Category, Grader, ParsedListing, ProductType } from '../types.js';
import { normalizeTitle, slugify } from '../util/text.js';
import {
  CATEGORY_TERMS,
  CONDITION_ALIASES,
  GRADERS,
  LOT_TERMS,
  NOISE_WORDS,
  NUMBERED_PATTERNS,
  PER_UNIT_COUNT_PATTERNS,
  PRODUCT_TYPE_ALIASES,
  RED_FLAG_TERMS,
  REPACK_TERMS,
  ROOKIE_TERMS,
  SEALED_TERMS,
  SET_VOCAB,
  SINGLE_TERMS,
  VARIANT_GROUPS,
  VARIANT_TERMS,
  GRADE_QUALIFIERS,
  LANGUAGE_TERMS,
  SEALED_VARIANT_TERMS,
  type SetVocabEntry,
} from './vocab.js';

/** Nouns that can carry a lot quantity, mapped to the product family they name. */
const QUANTITY_NOUNS: Record<string, 'pack' | 'box' | 'tin' | 'bundle' | 'card'> = {
  pack: 'pack', packs: 'pack',
  box: 'box', boxes: 'box', etb: 'box', etbs: 'box',
  blaster: 'box', blasters: 'box', tin: 'tin', tins: 'tin',
  bundle: 'bundle', bundles: 'bundle',
  card: 'card', cards: 'card', slab: 'card', slabs: 'card',
};

/** Which family each ProductType belongs to, for quantity disambiguation. */
const TYPE_FAMILY: Partial<Record<ProductType, 'pack' | 'box' | 'tin' | 'bundle' | 'card'>> = {
  'booster-pack': 'pack',
  'value-pack': 'pack',
  'booster-box': 'box',
  'elite-trainer-box': 'box',
  'ultra-premium-collection': 'box',
  'blaster-box': 'box',
  'hobby-box': 'box',
  'hanger-box': 'box',
  'mega-box': 'box',
  'retail-box': 'box',
  'collection-box': 'box',
  'case': 'box',
  tin: 'tin',
  'booster-bundle': 'bundle',
  single: 'card',
};

/** Phrases meaning "not actually graded" that must cancel a grader match. */
const UNGRADED_TERMS = [
  'will grade', 'would grade', 'grade worthy', 'psa ready', 'psa worthy',
  'ready to grade', 'ungraded', ' raw ', 'not graded', 'no grade', 'pre grade',
  'pregrade', 'gem mint candidate',
];

/** Words meaning the items in a lot are not identical to one another. */
const MIXED_CONTENT_TERMS = [
  'assorted', 'mixed', 'variety', 'random assortment', 'different sets',
  'various sets', 'multiple sets', 'mixed lot', 'job lot', 'grab bag',
];

const YEAR_RE = /\b(19[3-9]\d|20[0-5]\d)\b/g;
// Card numbers come as "#123", "#BDC-25", "#HMT32" or the Pokemon style
// "199/165". The alphanumeric prefix matters: "#HMT32" and "#32" are different
// cards in the same set.
const CARD_NUMBER_RE = /(?:#\s*([a-z]{0,5}-?\d{1,4}[a-z]?)|\b(\d{1,3})\s*\/\s*(\d{1,3})\b)/;

function matchTerms(haystack: string, terms: readonly string[]): string[] {
  const hits: string[] = [];
  for (const term of terms) {
    if (haystack.includes(term)) hits.push(term.trim());
  }
  return hits;
}

function detectCategory(text: string): { category: Category; hits: number } {
  let best: { category: Category; hits: number } = { category: 'other', hits: 0 };
  for (const { category, strong, terms, subjects } of CATEGORY_TERMS) {
    // Naming the sport outright settles it. A player name is next-best:
    // "Ohtani" pins a listing to baseball more reliably than "chrome" does.
    const hits =
      matchTerms(text, strong).length * 4 +
      matchTerms(text, subjects).length * 2 +
      matchTerms(text, terms).length;
    if (hits > best.hits) best = { category, hits };
  }
  return best;
}

function detectSet(text: string, category: Category | null): SetVocabEntry | null {
  const candidates: Array<{ entry: SetVocabEntry; aliasLength: number }> = [];
  for (const entry of SET_VOCAB) {
    let longest = 0;
    for (const alias of entry.aliases) {
      if (text.includes(alias) && alias.length > longest) longest = alias.length;
    }
    if (longest > 0) candidates.push({ entry, aliasLength: longest });
  }
  if (candidates.length === 0) return null;

  // A set whose category agrees with the title's own category signals is far
  // more likely to be right: " prizm " appears in football, basketball and
  // soccer listings alike.
  const agreeing = category ? candidates.filter((c) => c.entry.category === category) : [];
  let pool = agreeing.length > 0 ? agreeing : candidates;

  // Drop any set that a more specific matching set descends from, so
  // "Mega Evolution: Perfect Order" beats the "Mega Evolution" era it sits in.
  const matchedSlugs = new Set(pool.map((c) => c.entry.slug));
  const parentSlugs = new Set(
    pool.map((c) => c.entry.parent).filter((p): p is string => typeof p === 'string' && matchedSlugs.has(p)),
  );
  if (parentSlugs.size > 0) {
    const specific = pool.filter((c) => !parentSlugs.has(c.entry.slug));
    if (specific.length > 0) pool = specific;
  }

  pool.sort((a, b) => b.aliasLength - a.aliasLength);
  return pool[0]!.entry;
}

function detectProductType(text: string): ProductType | null {
  for (const { type, aliases } of PRODUCT_TYPE_ALIASES) {
    for (const alias of aliases) {
      if (text.includes(alias)) return type;
    }
  }
  return null;
}

function detectGrading(text: string): { graded: boolean; grader: Grader | null; grade: number | null } {
  const ungraded = UNGRADED_TERMS.some((t) => text.includes(t));

  // Pass 1: look for a grader label immediately followed by a number, across
  // EVERY alias of EVERY grader. Stopping at the first alias that merely
  // appears would miss "Beckett Graded BGS 9.5", where the readable grade sits
  // next to a different alias than the one that matched first.
  let labelled: { grader: Grader; grade: number } | null = null;
  for (const { code, aliases } of GRADERS) {
    for (const alias of aliases) {
      if (!text.includes(alias)) continue;
      const escaped = alias.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Tolerate qualifier words between the label and the number:
      // "PSA GEM MT 10", "CGC 10 Pristine", "BGS 9.5".
      const re = new RegExp(
        `${escaped}\\s*(?:gem\\s*)?(?:mint\\s*|mt\\s*|pristine\\s*|black\\s*label\\s*)?(10(?:\\.0)?|[1-9](?:\\.5|\\.0)?)\\b`,
      );
      const m = re.exec(text);
      const value = m?.[1] ? Number.parseFloat(m[1]) : Number.NaN;
      if (Number.isFinite(value) && value >= 1 && value <= 10) {
        // Prefer the most specific reading: a later, higher-precision match
        // like "9.5" should not be replaced by a bare "9" found elsewhere.
        if (!labelled || value % 1 !== 0) labelled = { grader: code, grade: value };
      }
    }
  }
  if (labelled) return { graded: true, grader: labelled.grader, grade: labelled.grade };

  // Pass 2: a grader is named but no legible grade. Only trust it if nothing
  // in the title says the card is raw.
  if (!ungraded) {
    for (const { code, aliases } of GRADERS) {
      if (aliases.some((alias) => text.includes(alias))) {
        return { graded: true, grader: code, grade: null };
      }
    }
  }

  return { graded: false, grader: null, grade: null };
}

function detectQuantity(
  text: string,
  productType: ProductType | null,
  /** Numbers already explained by a set name or a year, e.g. the "151" in
   *  "Pokemon 151 ETB". Counting those as a quantity produces lots of 151. */
  explainedNumbers: readonly string[],
): { quantity: number; mixedLot: boolean } {
  const hasLotTerm = LOT_TERMS.some((t) => text.includes(t));
  let quantity = 1;
  let scan = text;
  for (const n of explainedNumbers) scan = scan.split(n).join(' ');
  // Remove counts that describe a unit's contents before looking for a lot
  // quantity: "36 packs per box" is one box, not thirty-six of anything.
  for (const re of PER_UNIT_COUNT_PATTERNS) scan = scan.replace(re, ' ');

  const explicit = /\b(?:lot of|set of|bundle of|pack of)\s+(\d{1,3})\b/.exec(scan);
  if (explicit?.[1]) quantity = Number.parseInt(explicit[1], 10);

  if (quantity === 1) {
    const times = /\b(\d{1,3})\s*x\b|\bx\s*(\d{1,3})\b/.exec(scan);
    const n = times?.[1] ?? times?.[2];
    if (n) quantity = Number.parseInt(n, 10);
  }

  if (quantity === 1) {
    // "3 booster boxes" is a lot of 3; "36 pack booster box" is one box that
    // happens to contain 36 packs. Only count the noun that names the product
    // type we actually detected.
    const family = productType ? TYPE_FAMILY[productType] : undefined;
    const re = /\b(\d{1,3})\s+([a-z]+)\b/g;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(scan)) !== null) {
      const n = Number.parseInt(m[1]!, 10);
      const noun = QUANTITY_NOUNS[m[2]!];
      if (!noun || !Number.isFinite(n)) continue;
      if (family && noun === family) {
        quantity = n;
        break;
      }
      if (!family && noun) {
        quantity = n;
        break;
      }
    }
  }

  // A genuine multi-unit listing is small. Big round numbers in a title are
  // almost always the pack count printed on the box ("36 packs") or a card
  // count ("100 card lot"), not a quantity of units being sold.
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 60) quantity = 1;

  // Two ways a lot defeats per-unit pricing: no recoverable count, or a stated
  // count of items that are not the same thing as each other. "Lot of 12
  // assorted packs" has a count, but dividing by 12 compares a mixed bag
  // against one specific product.
  const mixedContents = MIXED_CONTENT_TERMS.some((t) => text.includes(t));
  const mixedLot = mixedContents || (hasLotTerm && quantity === 1);
  return { quantity, mixedLot };
}

function detectCondition(text: string): string | null {
  for (const { canonical, aliases } of CONDITION_ALIASES) {
    for (const alias of aliases) {
      if (text.includes(alias)) return canonical;
    }
  }
  return null;
}

/** Categories whose card numbers are printed as "199/165"; there, a slashed
 *  pair is an ordinary card number, not a serial-numbered parallel. */
const SLASH_IS_CARD_NUMBER: ReadonlySet<Category> = new Set<Category>([
  'pokemon', 'magic', 'yugioh', 'onepiece',
]);

function detectVariants(text: string, category: Category): { variants: string[]; matchedAliases: string[] } {
  // Collect every alias that appears, then drop any alias fully contained in a
  // longer one so "Silver Prizm" does not also register plain "prizm".
  const matched: Array<{ group: string; alias: string }> = [];
  for (const group of VARIANT_GROUPS) {
    for (const alias of group.aliases) {
      if (text.includes(alias)) matched.push({ group: group.canonical, alias: alias.trim() });
    }
  }
  const surviving = matched.filter(
    (m) => !matched.some((other) => other.alias !== m.alias && other.alias.includes(m.alias)),
  );

  const found = new Set(surviving.map((m) => m.group));

  // Serial numbering: "/99" or "numbered to 99" always counts. A bare "25/99"
  // only counts for sports, where card numbers are written "#25" instead.
  if (/\bnumbered\s+to\s+\d{1,4}\b/.test(text) || /(?:^|\s)\/\s*\d{1,4}\b/.test(text)) {
    found.add('serial-numbered');
  } else if (!SLASH_IS_CARD_NUMBER.has(category) && /\b\d{1,4}\s*\/\s*\d{1,4}\b/.test(text)) {
    found.add('serial-numbered');
  }

  if (ROOKIE_TERMS.some((t) => text.includes(t))) found.add('rookie');
  return { variants: [...found].sort(), matchedAliases: matched.map((m) => m.alias) };
}

function detectYears(text: string): number[] {
  const years: number[] = [];
  YEAR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = YEAR_RE.exec(text)) !== null) {
    const y = Number.parseInt(m[1]!, 10);
    if (!years.includes(y)) years.push(y);
  }
  return years;
}

/**
 * Residual tokens after removing everything the vocabulary already explained.
 * For a single card these are usually the player or Pokemon name.
 *
 * Phrases are stripped longest-first: removing "illustration rare" before
 * "special illustration rare" would otherwise strand the word "special" and
 * pollute the subject.
 */
function detectSubject(text: string, consumed: readonly string[]): { subject: string | null; slug: string | null } {
  let residual = ` ${text} `;
  const ordered = [...new Set(consumed.filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const phrase of ordered) {
    residual = residual.split(phrase).join(' ');
  }
  const tokens = residual
    .split(/\s+/)
    .map((t) => t.replace(/^[#./-]+|[#./-]+$/g, ''))
    .filter(
      (t) =>
        t.length > 2 &&
        !NOISE_WORDS.has(t) &&
        // Bare numbers, decimals ("9.5" left over from a grade) and fractions
        // are never part of a player name.
        !/^\d+(?:\.\d+)?$/.test(t) &&
        !/^\d+\/\d+$/.test(t),
    );

  if (tokens.length === 0) return { subject: null, slug: null };
  const picked = tokens.slice(0, 3);
  return { subject: picked.join(' '), slug: slugify(picked.join('-')) };
}

export interface ParseOptions {
  /** Category from the source (e.g. an eBay category id), trusted over title text. */
  categoryHint?: Category;
  /** Condition string from the source, e.g. eBay's "Graded" or "Brand New". */
  conditionHint?: string;
}

export function parseTitle(rawTitle: string, opts: ParseOptions = {}): ParsedListing {
  const text = normalizeTitle(rawTitle);

  const redFlags = [...matchTerms(text, RED_FLAG_TERMS), ...matchTerms(text, REPACK_TERMS)];

  const detected = detectCategory(text);
  let category: Category = opts.categoryHint ?? detected.category;

  const setEntry = detectSet(text, detected.hits > 0 ? category : null);
  if (setEntry && detected.hits === 0 && !opts.categoryHint) category = setEntry.category;

  let productType = detectProductType(text);
  const grading = detectGrading(text);

  const sealedTerm = SEALED_TERMS.some((t) => text.includes(t));
  const singleTerm = SINGLE_TERMS.some((t) => text.includes(t));

  // Graded slabs are individual cards no matter what other words appear.
  if (grading.graded) productType = 'single';
  if (!productType) productType = singleTerm || !sealedTerm ? 'single' : 'unknown';

  const sealed = productType !== 'single' && productType !== 'unknown';
  const years = detectYears(text);
  const year = years[0] ?? setEntry?.year ?? null;

  // Numbers that a set name or a year already accounts for must not be read as
  // a lot quantity.
  const explainedNumbers = [
    ...years.map(String),
    ...(setEntry?.aliases ?? []).filter((a) => /\d/.test(a)).map((a) => a.trim()),
  ];
  const { quantity, mixedLot } = detectQuantity(text, productType, explainedNumbers);
  const { variants, matchedAliases: variantAliases } = detectVariants(text, category);
  const condition = detectCondition(text);

  // English is the default because the overwhelming majority of listings on a
  // US marketplace are English and say nothing about it.
  const language = LANGUAGE_TERMS.find((l) => l.aliases.some((a) => text.includes(a)))?.code ?? 'en';
  const sealedVariant = sealed
    ? (SEALED_VARIANT_TERMS.find((v) => v.aliases.some((a) => text.includes(a)))?.canonical ?? null)
    : null;

  const cardMatch = CARD_NUMBER_RE.exec(text);
  const cardNumber = cardMatch ? (cardMatch[1] ?? (cardMatch[2] && cardMatch[3] ? `${cardMatch[2]}/${cardMatch[3]}` : null)) : null;

  // Everything the vocabulary matched is removed before guessing the subject.
  const consumed = [
    ...(setEntry?.aliases ?? []),
    ...variantAliases,
    ...SEALED_TERMS.filter((t) => text.includes(t)),
    ...RED_FLAG_TERMS.filter((t) => text.includes(t)),
    ...REPACK_TERMS.filter((t) => text.includes(t)),
    ...LOT_TERMS.filter((t) => text.includes(t)),
    ...ROOKIE_TERMS.filter((t) => text.includes(t)),
    ...GRADE_QUALIFIERS.filter((t) => text.includes(t)),
    ...GRADERS.flatMap((g) => g.aliases).filter((a) => text.includes(a)),
    ...CONDITION_ALIASES.flatMap((c) => c.aliases).filter((a) => text.includes(a)),
    ...PRODUCT_TYPE_ALIASES.flatMap((p) => p.aliases).filter((a) => text.includes(a)),
    // Generic hobby words only. Player and character names live in `subjects`
    // and are deliberately left in place: they are what we are looking for.
    ...CATEGORY_TERMS.flatMap((c) => [...c.strong, ...c.terms]).filter((t) => text.includes(t)),
  ];
  const { subject, slug: subjectSlug } = sealed
    ? { subject: null, slug: null }
    : detectSubject(text, cardNumber ? [...consumed, cardNumber] : consumed);

  const productKey = buildProductKey({
    category,
    sealed,
    productType,
    year,
    setSlug: setEntry?.slug ?? null,
    subjectSlug,
    cardNumber,
    grader: grading.grader,
    grade: grading.grade,
    variants,
    language,
    sealedVariant,
    condition,
  });

  const parseConfidence = scoreParse({
    categoryKnown: category !== 'other',
    setKnown: setEntry !== null,
    productTypeKnown: productType !== 'unknown',
    yearKnown: year !== null,
    graded: grading.graded && grading.grade !== null,
    sealed,
    subjectKnown: subjectSlug !== null,
    mixedLot,
    redFlagCount: redFlags.length,
  });

  return {
    category,
    productType,
    sealed,
    year,
    setSlug: setEntry?.slug ?? null,
    setName: setEntry?.display ?? null,
    brand: setEntry?.brand ?? null,
    subject,
    cardNumber,
    graded: grading.graded,
    grader: grading.grader,
    grade: grading.grade,
    quantity,
    mixedLot,
    variants,
    condition: condition ?? opts.conditionHint ?? null,
    language,
    sealedVariant,
    redFlags,
    productKey,
    parseConfidence,
  };
}

export interface ProductKeyParts {
  category: Category;
  sealed: boolean;
  productType: ProductType;
  year: number | null;
  setSlug: string | null;
  subjectSlug: string | null;
  cardNumber: string | null;
  grader: Grader | null;
  grade: number | null;
  variants: string[];
  /** ISO-ish language code; a Japanese print is a different product. */
  language: string;
  /** Sealed configuration: jumbo, collector, choice... */
  sealedVariant: string | null;
  /** Raw-card condition, which tiers a single's value. */
  condition: string | null;
}

/**
 * Canonical join key.
 *
 * Two listings share a key only when comparing their prices is meaningful. That
 * is why the grade and the parallel fingerprint are part of a single's key: a
 * PSA 10 and a raw copy of the same card are different products, and pooling
 * them would invent bargains that do not exist.
 *
 * Returns null when the identity is too thin to compare safely.
 */
export function buildProductKey(parts: ProductKeyParts): string | null {
  const year = parts.year ? String(parts.year) : 'x';

  if (parts.sealed) {
    // Sealed product without a known set cannot be priced: a booster box of
    // *what*?
    if (!parts.setSlug || parts.productType === 'unknown') return null;
    return [
      'sealed',
      parts.category,
      year,
      parts.setSlug,
      parts.productType,
      // Configuration and language both move the price by multiples, so both
      // have to separate the pools.
      parts.sealedVariant ?? 'std',
      parts.language,
    ].join('|');
  }

  if (!parts.subjectSlug && !parts.cardNumber) return null;
  const gradeKey = parts.grader
    ? `${parts.grader.toLowerCase()}-${parts.grade !== null ? parts.grade.toFixed(1) : 'x'}`
    : 'raw';
  const variantKey = parts.variants.length > 0
    ? parts.variants.map((v) => slugify(v)).sort().join('+')
    : 'base';

  // For a raw card the stated condition is a value tier of its own: a played
  // vintage card at 40% of near-mint money is not a discount.
  const conditionKey = parts.grader ? 'slab' : conditionTier(parts.condition);

  return [
    'single',
    parts.category,
    year,
    parts.setSlug ?? 'x',
    parts.subjectSlug ?? 'x',
    parts.cardNumber ? parts.cardNumber.replace(/\s+/g, '') : 'x',
    gradeKey,
    variantKey,
    conditionKey,
    parts.language,
  ].join('|');
}

/** Collapse condition abbreviations into the tiers that actually price apart. */
function conditionTier(condition: string | null): string {
  switch (condition) {
    case 'NM':
    case null:
      return 'nm';
    case 'LP':
      return 'lp';
    case 'MP':
    case 'HP':
    case 'DMG':
      return 'played';
    default:
      return 'nm';
  }
}

function scoreParse(f: {
  categoryKnown: boolean;
  setKnown: boolean;
  productTypeKnown: boolean;
  yearKnown: boolean;
  graded: boolean;
  sealed: boolean;
  subjectKnown: boolean;
  mixedLot: boolean;
  redFlagCount: number;
}): number {
  let score = 0.15;
  if (f.categoryKnown) score += 0.2;
  if (f.setKnown) score += 0.25;
  if (f.productTypeKnown) score += 0.15;
  if (f.yearKnown) score += 0.1;
  if (f.graded) score += 0.1;
  if (!f.sealed && f.subjectKnown) score += 0.1;
  if (f.mixedLot) score -= 0.35;
  score -= Math.min(0.3, f.redFlagCount * 0.15);
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}
