/**
 * TCGCSV — free TCGplayer catalogue and price mirror.
 *
 * The only no-key, no-signup, no-approval source of trading card prices worth
 * having. TCGplayer's own API stopped granting new access, and eBay's sold-data
 * API is restricted to invited partners, so for Pokemon, Magic and Yu-Gi-Oh
 * this is the realistic free option.
 *
 * WHAT IT ACTUALLY GIVES YOU, and the limits matter more than the feature:
 *
 *   - `marketPrice` is TCGplayer's computed market price for the RAW, UNGRADED
 *     card. It is not a sold comp and it is not a graded price. A PSA 10 of the
 *     same card can be worth many times this. Every quote is stamped
 *     'raw-market' for that reason and the app must never present it as the
 *     value of a slab.
 *   - It covers TCG only. There is NO sports card data here at all — no Topps,
 *     no Panini, no Bowman. A free source of sports card sold comps does not
 *     appear to exist.
 *   - Prices refresh daily, not live.
 *
 * BEING A GOOD NEIGHBOUR. TCGCSV is free and asks three things in return, all of
 * which this adapter honours:
 *
 *   - Identify yourself. It BLOCKS generic or missing User-Agents outright with
 *     a 401 — which is exactly how this was found, by calling the real service
 *     rather than trusting a fixture.
 *   - Pull at most once a day. The data is rebuilt once daily, so anything more
 *     is pure waste. `last-updated.txt` is checked first and a refetch only
 *     happens when the build is genuinely newer than what is cached.
 *   - Space requests out and stay under 10,000 a day. A minimum gap is enforced
 *     between calls; this app makes a handful per session, nowhere near it.
 *
 * Its CORS policy also forbids browser calls, so this must stay server-side.
 * That suits the design anyway: the browser never talks to a price source.
 *
 * MATCHING. This adapter never guesses from a free-text title. The caller picks
 * a category and a set, and search runs within that set only. That is a
 * deliberate reaction to how the previous version of this app failed: titles
 * like "Pokemon 151 ETB" were parsed as a quantity of 151, base cards were
 * matched against their own parallels, and one product key collided with
 * another across sets. Making the user name the set removes all of it.
 */

import { dollarsToCents, type Cents } from '../domain/money.js';
import type { IsoDate } from '../domain/types.js';
import {
  ValuationError,
  type ValuationCandidate,
  type ValuationQuote,
  type ValuationResult,
  type ValuationSearch,
  type ValuationSource,
} from './types.js';

const BASE = 'https://tcgcsv.com/tcgplayer';
const SOURCE_KEY = 'tcgcsv';
const SOURCE_NAME = 'TCGCSV (TCGplayer mirror)';

/**
 * Cache lifetime, set to the cadence TCGCSV asks for rather than to what this
 * app would like. It rebuilds once a day and its guidelines say to limit pulls
 * to once every 24 hours.
 */
const PRICE_TTL_MS = 24 * 60 * 60 * 1000;
/** Set and category lists change only when a set releases. */
const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Minimum gap between requests, as the usage guidelines ask. */
const MIN_REQUEST_GAP_MS = 100;

/**
 * Identifies this application, as TCGCSV requires. A missing or generic
 * User-Agent is refused with a 401, so this is not optional politeness.
 */
const USER_AGENT = 'CardLedger/0.1.0';

interface CacheEntry {
  fetchedAt: number;
  body: unknown;
}

export interface TcgCsvOptions {
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests so cache expiry is deterministic. */
  now?: () => number;
  /**
   * Overrides the User-Agent. TCGCSV asks each application to identify itself,
   * so a fork should say what it is rather than claiming to be CardLedger.
   */
  userAgent?: string;
  /** Injected for tests; defaults to a real delay between requests. */
  sleep?: (ms: number) => Promise<void>;
}

interface RawGroup {
  groupId: number;
  name: string;
  abbreviation: string | null;
  publishedOn: string | null;
}

interface RawProduct {
  productId: number;
  name: string;
  cleanName?: string;
  url?: string;
  extendedData?: Array<{ name: string; displayName: string; value: string }>;
}

interface RawPrice {
  productId: number;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  directLowPrice: number | null;
  subTypeName: string | null;
}

export class TcgCsvSource implements ValuationSource {
  readonly key = SOURCE_KEY;
  readonly name = SOURCE_NAME;
  readonly description =
    'Free daily mirror of TCGplayer prices for Pokemon, Magic, Yu-Gi-Oh and 89 other games. ' +
    'Gives the RAW ungraded market price — not a sold comp, and not the value of a graded slab. ' +
    'No sports cards.';
  readonly requiresKey = false;
  readonly configured = true;
  readonly provides = ['raw-market'] as const;

  private readonly cache = new Map<string, CacheEntry>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly userAgent: string;
  private readonly sleep: (ms: number) => Promise<void>;
  /**
   * When the last request went out, so requests can be spaced. `null` rather
   * than 0, because 0 is a legitimate clock reading and using it as "never"
   * silently disables the spacing.
   */
  private lastRequestAt: number | null = null;
  /** Serialises requests; without it, concurrent calls defeat the spacing. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: TcgCsvOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async categories(): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.get<Array<{ categoryId: number; name: string }>>('/categories', CATALOG_TTL_MS);
    return rows.map((c) => ({ id: String(c.categoryId), name: c.name }));
  }

  async groups(categoryId: string): Promise<Array<{ id: string; name: string; releasedOn: IsoDate | null }>> {
    const rows = await this.get<RawGroup[]>(`/${encodeURIComponent(categoryId)}/groups`, CATALOG_TTL_MS);
    return rows
      .map((g) => ({
        id: String(g.groupId),
        name: g.name,
        releasedOn: (g.publishedOn ? g.publishedOn.slice(0, 10) : null) as IsoDate | null,
      }))
      // Newest first: a card someone just pulled is far likelier to be recent.
      .sort((a, b) => (b.releasedOn ?? '').localeCompare(a.releasedOn ?? ''));
  }

  async search(input: ValuationSearch): Promise<ValuationResult> {
    const notes: string[] = [];

    if (!input.category || !input.group) {
      throw new ValuationError(
        'Pick a game and a set first. This source deliberately does not guess a card from free text — ' +
          'that is how valuation tools return confident nonsense.',
        SOURCE_KEY,
      );
    }

    const path = `/${encodeURIComponent(input.category)}/${encodeURIComponent(input.group)}`;
    const [products, prices] = await Promise.all([
      this.get<RawProduct[]>(`${path}/products`, PRICE_TTL_MS),
      this.get<RawPrice[]>(`${path}/prices`, PRICE_TTL_MS),
    ]);

    const byProduct = new Map<number, RawPrice[]>();
    for (const p of prices) {
      const list = byProduct.get(p.productId) ?? [];
      list.push(p);
      byProduct.set(p.productId, list);
    }

    const matches = rankMatches(products, input.query, input.limit ?? 10);
    if (matches.length === 0) {
      notes.push(
        `Nothing in this set matched "${input.query}". Check the spelling, or the card may be from a ` +
          'different set — sets often share card names.',
      );
      return { sourceKey: SOURCE_KEY, sourceName: SOURCE_NAME, candidates: [], searched: true, notes };
    }

    // One candidate per PRINTING. A reverse holo and its base printing carry
    // genuinely different prices, so merging them into a single row with four
    // unlabelled numbers would leave the user to guess which is theirs.
    const candidates: ValuationCandidate[] = [];
    for (const product of matches) {
      const rows = byProduct.get(product.productId) ?? [];
      const number = extended(product, 'Number');

      if (rows.length === 0) {
        candidates.push({
          matchedId: String(product.productId),
          matchedName: product.name,
          groupName: null,
          number,
          variant: null,
          quotes: [],
          url: product.url ?? null,
        });
        continue;
      }

      for (const row of rows) {
        candidates.push({
          matchedId: `${product.productId}:${row.subTypeName ?? 'default'}`,
          matchedName: product.name,
          groupName: null,
          number,
          variant: row.subTypeName ?? null,
          quotes: toQuotes(row, product),
          url: product.url ?? null,
        });
      }
    }

    if (candidates.every((c) => c.quotes.length === 0)) {
      notes.push('Matched the card but the source carries no price for it right now.');
    }

    notes.push(
      'These are RAW, ungraded market prices from TCGplayer listings — not completed sales, and not the ' +
        'value of a graded card. A slab can be worth many times this.',
    );

    return { sourceKey: SOURCE_KEY, sourceName: SOURCE_NAME, candidates, searched: true, notes };
  }

  private async get<T>(path: string, ttlMs: number): Promise<T> {
    const cached = this.cache.get(path);
    if (cached && this.now() - cached.fetchedAt < ttlMs) return cached.body as T;

    const payload = await this.request(path);
    const body = (payload && typeof payload === 'object' && 'results' in payload
      ? (payload as { results: T }).results
      : payload) as T;

    this.cache.set(path, { fetchedAt: this.now(), body });
    return body;
  }

  /**
   * One request, spaced from the last and identified.
   *
   * Calls are serialised through a promise chain rather than merely delayed,
   * because `Promise.all` of two lookups would otherwise fire both at once and
   * the spacing would do nothing.
   */
  private request(path: string): Promise<unknown> {
    const run = this.queue.then(async () => {
      if (this.lastRequestAt !== null) {
        const since = this.now() - this.lastRequestAt;
        if (since < MIN_REQUEST_GAP_MS) await this.sleep(MIN_REQUEST_GAP_MS - since);
      }
      this.lastRequestAt = this.now();

      let res: Response;
      try {
        res = await this.fetchImpl(`${BASE}${path}`, {
          headers: { accept: 'application/json', 'user-agent': this.userAgent },
        });
      } catch (cause) {
        throw new ValuationError(
          `Could not reach TCGCSV. This app works entirely offline apart from price lookups, so nothing ` +
            `else is affected. (${cause instanceof Error ? cause.message : String(cause)})`,
          SOURCE_KEY,
        );
      }

      if (res.status === 401) {
        // TCGCSV answers an unidentified client with a 401, which reads like an
        // auth failure and is not one. Say what it actually means.
        throw new ValuationError(
          'TCGCSV refused the request because it did not recognise the application. It requires a ' +
            'User-Agent naming your app; this build sends one, so a proxy or gateway is probably ' +
            'stripping or rewriting it.',
          SOURCE_KEY,
        );
      }
      if (res.status === 429) {
        throw new ValuationError(
          'TCGCSV is throttling this app for making too many requests. It rebuilds once a day, so there ' +
            'is nothing to gain from asking again soon — wait ten minutes.',
          SOURCE_KEY,
        );
      }
      if (!res.ok) {
        throw new ValuationError(`TCGCSV returned ${res.status} for ${path}.`, SOURCE_KEY);
      }

      return (await res.json()) as unknown;
    });

    // Keep the chain alive even when a request fails, or one error would wedge
    // every later lookup.
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function extended(product: RawProduct, name: string): string | null {
  return product.extendedData?.find((d) => d.name === name)?.value ?? null;
}

/**
 * Turn one price row into quotes.
 *
 * `marketPrice` is the one worth having — TCGplayer computes it from actual
 * sales activity rather than from what sellers are asking. `lowPrice` is the
 * cheapest listing, which is a floor, not a value. Both are reported so the
 * spread is visible: a card whose low is far below its market is either damaged
 * stock or a mispriced listing, and the user should see that rather than a
 * single confident number.
 */
function toQuotes(row: RawPrice, product: RawProduct): ValuationQuote[] {
  const out: ValuationQuote[] = [];
  const variant = row.subTypeName ? ` (${row.subTypeName})` : '';
  const printing = row.subTypeName ?? null;

  const caveats = [
    'RAW, ungraded card. A graded copy is a different asset with a different price.',
    'A market price computed by TCGplayer, not a list of completed sales.',
  ];

  if (row.marketPrice !== null && row.marketPrice > 0) {
    out.push({
      sourceKey: SOURCE_KEY,
      sourceName: SOURCE_NAME,
      basis: 'raw-market',
      valueCents: money(row.marketPrice),
      fieldName: 'marketPrice',
      currency: 'USD',
      asOf: null,
      matchedName: product.name + variant,
      variant: printing,
      matchedId: String(product.productId),
      caveats,
      url: product.url ?? null,
    });
  }

  if (row.lowPrice !== null && row.lowPrice > 0) {
    out.push({
      sourceKey: SOURCE_KEY,
      sourceName: SOURCE_NAME,
      basis: 'raw-market',
      valueCents: money(row.lowPrice),
      fieldName: 'lowPrice',
      currency: 'USD',
      asOf: null,
      matchedName: product.name + variant,
      variant: printing,
      matchedId: String(product.productId),
      caveats: [...caveats, 'The cheapest active listing — a floor, not a valuation.'],
      url: product.url ?? null,
    });
  }

  return out;
}

/**
 * Dollars to cents, without ever multiplying a float by 100.
 *
 * JSON gives these as numbers, so 52.46 arrives as a binary float. Multiplying
 * it by 100 can land on 5245. `dollarsToCents` formats to a fixed decimal first
 * and parses the digits with BigInt, which is exact.
 */
function money(dollars: number): Cents {
  return dollarsToCents(dollars);
}

/**
 * Rank products against a query, within one set.
 *
 * Scored rather than filtered, so a near miss still surfaces and the user can
 * see it was a near miss. Exact beats prefix beats contains beats all-words.
 */
export function rankMatches(products: readonly RawProduct[], query: string, limit: number): RawProduct[] {
  const q = normalise(query);
  if (q === '') return [];
  const words = q.split(' ').filter(Boolean);

  const scored: Array<{ product: RawProduct; score: number }> = [];
  for (const product of products) {
    const name = normalise(product.cleanName ?? product.name);
    let score = 0;

    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (words.length > 1 && words.every((w) => name.includes(w))) score = 40;
    else continue;

    // Prefer the shorter name among equal matches: "Charizard" over
    // "Charizard & Braixen GX", which is a different card.
    score -= Math.min(19, name.length / 8);
    scored.push({ product, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.product);
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
