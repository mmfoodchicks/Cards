/**
 * The MSRP catalog and the rules for matching a listing to it.
 *
 * Why this is not a simple key lookup:
 *
 *  - One set ships several SKUs that share a coarse product type. "Bowman
 *    hobby box" is $239.99 and "Bowman HTA jumbo hobby box" is $499.99, and
 *    both parse as a hobby box. Picking the wrong one either invents a bargain
 *    or hides a real one, so ambiguous matches are resolved against the
 *    seller-facing aliases in the title, and abandoned when that fails.
 *  - Some MSRPs are era-wide rather than per-set. Every Pokemon booster pack in
 *    the current era is $4.49 regardless of which set it came from, so a
 *    fallback tier prices packs whose set we could not identify.
 *  - Not every number here is a true MSRP. Panini and Topps publish sell-sheet
 *    SRPs for hobby configurations and nothing at all for most retail SKUs, so
 *    entries carry a confidence the UI is expected to surface honestly.
 */

import { readFileSync } from 'node:fs';
import type { Category, ParsedListing, ProductType } from '../types.js';
import { fromRoot } from '../util/paths.js';
import { normalizeTitle } from '../util/text.js';

export interface CatalogEntry {
  id: string;
  category: Category;
  brand: string;
  year: number;
  setSlug: string;
  setName: string;
  productType: ProductType;
  /** Distinguishes SKUs sharing a product type: jumbo, collector, choice... */
  variant: string | null;
  msrpCents: number;
  packsPerUnit: number | null;
  cardsPerPack: number | null;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  aliases: string[];
  /** True when another entry shares this SKU shape and only aliases separate them. */
  ambiguous: boolean;
}

/** An era-wide price used when the exact set is unknown or unlisted. */
export interface CatalogDefault {
  category: Category;
  brand: string;
  productType: ProductType;
  variant: string | null;
  msrpCents: number;
  packsPerUnit: number | null;
  cardsPerPack: number | null;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  aliases: string[];
  yearFrom: number;
  yearTo: number;
  note: string;
}

export interface CatalogFile {
  version: number;
  entries: CatalogEntry[];
  defaults: CatalogDefault[];
}

let cached: CatalogFile | null = null;

export function loadCatalog(force = false): CatalogFile {
  if (cached && !force) return cached;
  const raw = JSON.parse(readFileSync(fromRoot('catalog', 'msrp.json'), 'utf8')) as CatalogFile;
  cached = {
    version: raw.version,
    entries: raw.entries.map((e) => ({ ...e, aliases: e.aliases.map((a) => a.toLowerCase()) })),
    defaults: raw.defaults.map((d) => ({ ...d, aliases: d.aliases.map((a) => a.toLowerCase()) })),
  };
  return cached;
}

export type MsrpMatchQuality = 'exact' | 'alias' | 'era-default';

export interface MsrpMatch {
  msrpCents: number;
  confidence: 'high' | 'medium' | 'low';
  quality: MsrpMatchQuality;
  entryId: string;
  label: string;
  source: string;
  /** Set when we deliberately declined to guess between competing SKUs. */
  ambiguityNote?: string;
}

export interface MsrpLookupResult {
  match: MsrpMatch | null;
  /** Explains a miss, for display and for debugging a watch that finds nothing. */
  reason: string;
}

/**
 * Find the MSRP for a parsed listing.
 *
 * `rawTitle` is needed in addition to the parse because SKU disambiguation
 * happens on phrases ("collector booster", "HTA jumbo") that the parser
 * deliberately does not model as product types.
 */
export function resolveMsrp(
  parsed: ParsedListing,
  rawTitle: string,
  catalog: CatalogFile = loadCatalog(),
): MsrpLookupResult {
  if (!parsed.sealed) {
    return { match: null, reason: 'Singles have no MSRP; a single card is a random output of a pack, not a priced SKU.' };
  }
  if (parsed.productType === 'unknown') {
    return { match: null, reason: 'Could not tell what kind of sealed product this is.' };
  }

  const text = normalizeTitle(rawTitle);

  // Tier 1: entries for this exact set + product type.
  if (parsed.setSlug) {
    const sameSku = catalog.entries.filter(
      (e) =>
        e.setSlug === parsed.setSlug &&
        e.productType === parsed.productType &&
        // Product lines like Prizm run across several sports under one set
        // slug, and a football box must never be priced off a basketball SKU.
        e.category === parsed.category,
    );
    const yearMatched = parsed.year ? sameSku.filter((e) => e.year === parsed.year) : [];
    const candidates = yearMatched.length > 0 ? yearMatched : sameSku;

    if (candidates.length === 1) {
      return { match: toMatch(candidates[0]!, 'exact'), reason: 'Matched a catalog SKU.' };
    }
    if (candidates.length > 1) {
      const disambiguated = disambiguate(candidates, text);
      if (disambiguated) {
        return { match: toMatch(disambiguated, 'alias'), reason: 'Matched a catalog SKU by title wording.' };
      }
      // No variant wording in the title means the plain configuration: a
      // listing that just says "hobby box" is the standard hobby box, not the
      // HTA jumbo one that a seller would certainly have advertised.
      const standard = candidates.filter((c) => c.variant === null);
      if (standard.length === 1) {
        return {
          match: { ...toMatch(standard[0]!, 'exact'), ambiguityNote: `${candidates.length - 1} special configuration(s) exist for this set; the title named none of them.` },
          reason: 'Matched the standard configuration for this set.',
        };
      }
      // Prices that agree can be used even when we cannot tell the SKUs apart.
      const prices = candidates.map((c) => c.msrpCents);
      const spread = (Math.max(...prices) - Math.min(...prices)) / Math.min(...prices);
      if (spread <= 0.1) {
        return {
          match: { ...toMatch(candidates[0]!, 'alias'), ambiguityNote: `${candidates.length} similar SKUs, all within 10% on price.` },
          reason: 'Several catalog SKUs match but they agree on price.',
        };
      }
      return {
        match: null,
        reason:
          `${candidates.length} different ${parsed.setName ?? 'catalog'} SKUs share this product type ` +
          `(${prices.map((p) => `$${(p / 100).toFixed(2)}`).join(', ')}) and the title does not say which. ` +
          'Refusing to guess, since the wrong one would invent a discount.',
      };
    }
  }

  // Tier 2: era-wide defaults, e.g. "any current Pokemon booster pack".
  const year = parsed.year ?? new Date().getFullYear();
  const fallback = catalog.defaults.find(
    (d) => d.category === parsed.category && d.productType === parsed.productType && year >= d.yearFrom && year <= d.yearTo,
  );
  if (fallback) {
    return {
      match: {
        msrpCents: fallback.msrpCents,
        // An era default is a weaker claim than a per-SKU figure.
        confidence: fallback.confidence === 'high' ? 'medium' : 'low',
        quality: 'era-default',
        entryId: `default:${fallback.category}:${fallback.productType}`,
        label: fallback.note,
        source: fallback.source,
      },
      reason: 'No exact SKU in the catalog; used the era-wide price for this product type.',
    };
  }

  return {
    match: null,
    reason: parsed.setSlug
      ? `No MSRP on file for ${parsed.setName ?? parsed.setSlug} ${parsed.productType}.`
      : 'Could not identify which set this is, so no MSRP could be looked up.',
  };
}

/**
 * Pick the candidate the title actually describes.
 *
 * Variant markers outrank everything. "2025 Panini Prizm Hobby Box No Huddle"
 * contains the generic phrase "prizm hobby box", so scoring purely on matched
 * length picks the standard $974.95 box and reports a listing at $500 as half
 * price — when it is in fact a No Huddle box priced slightly above its own
 * $474.95. A seller never types "no huddle" about a standard box, so the
 * variant word is decisive whenever it appears.
 */
function disambiguate(candidates: readonly CatalogEntry[], normalizedTitle: string): CatalogEntry | null {
  const scored = candidates.map((entry) => ({
    entry,
    aliasScore: longestAliasMatch(entry, normalizedTitle),
    variantHit: entryVariantAppears(entry, normalizedTitle),
  }));

  // Step 1: variant markers.
  const variantHits = scored.filter((s) => s.variantHit);
  if (variantHits.length === 1) return variantHits[0]!.entry;
  if (variantHits.length > 1) {
    const best = variantHits.reduce((a, b) => (b.aliasScore > a.aliasScore ? b : a));
    const tied = variantHits.filter((s) => s.aliasScore === best.aliasScore);
    return tied.length === 1 ? best.entry : null;
  }

  // Step 2: SKUs that share a variant and are told apart only by their name,
  // such as the several 30th Celebration collection boxes.
  const aliasHits = scored.filter((s) => s.aliasScore > 0);
  if (aliasHits.length === 0) return null;
  const best = aliasHits.reduce((a, b) => (b.aliasScore > a.aliasScore ? b : a));
  const tied = aliasHits.filter((s) => s.aliasScore === best.aliasScore);
  // A tie means two SKUs matched equally well, which is not a match at all.
  return tied.length === 1 ? best.entry : null;
}

/**
 * Length of the longest DISTINGUISHING alias of `entry` present in the title.
 *
 * Catalog aliases include bare restatements of the product type — "booster
 * box", "hobby box", "blaster". Those describe every candidate equally, so
 * letting one win disambiguation just picks whichever SKU happened to list it,
 * which is how a listing gets priced against the wrong configuration.
 */
function longestAliasMatch(entry: CatalogEntry, normalizedTitle: string): number {
  let best = 0;
  for (const alias of entry.aliases) {
    if (alias.length < 4) continue;
    if (!normalizedTitle.includes(alias)) continue;
    if (isProductTypeRestatement(alias, entry)) continue;
    if (alias.length > best) best = alias.length;
  }
  return best;
}

/** True when an alias says nothing beyond the product type it belongs to. */
function isProductTypeRestatement(alias: string, entry: CatalogEntry): boolean {
  const typeWords = entry.productType.split('-').filter((w) => w.length >= 2);
  const aliasWords = alias.split(/\s+/).filter((w) => w.length >= 2);
  if (aliasWords.length === 0) return true;
  // An alias made up entirely of the product type's own words carries no
  // information about which SKU this is.
  return aliasWords.every((word) => typeWords.some((t) => t.startsWith(word) || word.startsWith(t)));
}

/**
 * Whether the title names this entry's variant, either as the variant phrase
 * itself ("no huddle") or through an alias that encodes it ("prizm nh").
 */
function entryVariantAppears(entry: CatalogEntry, normalizedTitle: string): boolean {
  if (!entry.variant) return false;
  const phrase = entry.variant.replace(/-/g, ' ');
  if (normalizedTitle.includes(phrase)) return true;
  // An alias only counts as variant evidence if it is more than the generic
  // product name — it has to be specific to this configuration.
  return entry.aliases.some(
    (alias) => alias.length >= 4 && normalizedTitle.includes(alias) && !isGenericAlias(alias, entry),
  );
}

/** True when an alias just restates the set and product type. */
function isGenericAlias(alias: string, entry: CatalogEntry): boolean {
  const variantWords = entry.variant ? entry.variant.split('-') : [];
  return !variantWords.some((word) => word.length >= 2 && alias.includes(word));
}

function toMatch(entry: CatalogEntry, quality: MsrpMatchQuality): MsrpMatch {
  return {
    msrpCents: entry.msrpCents,
    confidence: entry.confidence,
    quality,
    entryId: entry.id,
    label: `${entry.year} ${entry.setName} ${humanizeType(entry.productType)}${entry.variant ? ` (${entry.variant.replace(/-/g, ' ')})` : ''}`,
    source: entry.source,
  };
}

export function humanizeType(type: ProductType): string {
  return type.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Every catalog set slug, for validating that catalog and parser agree. */
export function catalogSetSlugs(catalog: CatalogFile = loadCatalog()): Set<string> {
  return new Set(catalog.entries.map((e) => e.setSlug));
}
