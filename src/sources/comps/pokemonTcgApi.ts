/**
 * pokemontcg.io — free Pokemon card prices.
 *
 * The most useful free comp source available: no account is required, and it
 * returns TCGplayer market/low/mid/high prices with a timestamp. It prices RAW
 * singles. Graded slabs trade at a large, grade-dependent premium that this
 * source does not model, so a graded listing is deliberately left unpriced
 * rather than priced wrongly.
 */

import { config } from '../../config.js';
import type { ParsedListing } from '../../types.js';
import { logger } from '../../util/logger.js';
import { sleep } from '../../util/rateLimiter.js';
import type { CompProvider, CompQuote } from './types.js';

const log = logger('pokemontcg');
const BASE = 'https://api.pokemontcg.io/v2';

interface PokemonCard {
  id: string;
  name: string;
  number?: string;
  set?: { id?: string; name?: string; releaseDate?: string };
  tcgplayer?: {
    url?: string;
    updatedAt?: string;
    prices?: Record<string, { low?: number; mid?: number; high?: number; market?: number; directLow?: number }>;
  };
  cardmarket?: { prices?: { trendPrice?: number; averageSellPrice?: number }; updatedAt?: string };
}

export class PokemonTcgApiProvider implements CompProvider {
  readonly id = 'pokemontcg';
  readonly displayName = 'pokemontcg.io (TCGplayer prices)';

  isConfigured(): boolean {
    // Works with no key at all; a free key only raises the rate limit.
    return true;
  }

  unavailableReason(): string | null {
    return null;
  }

  supports(parsed: ParsedListing): boolean {
    if (parsed.category !== 'pokemon') return false;
    if (parsed.sealed) return false;
    // Grade drives most of a slab's value and this source does not model it.
    if (parsed.graded) return false;
    return parsed.subject !== null || parsed.cardNumber !== null;
  }

  async quote(parsed: ParsedListing): Promise<CompQuote | null> {
    if (!this.supports(parsed)) return null;

    // Name plus card number identifies a card almost uniquely. The set name is
    // deliberately NOT part of the query: this API names sets differently from
    // the way sellers write them ("151" versus "Scarlet & Violet 151"), so
    // filtering on it server-side loses real matches. It is used afterwards to
    // choose between results instead.
    const clauses: string[] = [];
    if (parsed.subject) clauses.push(`name:"${escapeQuery(parsed.subject)}*"`);
    const number = parsed.cardNumber?.split('/')[0]?.replace(/\D/g, '');
    if (number) clauses.push(`number:${number}`);
    if (clauses.length === 0) return null;

    const params = new URLSearchParams({ q: clauses.join(' '), pageSize: '25' });
    const body = await this.fetchWithRetry(`${BASE}/cards?${params.toString()}`);
    if (!body) return null;

    const card = pickBestCard(body.data ?? [], parsed);
    if (!card) return null;

    const priced = pickVariantPrice(card, parsed.variants);
    if (priced === null) return null;

    return {
      valueCents: Math.round(priced.value * 100),
      basis: `TCGplayer ${humanizeVariant(priced.variant)} market price`,
      sampleSize: null,
      provider: this.id,
      detail: {
        cardId: card.id,
        cardName: card.name,
        setName: card.set?.name,
        updatedAt: card.tcgplayer?.updatedAt,
        url: card.tcgplayer?.url,
      },
    };
  }

  /**
   * This API returns intermittent 500s and 502s on queries that succeed on the
   * next attempt, so a single failure means nothing. Retries are short and
   * bounded: a missing comp is not worth stalling the pipeline over.
   */
  private async fetchWithRetry(url: string, attempts = 3): Promise<{ data?: PokemonCard[] } | null> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (config.pokemonTcgApiKey) headers['X-Api-Key'] = config.pokemonTcgApiKey;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const res = await fetch(url, { headers });
        if (res.ok) return (await res.json()) as { data?: PokemonCard[] };
        if (res.status === 429) {
          log.warn('pokemontcg.io rate limit reached; set POKEMONTCG_API_KEY to raise it.');
          return null;
        }
        if (res.status < 500) {
          log.warn(`pokemontcg.io returned HTTP ${res.status}`);
          return null;
        }
      } catch (err) {
        log.debug('pokemontcg.io request failed', err instanceof Error ? err.message : String(err));
      }
      if (attempt < attempts - 1) await sleep(400 * 2 ** attempt);
    }
    log.warn('pokemontcg.io unavailable after retries.');
    return null;
  }
}

/**
 * Choose between cards sharing a name and number.
 *
 * Set names differ between this API and the way sellers type them, so matching
 * is fuzzy in both directions: "151" is contained in "Scarlet & Violet 151",
 * and a listing saying "Evolving Skies" should match the set of that name. A
 * card whose set cannot be matched is still usable when it is the only result.
 */
function pickBestCard(cards: readonly PokemonCard[], parsed: ParsedListing): PokemonCard | null {
  if (cards.length === 0) return null;
  if (!parsed.setName) return cards[0]!;

  const wanted = normalizeSetName(parsed.setName);
  const exact = cards.find((c) => {
    const got = normalizeSetName(c.set?.name ?? '');
    return got.length > 0 && (got === wanted || got.includes(wanted) || wanted.includes(got));
  });
  if (exact) return exact;

  // No set matched. Trust a single unambiguous result; refuse to guess between
  // several cards that might be from quite different sets and prices.
  return cards.length === 1 ? cards[0]! : null;
}

function normalizeSetName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(scarlet|violet|sword|shield|and)\b/g, '').replace(/\s+/g, ' ').trim();
}

function humanizeVariant(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^\w/, (c) => c.toLowerCase()).trim();
}

/**
 * TCGplayer prices a card once per printing variant. A reverse holo and a
 * normal copy of the same card can differ severalfold, so the variant the
 * listing describes has to select the matching price bucket.
 */
function pickVariantPrice(
  card: PokemonCard,
  variants: readonly string[],
): { value: number; variant: string } | null {
  const prices = card.tcgplayer?.prices;
  if (!prices) return null;

  const preferred: string[] = [];
  if (variants.includes('reverse-holo')) preferred.push('reverseHolofoil');
  if (variants.includes('holo')) preferred.push('holofoil');
  if (variants.includes('first-edition')) preferred.push('1stEditionHolofoil', '1stEdition');
  preferred.push('normal', 'holofoil', 'reverseHolofoil', 'unlimitedHolofoil');

  for (const key of preferred) {
    const bucket = prices[key];
    const market = bucket?.market ?? bucket?.mid;
    if (typeof market === 'number' && market > 0) return { value: market, variant: key };
  }
  return null;
}

/** Strips characters that are operators in the provider's query syntax. */
function escapeQuery(value: string): string {
  return value.replace(/["\\:()[\]{}^~*?]/g, ' ').trim();
}
