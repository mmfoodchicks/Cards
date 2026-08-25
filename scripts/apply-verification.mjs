/**
 * Corrections from the adversarial audit of the seed MSRP catalog.
 *
 * Each change records why it was made, because a wrong MSRP is worse than a
 * missing one: it makes the app confidently mislabel real listings.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync('catalog/msrp.json', 'utf8'));
const sets = JSON.parse(readFileSync('catalog/sets.json', 'utf8'));
const applied = [];

function entry(predicate) {
  return catalog.entries.filter(predicate);
}

// 1. Phantasmal Flames is ME02 and released November 2025, not 2026. It sat a
//    full year out of sequence between two correctly dated siblings.
for (const e of entry((e) => e.setSlug === 'phantasmal-flames')) {
  if (e.year === 2026) {
    e.year = 2025;
    e.id = e.id.replace('__2026__', '__2025__');
    applied.push(`Phantasmal Flames year 2026 -> 2025 (${e.productType})`);
  }
}
for (const s of sets) {
  if (s.slug === 'phantasmal-flames' && s.year !== 2025) {
    s.year = 2025;
    applied.push('sets.json: Phantasmal Flames year -> 2025');
  }
}

// 2. Topps Chrome Updates Basketball: $529.99 was the pre-order price. The
//    release-day figure is $549.99, so the old number would have flagged
//    over-priced boxes as deals.
for (const e of entry((e) => e.setSlug === 'topps-chrome-basketball' && e.msrpCents === 52999)) {
  e.msrpCents = 54999;
  e.source = 'https://www.checklistinsider.com/2025-26-topps-chrome-update-series-basketball';
  applied.push('Topps Chrome Updates Basketball $529.99 -> $549.99 (pre-order price was stale)');
}

// 3. Prismatic Evolutions Super Premium Collection: sources disagree between
//    $89.99 and $119.99. Keep the Pokemon Center figure but stop claiming
//    medium confidence in it.
for (const e of entry((e) => e.setSlug === 'prismatic-evolutions' && e.productType === 'collection-box')) {
  e.confidence = 'low';
  applied.push('Prismatic Evolutions collection box confidence medium -> low (sources disagree $89.99 vs $119.99)');
}

// 4. Pokemon booster-box MSRPs are all pack-price arithmetic, not published
//    figures. The Pokemon Company does not publish a box MSRP at all.
for (const e of entry((e) => e.category === 'pokemon' && e.productType === 'booster-box' && e.confidence === 'high')) {
  e.confidence = 'medium';
  applied.push(`Pokemon booster box confidence high -> medium (${e.setName}: derived from pack price x 36, not published)`);
}
for (const d of catalog.defaults) {
  if (d.category === 'pokemon' && d.productType === 'booster-box') d.confidence = 'low';
}

// 5. Mega Evolution base-set bundle: the cited source covers a different
//    product, and Target lists it at $29.99. The $26.94 is unsourced
//    arithmetic.
for (const e of entry((e) => e.setSlug === 'mega-evolution' && e.productType === 'booster-bundle')) {
  e.confidence = 'low';
  applied.push('Mega Evolution booster bundle confidence medium -> low (citation did not cover this product)');
}

// 6. Perfect Order ETB rests on a single low-authority blog. The $49.99 figure
//    is the block-wide norm and probably right, but it is not "high".
for (const e of entry((e) => e.setSlug === 'me-perfect-order' && e.productType === 'elite-trainer-box')) {
  e.confidence = 'medium';
  applied.push('Perfect Order ETB confidence high -> medium (single low-authority source)');
}

// 7. Eleven of the twelve 30th Celebration rows are single-sourced to one small
//    site. Only the $179.99 Day & Night UPC was independently confirmed.
for (const e of entry((e) => e.setSlug === '30th-celebration' && e.confidence === 'high' && e.msrpCents !== 17999)) {
  e.confidence = 'medium';
  applied.push(`30th Celebration ${e.productType}${e.variant ? ` (${e.variant})` : ''} high -> medium (single-sourced)`);
}

catalog.entries.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync('catalog/msrp.json', JSON.stringify(catalog, null, 2) + '\n');
writeFileSync('catalog/sets.json', JSON.stringify(sets, null, 2) + '\n');

console.log(`${applied.length} corrections applied:`);
for (const line of applied) console.log(`  - ${line}`);

const byConf = {};
for (const e of catalog.entries) byConf[e.confidence] = (byConf[e.confidence] ?? 0) + 1;
console.log('confidence distribution:', JSON.stringify(byConf));
