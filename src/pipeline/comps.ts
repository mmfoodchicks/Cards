/**
 * Fetches market values for singles from comp providers.
 *
 * Sealed product has an MSRP; a single card does not, so without this step
 * every single in the feed shows as "not scored" until enough asking prices
 * accumulate to guess at a market value. One provider lookup replaces dozens
 * of noisy observations, so this runs on a slow timer and caches aggressively.
 */

import { getProviderComp, productKeysNeedingComps, saveProviderComp } from '../db/repos.js';
import type { Db } from '../db/index.js';
import { configuredCompProviders } from '../sources/comps/registry.js';
import { sleep } from '../util/rateLimiter.js';
import type { ParsedListing } from '../types.js';
import { logger } from '../util/logger.js';

const log = logger('comps');

/** A quote older than this is refreshed. Card prices move, but not hourly. */
export const COMP_STALE_DAYS = 3;
/** Providers rate-limit to roughly one call per second. */
const DELAY_BETWEEN_LOOKUPS_MS = 1100;

export interface CompRefreshResult {
  attempted: number;
  quoted: number;
  skipped: number;
}

export async function refreshComps(
  maxLookups = 40,
  now: Date = new Date(),
  db?: Db,
): Promise<CompRefreshResult> {
  const providers = configuredCompProviders();
  if (providers.length === 0) return { attempted: 0, quoted: 0, skipped: 0 };

  const stale = new Date(now.getTime() - COMP_STALE_DAYS * 86_400_000).toISOString();
  const targets = productKeysNeedingComps(stale, maxLookups, db);

  const result: CompRefreshResult = { attempted: 0, quoted: 0, skipped: 0 };

  for (const target of targets) {
    let parsed: ParsedListing;
    try {
      parsed = JSON.parse(target.parse_json) as ParsedListing;
    } catch {
      result.skipped++;
      continue;
    }

    const provider = providers.find((p) => p.supports(parsed));
    if (!provider) {
      result.skipped++;
      continue;
    }

    result.attempted++;
    const quote = await provider.quote(parsed);
    if (quote) {
      saveProviderComp(
        {
          productKey: target.product_key,
          provider: quote.provider,
          valueCents: quote.valueCents,
          basis: quote.basis,
          sampleSize: quote.sampleSize,
          detail: quote.detail ?? null,
        },
        db,
      );
      result.quoted++;
    }
    await sleep(DELAY_BETWEEN_LOOKUPS_MS);
  }

  if (result.attempted > 0) {
    log.info(`Comp refresh: ${result.quoted}/${result.attempted} priced (${result.skipped} unsupported).`);
  }
  return result;
}

/** The cached provider quote for a product, if one is fresh enough to use. */
export function cachedComp(productKey: string, now: Date = new Date(), db?: Db) {
  const comp = getProviderComp(productKey, db);
  if (!comp) return null;
  const ageDays = (now.getTime() - Date.parse(comp.fetchedAt)) / 86_400_000;
  // A month-old quote is still far better than nothing, but say so.
  if (ageDays > 30) return null;
  return comp;
}
