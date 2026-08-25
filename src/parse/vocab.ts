/**
 * Vocabulary tables for listing-title parsing.
 *
 * Card sellers write titles as keyword soup: "2023 Pokemon 151 ETB Elite
 * Trainer Box SEALED IN HAND FAST SHIP!! sv3.5". Everything the parser knows
 * about how that soup is spelled lives here so it can be reviewed and extended
 * without touching parsing logic.
 *
 * Convention: every alias is lowercase; the parser lowercases titles before
 * matching. Multi-word aliases must be listed with single spaces.
 */

import { readFileSync } from 'node:fs';
import type { Category, Grader, ProductType } from '../types.js';
import { fromRoot } from '../util/paths.js';

/**
 * Words that identify what hobby a listing belongs to.
 *
 * `strong` terms name the hobby outright and settle the question on their own:
 * a title containing "basketball" is a basketball listing even though "Topps
 * Chrome" also appears and Topps Chrome is mostly a baseball line.
 * `terms` are generic hobby words, safe to strip from a title once matched.
 * `subjects` are player and character names: they are strong category signals
 * but they ARE the thing we want to extract as the card's subject, so the
 * parser must never consume them.
 */
export const CATEGORY_TERMS: Array<{ category: Category; strong: string[]; terms: string[]; subjects: string[] }> = [
  {
    category: 'pokemon',
    strong: ['pokemon', 'pokemon tcg', 'ptcg'],
    terms: [
      'pokemon', 'pokemon tcg', 'ptcg', 'elite trainer box', ' etb ',
      'scarlet & violet', 'scarlet and violet', 'sword & shield', 'sun & moon',
      'trainer gallery', 'pokemon center',
    ],
    subjects: ['charizard', 'pikachu', 'umbreon', 'eevee', 'mewtwo', 'moonbreon', 'lugia', 'rayquaza', 'gengar', 'snorlax'],
  },
  {
    category: 'magic',
    strong: ['magic the gathering', 'magic: the gathering', ' mtg '],
    terms: [
      'magic the gathering', 'magic: the gathering', ' mtg ', 'commander deck',
      'play booster', 'set booster', 'collector booster', 'wizards of the coast',
    ],
    subjects: ['black lotus', 'ancestral recall', 'mox '],
  },
  {
    category: 'yugioh',
    strong: ['yugioh', 'yu-gi-oh', 'yu gi oh', ' ygo '],
    terms: ['yugioh', 'yu-gi-oh', 'yu gi oh', ' ygo ', 'konami'],
    subjects: ['blue-eyes white dragon', 'dark magician', 'exodia'],
  },
  {
    category: 'onepiece',
    strong: ['one piece card', 'one piece tcg'],
    terms: [
      'one piece card', 'one piece tcg', 'op-01', 'op-02', 'op-03', 'op-04', 'op-05',
      'op-06', 'op-07', 'op-08', 'op-09', 'op-10', 'op-11', 'romance dawn', 'bandai one piece',
    ],
    subjects: ['monkey d luffy', 'luffy', 'zoro', 'nami', 'shanks'],
  },
  {
    category: 'baseball',
    strong: ['baseball', ' mlb '],
    terms: [
      // Baseball-only lines. "Topps Chrome" and "Stadium Club" are deliberately
      // absent: both ship for football, basketball and soccer too, so treating
      // them as baseball evidence mislabels every other sport's listings.
      'bowman', 'bowman chrome', 'bowman draft', 'topps series 1', 'topps series 2',
      'topps heritage', 'topps update', 'allen & ginter', 'allen and ginter',
      'gypsy queen', 'topps big league',
    ],
    subjects: [
      'ohtani', 'shohei ohtani', 'paul skenes', 'jackson holliday', 'mike trout',
      'aaron judge', 'juan soto', 'ronald acuna', 'bobby witt', 'elly de la cruz',
      'jackson chourio', 'wyatt langford', 'dylan crews', 'mickey mantle', 'ken griffey',
    ],
  },
  {
    category: 'football',
    strong: ['football', ' nfl '],
    terms: [
      'football', ' nfl ', 'panini prizm football', 'donruss football', 'optic football',
      'score football', 'mosaic football', 'contenders football', 'quarterback',
      'wide receiver', 'running back',
    ],
    subjects: [
      'caleb williams', 'jayden daniels', 'patrick mahomes', 'josh allen',
      'bijan robinson', 'cj stroud', 'c.j. stroud', 'travis hunter', 'marvin harrison',
      'malik nabers', 'tom brady', 'justin jefferson', 'ja marr chase', "ja'marr chase",
    ],
  },
  {
    category: 'basketball',
    strong: ['basketball', ' nba '],
    terms: [
      'basketball', ' nba ', 'panini prizm basketball', 'hoops basketball',
      'select basketball', 'donruss basketball',
    ],
    subjects: [
      'victor wembanyama', 'wembanyama', 'lebron james', 'luka doncic', 'stephen curry',
      'michael jordan', 'cooper flagg', 'anthony edwards', 'kobe bryant', 'jayson tatum',
    ],
  },
  {
    category: 'hockey',
    strong: ['hockey', ' nhl '],
    terms: ['hockey', ' nhl ', 'upper deck young guns', 'young guns'],
    subjects: ['connor bedard', 'mcdavid', 'connor mcdavid', 'auston matthews', 'wayne gretzky'],
  },
  {
    category: 'soccer',
    strong: ['soccer', 'futbol', ' fifa '],
    terms: [
      'soccer', 'futbol', ' fifa ', ' uefa ', 'champions league',
      'panini prizm soccer', 'topps chrome ucl',
    ],
    subjects: ['messi', 'lionel messi', 'mbappe', 'haaland', 'ronaldo', 'jude bellingham'],
  },
];

/** Sealed product forms and every way sellers abbreviate them.
 *  Longer aliases must come before shorter ones they contain: the matcher
 *  scans this list in order and takes the first hit, so "booster box" has to
 *  be tested before "box". */
export const PRODUCT_TYPE_ALIASES: Array<{ type: ProductType; aliases: string[] }> = [
  { type: 'case', aliases: ['sealed case', 'hobby case', 'factory case', '12 box case', '6 box case', 'master case'] },
  {
    type: 'ultra-premium-collection',
    aliases: ['ultra premium collection', 'ultra-premium collection', 'upc box', ' upc '],
  },
  {
    type: 'elite-trainer-box',
    aliases: ['elite trainer box', 'elite-trainer box', 'pokemon center elite trainer', ' etb ', 'etb box', 'set elite trainer'],
  },
  {
    type: 'booster-bundle',
    aliases: ['booster bundle', 'booster-bundle', 'bundle box', '6 pack bundle'],
  },
  {
    type: 'booster-box',
    aliases: ['booster box', 'booster-box', 'display box', '36 pack box', '36ct box', '18 pack box', ' bb box', 'sealed booster box'],
  },
  {
    type: 'blaster-box',
    aliases: ['blaster box', 'blaster-box', ' blaster ', 'blaster pack'],
  },
  {
    type: 'hobby-box',
    aliases: ['hobby box', 'hobby-box', ' hobby ', 'jumbo hobby box', 'hta box', 'hobby jumbo'],
  },
  {
    type: 'hanger-box',
    aliases: ['hanger box', 'hanger-box', ' hanger ', 'hanger pack'],
  },
  {
    type: 'mega-box',
    aliases: ['mega box', 'mega-box', 'megabox'],
  },
  {
    type: 'value-pack',
    aliases: ['value pack', 'fat pack', 'cello pack', 'rack pack', 'jumbo pack', 'value box', 'multi-pack', 'multi pack'],
  },
  {
    type: 'tin',
    aliases: ['collector tin', 'mini tin', 'poke ball tin', 'pokeball tin', ' tin ', 'tin sealed'],
  },
  {
    type: 'collection-box',
    aliases: [
      'collection box', 'premium collection', 'special collection', 'build & battle',
      'build and battle', 'binder collection', 'sticker collection', 'surprise box',
      'league battle deck', 'battle deck', 'theme deck', 'starter deck', 'gift set',
      'holiday calendar', 'advent calendar', 'blister pack', 'three pack blister',
      '3 pack blister', 'checklane', 'trainer toolkit',
    ],
  },
  {
    type: 'retail-box',
    aliases: ['retail box', 'retail display', 'gravity feed'],
  },
  {
    type: 'booster-pack',
    aliases: ['booster pack', 'booster-pack', 'sealed pack', 'loose pack', 'single pack', 'pack of cards', ' packs', ' pack '],
  },
];

/** Terms that establish a listing is factory sealed product rather than a card. */
export const SEALED_TERMS = [
  'factory sealed', 'sealed', 'unopened', 'brand new sealed', 'nib', 'new in box',
  'shrink wrapped', 'shrinkwrapped', 'still sealed', 'unsearched sealed',
];

/** Terms that positively identify a loose single card. */
export const SINGLE_TERMS = [
  'psa', 'bgs', 'sgc', 'cgc', 'rookie card', ' rc ', 'auto', 'autograph', 'patch',
  'refractor', 'prizm', 'holo', 'reverse holo', 'numbered', 'base card', 'single card',
];

export const GRADERS: Array<{ code: Grader; aliases: string[]; max: number }> = [
  { code: 'PSA', aliases: ['psa graded', 'professional sports authenticator', 'psa/dna', 'psa dna', 'psa '], max: 10 },
  { code: 'BGS', aliases: ['beckett grading services', 'beckett grading', 'beckett graded', 'bgs graded', 'beckett', 'bgs ', 'bvg ', 'bccg '], max: 10 },
  { code: 'SGC', aliases: ['sportscard guaranty corporation', 'sportscard guaranty', 'sgc graded', 'sgc '], max: 10 },
  { code: 'CGC', aliases: ['certified guaranty company', 'cgc trading cards', 'cgc graded', 'cgc cards', 'cgc '], max: 10 },
  { code: 'CSG', aliases: ['certified sports guaranty', 'csg '], max: 10 },
  { code: 'TAG', aliases: ['technical authentication and grading', 'tag graded', 'tag grading', 'tag '], max: 10 },
  { code: 'HGA', aliases: ['hybrid grading approach', 'hybrid grading', 'hga '], max: 10 },
  { code: 'AGS', aliases: ['automated grading systems', 'ags grading', 'ags '], max: 10 },
  { code: 'ISA', aliases: ['international sports authentication', 'isa grading', 'isa '], max: 10 },
  { code: 'GMA', aliases: ['gem mint authentication', 'gma grading', 'gma '], max: 10 },
];

/** Raw-card condition abbreviations, canonical form first. */
export const CONDITION_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'NM', aliases: ['near mint', 'nm-mt', 'nm/mt', ' nm ', 'mint', ' mt '] },
  { canonical: 'LP', aliases: ['lightly played', 'light play', ' lp ', 'excellent'] },
  { canonical: 'MP', aliases: ['moderately played', 'moderate play', ' mp ', 'very good'] },
  { canonical: 'HP', aliases: ['heavily played', 'heavy play', ' hp ', 'poor', 'played'] },
  { canonical: 'DMG', aliases: ['damaged', ' dmg ', 'creased', 'crease', 'water damage', 'bent'] },
];

/**
 * Phrases meaning the listing is not one comparable unit.
 * `explicit` phrases always mean a lot; `quantityPatterns` also recover how many.
 */
export const LOT_TERMS = [
  'lot of', ' lot ', ' lots ', 'bundle of', 'group of', 'batch of',
  'bulk', 'bulk lot', 'collection lot', 'job lot', 'mixed lot', 'sealed lot',
  'bundle lot', 'starter lot', 'investor lot', 'huge lot', 'big lot',
  'massive lot', 'mega lot', 'box lot', 'pack lot',
  'wholesale', 'reseller', 'resale lot', 'liquidation', 'closeout',
  'clearance lot', 'assorted', 'variety pack', 'variety lot',
  'personal collection', 'whole collection',
];

/**
 * Phrases where a number describes what is INSIDE one unit rather than how
 * many units are for sale. "36 packs per box" is one box; reading it as a lot
 * of 36 would divide the price by 36 and manufacture a spectacular fake deal.
 */
export const PER_UNIT_COUNT_PATTERNS: RegExp[] = [
  /\b\d{1,3}\s*(?:packs?|cards?|tins?)\s*(?:per|\/)\s*(?:box|bundle|pack|case|etb)\b/,
  /\b\d{1,3}\s*(?:packs?|cards?)\s+(?:in|inside)\s+(?:each|every|the)\b/,
  /\beach\s+(?:box|bundle|pack)\s+(?:has|contains|includes)\s+\d{1,3}\b/,
];

/** Listings that are gambling products or repackaged junk, not real product. */
export const REPACK_TERMS = [
  // Repackaged product: the contents are not the SKU on the label.
  'repack', 're-pack', 're pack', 'repacked', 'collector repack', 'value repack',
  'mystery box', 'mystery pack', 'mystery bag', 'mystery slab', 'grab bag',
  'blind box', 'blind bag', 'surprise box', 'treasure box', 'treasure hunt',
  'hot pack', 'searched', 'weighed', 'guaranteed hit', 'guaranteed hits',
  'hits guaranteed', 'guaranteed auto', 'guaranteed slab',
  // Breaks: you are buying a chance, not a product, so the price is unrelated
  // to what the box costs.
  'group break', 'case break', 'box break', 'live break', 'personal break',
  'break spot', 'random team', 'random division', 'random player',
  'random pack', 'random card', 'random hit', 'pick your team', 'pick your player',
  ' pyt ', ' pyp ', 'razz', 'razzle', 'raffle', 'giveaway', 'sweepstake',
  'division in a box', 'teams in a box', 'filler spot',
  // "You pick": the listed price is per chosen card, not for what is pictured.
  'you pick', 'u pick', 'pick your card', 'choose your card', 'complete your set',
];

/** Signals the item is worthless, fake, or not the physical card it appears to be. */
export const RED_FLAG_TERMS = [
  // Not the real card.
  'proxy', 'proxies', 'proxy card', 'custom card', 'custom cards', 'custom made',
  'custom art', 'altered art', 'orica', 'fan made', 'fan-made', 'fanmade',
  'fan art', 'homemade', 'home made', 'handmade card',
  'reprint', 'reprints', 'reprinted', 're-print', ' rp ', 'repro ', 'reproduction',
  'replica', 'fake', 'counterfeit', 'not authentic', 'not real', 'unofficial',
  'unlicensed', 'novelty card', 'tribute card', 'concept card',
  'aceo', 'art card', 'art print', 'sketch card',
  // Not a physical card at all.
  'digital card', 'digital code', 'code card', 'code cards', 'online code',
  'ptcgl', 'ptcgo', 'qr code',
  // Not the product, just its packaging or a picture of it.
  'empty box', 'empty pack', 'box only', 'wrapper only', 'no cards',
  'photo only', 'picture only', 'display only', 'sticker only',
  'toploader only', 'case only', 'binder only',
  // Tampered or unstated.
  'read description', 'damaged box', 'resealed', 'reseal', 'opened box',
  'crushed box', 'water damage',
];

/**
 * Parallels, inserts and hits that materially change a card's value.
 *
 * Grouped so that "Silver Prizm", "silver" and "prizm" in the same title
 * collapse to one canonical variant instead of three. A listing carrying any of
 * these must never be compared against a base-card baseline.
 */
export interface VariantGroup {
  canonical: string;
  aliases: string[];
}

export const VARIANT_GROUPS: VariantGroup[] = [
  { canonical: 'first-edition', aliases: ['1st edition', 'first edition', '1st ed'] },
  { canonical: 'shadowless', aliases: ['shadowless'] },
  { canonical: 'superfractor', aliases: ['superfractor', 'super fractor'] },
  { canonical: 'xfractor', aliases: ['x-fractor', 'xfractor'] },
  { canonical: 'atomic-refractor', aliases: ['atomic refractor'] },
  { canonical: 'refractor', aliases: ['refractor'] },
  { canonical: 'silver-prizm', aliases: ['silver prizm', 'silver wave', 'base silver prizm'] },
  { canonical: 'prizm', aliases: ['prizm', 'prizms'] },
  { canonical: 'cracked-ice', aliases: ['cracked ice'] },
  { canonical: 'disco-prizm', aliases: ['disco prizm', 'disco'] },
  { canonical: 'hyper-prizm', aliases: ['hyper prizm', 'hyper'] },
  { canonical: 'reverse-holo', aliases: ['reverse holo', 'rev holo', 'reverse holofoil'] },
  { canonical: 'cosmos-holo', aliases: ['cosmos holo'] },
  { canonical: 'poke-ball-holo', aliases: ['poke ball holo', 'pokeball holo'] },
  { canonical: 'master-ball-holo', aliases: ['master ball holo', 'masterball holo', 'master ball'] },
  { canonical: 'holo', aliases: ['holofoil', ' holo '] },
  { canonical: 'special-illustration-rare', aliases: ['special illustration rare', ' sir '] },
  { canonical: 'illustration-rare', aliases: ['illustration rare', ' ir '] },
  { canonical: 'alt-art', aliases: ['alt art', 'alternate art'] },
  { canonical: 'full-art', aliases: ['full art'] },
  { canonical: 'secret-rare', aliases: ['secret rare'] },
  { canonical: 'rainbow-rare', aliases: ['rainbow rare'] },
  { canonical: 'gold-rare', aliases: ['gold rare', 'gold secret'] },
  { canonical: 'hyper-rare', aliases: ['hyper rare'] },
  { canonical: 'ultra-rare', aliases: ['ultra rare'] },
  { canonical: 'shiny-vault', aliases: ['shiny vault'] },
  { canonical: 'autograph', aliases: ['autograph', 'autographed', ' auto ', 'on card auto', 'signed'] },
  { canonical: 'patch-auto', aliases: ['rpa', 'patch auto', 'auto patch'] },
  { canonical: 'relic', aliases: ['patch', 'jersey', 'relic', 'memorabilia', 'game used', 'game worn'] },
  { canonical: 'short-print', aliases: ['short print', ' ssp ', ' sp ', 'case hit'] },
  { canonical: 'downtown', aliases: ['downtown'] },
  { canonical: 'kaboom', aliases: ['kaboom'] },
  { canonical: 'color-match', aliases: ['color match', 'colour match'] },
  { canonical: 'one-of-one', aliases: ['one of one', ' 1/1 ', 'one-of-one'] },
];

/** Flat alias list, kept for callers that only need membership tests. */
export const VARIANT_TERMS: string[] = VARIANT_GROUPS.flatMap((g) => g.aliases);

/** Qualifier words that sit between a grader and its number, e.g. "PSA GEM MT 10". */
export const GRADE_QUALIFIERS = ['gem', 'gem mint', 'gem mt', 'mint', ' mt ', 'pristine', 'black label', 'authentic altered'];

/** Regexes for serial-numbered parallels like /99 or 25/99. */
export const NUMBERED_PATTERNS: RegExp[] = [
  /\b\d{1,4}\s*\/\s*\d{1,4}\b/,
  /\bnumbered\s+to\s+\d{1,4}\b/,
  /\b\/\s*\d{1,4}\b/,
];

/** Rookie-card markers, which change comps dramatically for sports singles. */
export const ROOKIE_TERMS = ['rookie card', ' rookie ', ' rc ', ' rc,', 'first bowman', '1st bowman'];

/**
 * Set vocabulary. `slug` is the canonical key fragment; `aliases` are how the
 * set is written in titles, including set codes and community nicknames.
 * Aliases are matched longest-first, so an alias that is a substring of another
 * ("151" inside "sv151") still resolves correctly.
 */
export interface SetVocabEntry {
  slug: string;
  display: string;
  category: Category;
  brand: string;
  year: number;
  aliases: string[];
  /**
   * The broader line or era this set belongs to, when both names appear in
   * titles. "Mega Evolution: Perfect Order" contains the words "Mega
   * Evolution", so without this the era would win on alias length and the
   * listing would be priced against the wrong SKU.
   */
  parent?: string;
}

/**
 * Set vocabulary, loaded from `catalog/sets.json` at the project root.
 *
 * It lives in JSON rather than in this file so that adding a set — the single
 * most common maintenance task as new products release — is a data edit anyone
 * can make, not a code change. Aliases are lowercased on load so callers can
 * match against a normalized title directly.
 */
export const SET_VOCAB: SetVocabEntry[] = loadSets();

function loadSets(): SetVocabEntry[] {
  const raw = JSON.parse(readFileSync(fromRoot('catalog', 'sets.json'), 'utf8')) as SetVocabEntry[];
  return raw.map((entry) => ({
    ...entry,
    aliases: entry.aliases.map((a) => a.toLowerCase()),
  }));
}

/**
 * Print language. A Japanese booster box and an English one are different
 * products at very different prices, so pooling their asking prices would
 * invent bargains in whichever direction the exchange rate happens to point.
 */
export const LANGUAGE_TERMS: Array<{ code: string; aliases: string[] }> = [
  { code: 'jp', aliases: ['japanese', 'japan import', ' jpn ', ' jp ', 'nihongo'] },
  { code: 'kr', aliases: ['korean', ' kor '] },
  { code: 'zh', aliases: ['chinese', 'simplified chinese', 'traditional chinese'] },
  { code: 'de', aliases: ['german', 'deutsch'] },
  { code: 'fr', aliases: ['french', 'francais'] },
  { code: 'es', aliases: ['spanish', 'espanol'] },
  { code: 'it', aliases: ['italian', 'italiano'] },
];

/**
 * Sealed configurations that share a coarse product type but not a price.
 * These belong in the product key: without them a $239.99 Bowman hobby box and
 * a $499.99 Bowman HTA jumbo pool into one meaningless average.
 */
export const SEALED_VARIANT_TERMS: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'jumbo', aliases: [' hta ', 'hta jumbo', ' jumbo '] },
  { canonical: 'choice', aliases: [' choice '] },
  { canonical: 'collector', aliases: ['collector booster'] },
  { canonical: 'play', aliases: ['play booster'] },
  { canonical: 'no-huddle', aliases: ['no huddle'] },
  { canonical: 'pokemon-center', aliases: ['pokemon center'] },
  { canonical: 'first-off-the-line', aliases: ['first off the line', ' fotl '] },
  { canonical: 'commander', aliases: ['commander deck'] },
];

/** Words removed before fuzzy matching because every seller uses them. */
export const NOISE_WORDS = new Set([
  'new', 'sealed', 'factory', 'brand', 'in', 'hand', 'stock', 'ships', 'ship',
  'shipping', 'fast', 'free', 'same', 'day', 'lot', 'rare', 'hot', 'mint',
  'authentic', 'genuine', 'official', 'usa', 'seller', 'sale', 'deal', 'nwt',
  'the', 'a', 'an', 'and', 'of', 'for', 'with', 'from', 'to', 'card', 'cards',
  'tcg', 'trading', 'game', 'collectible', 'collectibles', 'presale', 'pre',
  'order', 'preorder', 'ready', 'now', 'read', 'look', 'wow', 'l k',
  // Generic hobby and brand nouns. These identify the product line, never the
  // player or character, so stripping them sharpens subject extraction.
  'pokemon', 'ptcg', 'mtg', 'ygo', 'yugioh', 'baseball', 'football', 'basketball',
  'hockey', 'soccer', 'mlb', 'nfl', 'nba', 'nhl', 'topps', 'panini', 'bowman',
  'upper', 'deck', 'leaf', 'donruss', 'chrome', 'prizm', 'optic', 'mosaic',
  'select', 'score', 'contenders', 'heritage', 'stadium', 'club', 'update',
  'series', 'set', 'sets', 'box', 'boxes', 'pack', 'packs', 'etb', 'tin', 'tins',
  'booster', 'blaster', 'hobby', 'retail', 'graded', 'grade', 'gem', 'mt',
  'psa', 'bgs', 'sgc', 'cgc', 'slab', 'slabbed', 'english', 'japanese', 'korean',
  'ships', 'shipped', 'buy', 'best', 'offer', 'condition', 'near', 'excellent',
  'edition', 'ed', 'holo', 'foil', 'insert', 'parallel', 'variation', 'sp',
  'rookie', 'rc', 'invest', 'investment', 'psa10', 'nm', 'lp', 'mp', 'hp',
]);
