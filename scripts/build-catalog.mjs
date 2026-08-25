/**
 * Regenerates src/catalog/sets.json and src/catalog/msrp.json.
 *
 * Run with: node scripts/build-catalog.mjs <research.json>
 * The research file is the raw MSRP research payload. Everything the generator
 * cannot map to a known set slug is reported rather than silently dropped.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const researchPath = process.argv[2];
const existingSets = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const research = JSON.parse(readFileSync(researchPath, 'utf8'));

/** Sets referenced by the MSRP research that the parser did not already know. */
const NEW_SETS = [
  // --- Pokemon: Mega Evolution / 30th era -------------------------------
  { slug: 'me-pitch-black', display: 'Mega Evolution: Pitch Black', category: 'pokemon', brand: 'Pokemon', year: 2026, aliases: ['pitch black'] },
  { slug: 'me-perfect-order', display: 'Mega Evolution: Perfect Order', category: 'pokemon', brand: 'Pokemon', year: 2026, aliases: ['perfect order'] },
  { slug: '30th-celebration', display: 'Pokemon 30th Celebration', category: 'pokemon', brand: 'Pokemon', year: 2026, aliases: ['30th celebration', '30th anniversary celebration', 'pokemon 30th'] },
  // --- Sports lines the research priced separately -----------------------
  { slug: 'topps-heritage-high-number', display: 'Topps Heritage High Number', category: 'baseball', brand: 'Topps', year: 2025, aliases: ['heritage high number', 'heritage high #'] },
  { slug: 'topps-chrome-football', display: 'Topps Chrome Football', category: 'football', brand: 'Topps', year: 2025, aliases: ['topps chrome football'] },
  { slug: 'panini-donruss-elite', display: 'Panini Donruss Elite', category: 'football', brand: 'Panini', year: 2025, aliases: ['donruss elite'] },
  { slug: 'topps-basketball', display: 'Topps Basketball', category: 'basketball', brand: 'Topps', year: 2025, aliases: ['topps basketball', 'topps nba'] },
  { slug: 'topps-chrome-basketball', display: 'Topps Chrome Basketball', category: 'basketball', brand: 'Topps', year: 2025, aliases: ['topps chrome basketball', 'topps chrome updates basketball'] },
  // --- Other TCGs ---------------------------------------------------------
  { slug: 'op-17', display: 'One Piece Set 17', category: 'onepiece', brand: 'Bandai', year: 2026, aliases: ['op-17', 'op17', 'one piece set 17'] },
  { slug: 'mtg-lorwyn-eclipsed', display: 'Lorwyn Eclipsed', category: 'magic', brand: 'Wizards of the Coast', year: 2026, aliases: ['lorwyn eclipsed'] },
  { slug: 'mtg-foundations', display: 'Magic Foundations', category: 'magic', brand: 'Wizards of the Coast', year: 2024, aliases: ['magic foundations', 'mtg foundations', ' foundations '] },
  { slug: 'mtg-marvel-super-heroes', display: "Marvel's Spider-Man / Super Heroes", category: 'magic', brand: 'Wizards of the Coast', year: 2026, aliases: ['marvel super heroes', 'marvel superheroes'] },
  { slug: 'lorcana-wilds-unknown', display: 'Lorcana: Wilds Unknown', category: 'other', brand: 'Ravensburger', year: 2026, aliases: ['wilds unknown', 'lorcana wilds'] },
  { slug: 'ygo-burst-protocol', display: 'Yu-Gi-Oh! Burst Protocol', category: 'yugioh', brand: 'Konami', year: 2026, aliases: ['burst protocol'] },
  { slug: 'ygo-rarity-collection-v', display: 'Yu-Gi-Oh! Rarity Collection V', category: 'yugioh', brand: 'Konami', year: 2026, aliases: ['rarity collection v', 'rarity collection 5'] },
  { slug: 'ygo-legendary-modern-decks', display: 'Yu-Gi-Oh! Legendary Modern Decks', category: 'yugioh', brand: 'Konami', year: 2026, aliases: ['legendary modern decks'] },
  { slug: 'swu-twilight-republic', display: 'Star Wars Unlimited: Twilight of the Republic', category: 'other', brand: 'Fantasy Flight', year: 2024, aliases: ['twilight of the republic'] },
  { slug: 'swu-shadows-galaxy', display: 'Star Wars Unlimited: Shadows of the Galaxy', category: 'other', brand: 'Fantasy Flight', year: 2024, aliases: ['shadows of the galaxy'] },
];

/**
 * Maps a research setName to { slug, variant }.
 * `variant` distinguishes SKUs that share a product type inside one set —
 * a jumbo/HTA hobby box is not the same box as a regular hobby box.
 */
const SET_MAP = [
  [/^Mega Evolution - Pitch Black$/i, 'me-pitch-black', null],
  [/^Mega Evolution - Perfect Order$/i, 'me-perfect-order', null],
  [/^Mega Evolution - Phantasmal Flames$/i, 'phantasmal-flames', null],
  [/^Mega Evolution \(base set\)$/i, 'mega-evolution', null],
  [/^Mega Evolution era/i, null, null],
  [/^30th Celebration \(Pokemon Center exclusive\)$/i, '30th-celebration', 'pokemon-center'],
  [/^30th Celebration - Day & Night Mini Tins$/i, '30th-celebration', 'mini-tin'],
  [/^30th Celebration - Day & Night$/i, '30th-celebration', 'day-and-night'],
  [/^30th Celebration - Ditto Premium Collection$/i, '30th-celebration', 'ditto-premium'],
  [/^30th Celebration - Sylveon ex \/ Greninja ex Tin$/i, '30th-celebration', 'sylveon-greninja-tin'],
  [/^30th Celebration - Mewtwo \/ Mew Figure Collection$/i, '30th-celebration', 'mewtwo-mew-figure'],
  [/^30th Celebration$/i, '30th-celebration', null],
  [/^Scarlet & Violet - Prismatic Evolutions$/i, 'prismatic-evolutions', null],
  [/^Scarlet & Violet - 151$/i, 'pokemon-151', null],
  [/^Scarlet & Violet era/i, null, null],
  [/^Topps Series 1 Collector's Super Box$/i, 'topps-series-1', 'super-box'],
  [/^Topps Series 1$/i, 'topps-series-1', null],
  [/^Bowman Chrome$/i, 'bowman-chrome', null],
  [/^Bowman$/i, 'bowman', null],
  [/^Topps Heritage High Number$/i, 'topps-heritage-high-number', null],
  [/^Topps Heritage$/i, 'topps-heritage', null],
  [/^Stadium Club$/i, 'topps-stadium-club', null],
  [/^Topps Chrome$/i, 'topps-chrome', null],
  [/^Prizm Football No Huddle$/i, 'panini-prizm', 'no-huddle'],
  [/^Prizm Football$/i, 'panini-prizm', null],
  [/^Donruss Optic Football$/i, 'panini-optic', null],
  [/^Donruss Elite Football$/i, 'panini-donruss-elite', null],
  [/^Donruss Football$/i, 'panini-donruss', null],
  [/^Mosaic Football Choice$/i, 'panini-mosaic', 'choice'],
  [/^Mosaic Football$/i, 'panini-mosaic', null],
  [/^Score Football$/i, 'panini-score', null],
  [/^Topps Chrome Football$/i, 'topps-chrome-football', null],
  [/^Prizm Basketball/i, 'panini-prizm', null],
  [/^Donruss Basketball/i, 'panini-donruss', null],
  [/^Topps Chrome Updates Basketball/i, 'topps-chrome-basketball', null],
  [/^Topps Basketball/i, 'topps-basketball', null],
  [/^Topps NBA Hoops/i, 'panini-hoops', null],
  [/^One Piece Card Game Set 17 Double Pack Set/i, 'op-17', 'double-pack-set'],
  [/^One Piece Card Game Set 17/i, 'op-17', null],
  [/^One Piece Card Game \(English, any current set\)$/i, null, null],
  [/^Lorwyn Eclipsed$/i, 'mtg-lorwyn-eclipsed', null],
  [/^Foundations$/i, 'mtg-foundations', null],
  [/^Marvel Super Heroes$/i, 'mtg-marvel-super-heroes', null],
  [/^Wilds Unknown$/i, 'lorcana-wilds-unknown', null],
  [/^Burst Protocol$/i, 'ygo-burst-protocol', null],
  [/^Rarity Collection V$/i, 'ygo-rarity-collection-v', null],
  [/^Legendary Modern Decks 2026$/i, 'ygo-legendary-modern-decks', null],
  [/^Twilight of the Republic$/i, 'swu-twilight-republic', null],
  [/^Shadows of the Galaxy$/i, 'swu-shadows-galaxy', null],
];

/** Category fixes: the research lumped several games into "other-tcg". */
const CATEGORY_BY_SLUG = {
  'op-17': 'onepiece',
  'mtg-lorwyn-eclipsed': 'magic',
  'mtg-foundations': 'magic',
  'mtg-marvel-super-heroes': 'magic',
  'lorcana-wilds-unknown': 'other',
  'ygo-burst-protocol': 'yugioh',
  'ygo-rarity-collection-v': 'yugioh',
  'ygo-legendary-modern-decks': 'yugioh',
  'swu-twilight-republic': 'other',
  'swu-shadows-galaxy': 'other',
};

const sets = [...existingSets, ...NEW_SETS];
// Mega Evolution base set already exists in the parser vocabulary.
const setSlugs = new Set(sets.map((s) => s.slug));

const entries = [];
const defaults = [];
const unmapped = [];
const seen = new Map();

for (const p of research.products) {
  const mapping = SET_MAP.find(([re]) => re.test(p.setName));
  if (!mapping) {
    unmapped.push(p.setName);
    continue;
  }
  const [, slug, variant] = mapping;

  // Several lines ship two configurations under one product type. Derive the
  // variant from the seller-facing aliases rather than from price, because
  // price is exactly the thing we are trying to judge.
  const productType = p.productType;
  const aliasText = (p.aliases ?? []).join(' ').toLowerCase() + ' ' + p.setName.toLowerCase();
  let effVariant = variant;
  if (!effVariant) {
    if (/\bhta\b|\bjumbo\b/.test(aliasText)) effVariant = 'jumbo';
    else if (/\bchoice\b/.test(aliasText)) effVariant = 'choice';
    else if (/collector booster/.test(aliasText)) effVariant = 'collector';
    else if (/play booster/.test(aliasText)) effVariant = 'play';
    else if (/commander deck/.test(aliasText)) effVariant = 'commander';
    else if (/\bbundle\b/.test(aliasText) && productType === 'collection-box') effVariant = 'bundle';
    else if (/prerelease/.test(aliasText)) effVariant = 'prerelease';
    else if (/trove/.test(aliasText)) effVariant = 'trove';
  }

  let category = slug ? (CATEGORY_BY_SLUG[slug] ?? p.category) : p.category;
  if (category === 'other-tcg') {
    // The research bucketed every non-sports, non-Pokemon game together.
    if (/one piece/i.test(p.setName)) category = 'onepiece';
    else if (/lorcana/i.test(aliasText)) category = 'other';
    else category = 'other';
  }

  const base = {
    category,
    brand: p.brand.replace(/\s*\(.*\)\s*$/, '').trim(),
    year: p.year,
    setSlug: slug,
    setName: slug ? (sets.find((s) => s.slug === slug)?.display ?? p.setName) : p.setName,
    productType,
    variant: effVariant,
    msrpCents: Math.round(p.msrpUsd * 100),
    packsPerUnit: p.packsPerUnit ?? null,
    cardsPerPack: p.cardsPerPack ?? null,
    confidence: p.confidence,
    source: p.source,
    aliases: (p.aliases ?? []).map((a) => a.toLowerCase()),
  };

  if (!slug) {
    // "any current set" rows become era-wide fallbacks.
    defaults.push({ ...base, yearFrom: p.year - 1, yearTo: p.year + 1, note: p.setName });
    continue;
  }
  if (!setSlugs.has(slug)) {
    unmapped.push(`${p.setName} -> unknown slug ${slug}`);
    continue;
  }

  const id = [category, p.year, slug, productType, effVariant ?? 'std'].join('__');
  const dupe = seen.get(id);
  if (dupe) {
    // Same coarse SKU, different price: keep both but mark them ambiguous so
    // the resolver knows it must disambiguate on aliases before benchmarking.
    dupe.ambiguous = true;
    entries.push({ ...base, id: `${id}__${entries.length}`, ambiguous: true });
    continue;
  }
  const entry = { ...base, id, ambiguous: false };
  seen.set(id, entry);
  entries.push(entry);
}

// Era-wide Pokemon pack pricing is the single highest-value default: it lets
// the app price any pack from any set even when the set is unknown.
sets.sort((a, b) => a.slug.localeCompare(b.slug));
entries.sort((a, b) => a.id.localeCompare(b.id));

writeFileSync('catalog/sets.json', JSON.stringify(sets, null, 2) + '\n');
writeFileSync(
  'catalog/msrp.json',
  JSON.stringify({ version: 1, generatedFrom: 'research', entries, defaults }, null, 2) + '\n',
);

console.log(`sets:     ${sets.length}`);
console.log(`entries:  ${entries.length}`);
console.log(`defaults: ${defaults.length}`);
console.log(`ambiguous: ${entries.filter((e) => e.ambiguous).length}`);
if (unmapped.length) console.log('UNMAPPED:', [...new Set(unmapped)].join(' | '));
