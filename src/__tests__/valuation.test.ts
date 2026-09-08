import { describe, expect, it } from 'vitest';
import { TcgCsvSource, rankMatches } from '../valuation/tcgcsv.js';
import { ValuationError } from '../valuation/types.js';

/** A fetch stand-in serving fixtures, so no test touches the network. */
function fakeFetch(routes: Record<string, unknown>, log?: string[]) {
  return async (url: string | URL | Request): Promise<Response> => {
    const path = String(url).replace('https://tcgcsv.com/tcgplayer', '');
    log?.push(path);
    if (!(path in routes)) {
      return new Response('not found', { status: 404 });
    }
    return new Response(JSON.stringify({ results: routes[path] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

const ROUTES = {
  '/categories': [
    { categoryId: 1, name: 'Magic' },
    { categoryId: 3, name: 'Pokemon' },
  ],
  '/3/groups': [
    { groupId: 604, name: 'Base Set', abbreviation: 'BS', publishedOn: '1999-01-09T00:00:00' },
    { groupId: 24831, name: 'Delta Reign', abbreviation: 'DLR', publishedOn: '2026-11-06T00:00:00' },
  ],
  '/3/604/products': [
    { productId: 1, name: 'Charizard', cleanName: 'Charizard', url: 'https://x/charizard',
      extendedData: [{ name: 'Number', displayName: 'Number', value: '4/102' }] },
    { productId: 2, name: 'Charizard & Braixen GX', cleanName: 'Charizard and Braixen GX' },
    { productId: 3, name: 'Blastoise', cleanName: 'Blastoise' },
  ],
  '/3/604/prices': [
    { productId: 1, lowPrice: 260.0, midPrice: 267.99, highPrice: 374.29, marketPrice: 52.46, directLowPrice: null, subTypeName: 'Holofoil' },
    { productId: 1, lowPrice: 0.01, midPrice: 0.05, highPrice: 0.2, marketPrice: 0.08, directLowPrice: null, subTypeName: 'Reverse Holofoil' },
    { productId: 3, lowPrice: null, midPrice: null, highPrice: null, marketPrice: null, directLowPrice: null, subTypeName: 'Normal' },
  ],
};

const source = (log?: string[], now?: () => number) =>
  new TcgCsvSource({
    fetchImpl: fakeFetch(ROUTES, log) as unknown as typeof fetch,
    now,
    // No real delay in tests; the spacing behaviour is asserted separately.
    sleep: async () => {},
  });

describe('TCGCSV valuation source', () => {
  it('lists categories and sets, newest set first', async () => {
    const s = source();
    expect(await s.categories()).toEqual([
      { id: '1', name: 'Magic' },
      { id: '3', name: 'Pokemon' },
    ]);
    const groups = await s.groups('3');
    // A card someone just pulled is far likelier to be from a recent set.
    expect(groups[0]!.name).toBe('Delta Reign');
    expect(groups[0]!.releasedOn).toBe('2026-11-06');
  });

  it('refuses to guess a card from free text alone', async () => {
    // The failure mode that sank the previous version of this app.
    await expect(source().search({ query: 'Charizard' })).rejects.toBeInstanceOf(ValuationError);
    await expect(source().search({ query: 'Charizard', category: '3' })).rejects.toThrow(/pick a game and a set/i);
  });

  it('converts dollars to cents exactly, never by multiplying a float', async () => {
    const result = await source().search({ query: 'Charizard', category: '3', group: '604' });
    const holo = result.candidates.find((c) => c.variant === 'Holofoil')!;
    const market = holo.quotes.find((q) => q.fieldName === 'marketPrice')!;
    // 52.46 * 100 in binary floating point is 5245.999...; this must be 5246.
    expect(market.valueCents).toBe(5246);
    expect(Number.isInteger(market.valueCents)).toBe(true);
  });

  it('stamps every quote as RAW and never implies a graded value', async () => {
    const result = await source().search({ query: 'Charizard', category: '3', group: '604' });
    for (const q of result.candidates.flatMap((c) => c.quotes)) {
      expect(q.basis).toBe('raw-market');
      expect(q.caveats.join(' ')).toMatch(/raw, ungraded/i);
    }
    expect(result.notes.join(' ')).toMatch(/not the value of a graded card/i);
  });

  it('reports the low listing separately from market, so the spread is visible', async () => {
    const result = await source().search({ query: 'Charizard', category: '3', group: '604' });
    const holo = result.candidates.find((c) => c.variant === 'Holofoil')!;
    const fields = holo.quotes.map((q) => q.fieldName);
    expect(fields).toContain('marketPrice');
    expect(fields).toContain('lowPrice');
    const low = holo.quotes.find((q) => q.fieldName === 'lowPrice')!;
    expect(low.valueCents).toBe(26000);
    expect(low.caveats.join(' ')).toMatch(/floor, not a valuation/i);
  });

  it('prefers the exact card over one that merely contains its name', async () => {
    const result = await source().search({ query: 'Charizard', category: '3', group: '604' });
    // "Charizard & Braixen GX" is a different card and must not win.
    expect(result.candidates[0]!.matchedName).toBe('Charizard');
    expect(result.candidates[0]!.number).toBe('4/102');
  });

  it('keeps each printing separate, never merging holo with reverse holo', () => {
    // A reverse holo and its base printing are different cards at different
    // prices. Collapsing them into one row with four unlabelled numbers is a
    // smaller version of confusing raw with graded.
    return source().search({ query: 'Charizard', category: '3', group: '604' }).then((result) => {
      const charizards = result.candidates.filter((c) => c.matchedName === 'Charizard');
      expect(charizards).toHaveLength(2);
      expect(charizards.map((c) => c.variant).sort()).toEqual(['Holofoil', 'Reverse Holofoil']);

      const holo = charizards.find((c) => c.variant === 'Holofoil')!;
      const reverse = charizards.find((c) => c.variant === 'Reverse Holofoil')!;
      expect(holo.quotes.find((q) => q.fieldName === 'marketPrice')!.valueCents).toBe(5246);
      expect(reverse.quotes.find((q) => q.fieldName === 'marketPrice')!.valueCents).toBe(8);

      // Every quote names its own printing, so a value can never be attached to
      // the wrong one downstream.
      for (const c of charizards) {
        for (const q of c.quotes) expect(q.variant).toBe(c.variant);
      }
      // The ids differ, so storing a choice records WHICH printing was picked.
      expect(holo.matchedId).not.toBe(reverse.matchedId);
    });
  });

  it('rounds sub-cent-adjacent prices correctly', () => {
    return source().search({ query: 'Charizard', category: '3', group: '604' }).then((result) => {
      const reverse = result.candidates.find((c) => c.variant === 'Reverse Holofoil')!;
      // 0.01 * 100 is 1.0000000000000002 in binary floating point.
      expect(reverse.quotes.find((q) => q.fieldName === 'lowPrice')!.valueCents).toBe(1);
    });
  });

  it('says so plainly when nothing matches, rather than returning a wrong card', async () => {
    const result = await source().search({ query: 'Pikachu', category: '3', group: '604' });
    expect(result.candidates).toEqual([]);
    expect(result.searched).toBe(true);
    expect(result.notes.join(' ')).toMatch(/nothing in this set matched/i);
  });

  it('reports a matched card that simply has no price', async () => {
    const result = await source().search({ query: 'Blastoise', category: '3', group: '604' });
    expect(result.candidates[0]!.matchedName).toBe('Blastoise');
    expect(result.candidates[0]!.quotes).toEqual([]);
    expect(result.notes.join(' ')).toMatch(/carries no price/i);
  });

  it('caches, so repeat lookups do not re-fetch', async () => {
    const log: string[] = [];
    const s = source(log);
    await s.search({ query: 'Charizard', category: '3', group: '604' });
    await s.search({ query: 'Blastoise', category: '3', group: '604' });
    expect(log.filter((p) => p === '/3/604/prices')).toHaveLength(1);
  });

  it('holds prices for a full day, which is the cadence TCGCSV asks for', async () => {
    const log: string[] = [];
    let clock = 1_000_000;
    const s = source(log, () => clock);
    await s.search({ query: 'Charizard', category: '3', group: '604' });

    // TCGCSV rebuilds once a day and asks callers to pull no more often, so
    // half a day later there is still nothing new to fetch.
    clock += 12 * 60 * 60 * 1000;
    await s.search({ query: 'Charizard', category: '3', group: '604' });
    expect(log.filter((p) => p === '/3/604/prices')).toHaveLength(1);

    clock += 13 * 60 * 60 * 1000; // now past 24 hours in total
    await s.search({ query: 'Charizard', category: '3', group: '604' });
    expect(log.filter((p) => p === '/3/604/prices')).toHaveLength(2);
  });

  it('identifies the application, because TCGCSV blocks clients that do not', async () => {
    // Found by calling the real service: an unidentified client gets a 401.
    const seen: Array<Record<string, string>> = [];
    const s = new TcgCsvSource({
      sleep: async () => {},
      fetchImpl: (async (_u: unknown, init: RequestInit) => {
        seen.push(init.headers as Record<string, string>);
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await s.categories();
    expect(seen[0]!['user-agent']).toMatch(/^CardLedger\/\d+\.\d+\.\d+$/);
  });

  it('lets a fork identify itself instead of impersonating CardLedger', async () => {
    const seen: Array<Record<string, string>> = [];
    const s = new TcgCsvSource({
      userAgent: 'MyFork/2.0.0',
      sleep: async () => {},
      fetchImpl: (async (_u: unknown, init: RequestInit) => {
        seen.push(init.headers as Record<string, string>);
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await s.categories();
    expect(seen[0]!['user-agent']).toBe('MyFork/2.0.0');
  });

  it('spaces requests apart rather than firing them together', async () => {
    const slept: number[] = [];
    let clock = 0;
    const s = new TcgCsvSource({
      now: () => clock,
      sleep: async (ms) => { slept.push(ms); clock += ms; },
      fetchImpl: (async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as unknown as typeof fetch,
    });
    // Two concurrent lookups must still be spaced; serialising is the only way,
    // since a bare delay would let Promise.all fire both at once.
    await Promise.all([s.groups('3'), s.groups('1')]);
    expect(slept.length).toBeGreaterThanOrEqual(1);
    expect(slept[0]).toBeGreaterThan(0);
  });

  it('explains a 401 as an identification problem, not an auth failure', async () => {
    const s = new TcgCsvSource({
      sleep: async () => {},
      fetchImpl: (async () => new Response('blocked', { status: 401 })) as unknown as typeof fetch,
    });
    await expect(s.categories()).rejects.toThrow(/did not recognise the application/i);
  });

  it('explains throttling without telling the user to retry immediately', async () => {
    const s = new TcgCsvSource({
      sleep: async () => {},
      fetchImpl: (async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch,
    });
    await expect(s.categories()).rejects.toThrow(/rebuilds once a day.*wait ten minutes/is);
  });

  it('keeps working after a failed request rather than wedging the queue', async () => {
    let n = 0;
    const s = new TcgCsvSource({
      sleep: async () => {},
      fetchImpl: (async () => {
        n += 1;
        return n === 1
          ? new Response('boom', { status: 500 })
          : new Response(JSON.stringify({ results: [{ categoryId: 3, name: 'Pokemon' }] }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await expect(s.categories()).rejects.toThrow(/returned 500/);
    expect(await s.categories()).toEqual([{ id: '3', name: 'Pokemon' }]);
  });

  it('turns a network failure into an explanation, not a stack trace', async () => {
    const s = new TcgCsvSource({
      fetchImpl: (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch,
    });
    await expect(s.categories()).rejects.toThrow(/works entirely offline apart from price lookups/i);
  });

  it('surfaces an HTTP error with its status', async () => {
    const s = source();
    await expect(s.search({ query: 'x', category: '99', group: '1' })).rejects.toThrow(/returned 404/i);
  });
});

describe('matching within a set', () => {
  const products = [
    { productId: 1, name: 'Charizard', cleanName: 'Charizard' },
    { productId: 2, name: 'Charizard EX', cleanName: 'Charizard EX' },
    { productId: 3, name: 'Dark Charizard', cleanName: 'Dark Charizard' },
    { productId: 4, name: 'Blastoise', cleanName: 'Blastoise' },
  ];

  it('ranks exact match first', () => {
    expect(rankMatches(products, 'Charizard', 5)[0]!.name).toBe('Charizard');
  });

  it('still surfaces near misses so a wrong match is visible', () => {
    const names = rankMatches(products, 'Charizard', 5).map((p) => p.name);
    expect(names).toContain('Charizard EX');
    expect(names).toContain('Dark Charizard');
    expect(names).not.toContain('Blastoise');
  });

  it('ignores punctuation and case', () => {
    expect(rankMatches(products, '  CHARIZARD-ex ', 5)[0]!.name).toBe('Charizard EX');
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(rankMatches(products, '   ', 5)).toEqual([]);
  });

  it('respects the limit', () => {
    expect(rankMatches(products, 'charizard', 2)).toHaveLength(2);
  });
});
