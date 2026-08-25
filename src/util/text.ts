/** Small text helpers shared by the parser and the catalog matcher. */

/** Lowercase, strip diacritics, collapse punctuation to spaces, pad with a
 *  leading and trailing space so that whole-word aliases like " etb " match at
 *  the string edges too. */
export function normalizeTitle(raw: string): string {
  const folded = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Keep / # & . and digits: they carry card numbers, serials and set codes.
    .replace(/[^a-z0-9/#&.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ` ${folded} `;
}

/** Turn a display name into a stable key fragment. */
export function slugify(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** True when `needle` occurs in the already-normalized `haystack`.
 *  Aliases that are padded with spaces enforce word boundaries; unpadded
 *  aliases match as substrings, which is what multi-word phrases want. */
export function containsAlias(haystack: string, alias: string): boolean {
  return haystack.includes(alias);
}

/** Find the first alias from `aliases` present in `haystack`, preferring the
 *  longest match so "booster box" wins over "box". */
export function firstAlias(haystack: string, aliases: readonly string[]): string | null {
  let best: string | null = null;
  for (const alias of aliases) {
    if (haystack.includes(alias) && (best === null || alias.length > best.length)) {
      best = alias;
    }
  }
  return best;
}

export function titleCase(raw: string): string {
  return raw.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
