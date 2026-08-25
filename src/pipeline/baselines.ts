/**
 * Baseline maintenance.
 *
 * Two jobs run here on a timer:
 *
 *  1. Recompute market values from the observation log.
 *  2. Detect listings that vanished. A fixed-price listing that stops appearing
 *     while its end date is still in the future has almost certainly sold, and
 *     that inference is the only completed-sale signal available without a
 *     restricted API — so it is recorded as its own weaker observation kind.
 */

import { computeBaseline } from '../pricing/baseline.js';
import {
  findVanishedListings,
  markGone,
  observationsFor,
  productKeysWithObservations,
  purgeOldListings,
  recordObservation,
  saveBaseline,
} from '../db/repos.js';
import type { Db } from '../db/index.js';
import { logger } from '../util/logger.js';

const log = logger('baselines');

/** Observations older than this are ignored when rebuilding baselines. */
export const BASELINE_WINDOW_DAYS = 45;

/**
 * How long a listing must be missing before we call it gone.
 *
 * Too short and normal churn in search results (a listing sliding off the page
 * we happened to fetch) is mistaken for a sale. Too long and the signal arrives
 * after it is useful. A day is comfortably longer than any reasonable poll
 * interval while still being same-week information.
 */
export const VANISHED_AFTER_HOURS = 26;

export function rebuildBaselines(now: Date = new Date(), db?: Db): { rebuilt: number; skipped: number } {
  const since = new Date(now.getTime() - BASELINE_WINDOW_DAYS * 86_400_000).toISOString();
  const keys = productKeysWithObservations(since, db);

  let rebuilt = 0;
  let skipped = 0;
  for (const key of keys) {
    const observations = observationsFor(key, since, db);
    const baseline = computeBaseline({ productKey: key, observations, now });
    if (baseline) {
      saveBaseline(baseline, db);
      rebuilt++;
    } else {
      // Not enough evidence. Leaving the previous baseline in place would be
      // worse than having none, but so would deleting a still-valid one, so
      // stale baselines simply age out via their own freshness penalty.
      skipped++;
    }
  }

  log.info(`Rebuilt ${rebuilt} baselines (${skipped} lacked enough data).`);
  return { rebuilt, skipped };
}

export interface VanishSweepResult {
  markedGone: number;
  inferredSales: number;
}

/**
 * Mark listings we have stopped seeing, and infer a sale where that is the
 * likely explanation.
 *
 * A listing whose scheduled end date has already passed simply expired, and an
 * auction that ended with no bids did not sell — neither is evidence of a
 * price, so neither produces an observation.
 */
export function sweepVanishedListings(now: Date = new Date(), db?: Db): VanishSweepResult {
  const staleBefore = new Date(now.getTime() - VANISHED_AFTER_HOURS * 3_600_000).toISOString();
  const vanished = findVanishedListings(staleBefore, db);

  let inferredSales = 0;
  for (const row of vanished) {
    markGone(row.id, now.toISOString(), db);

    const endedNaturally = row.ends_at !== null && Date.parse(row.ends_at) <= Date.parse(row.last_seen_at);
    if (endedNaturally || !row.product_key) continue;

    recordObservation(
      {
        productKey: row.product_key,
        // Date it to when we last saw it, not to now: that is when the sale
        // actually happened, and baselines weight by age.
        observedAt: row.last_seen_at,
        unitCents: row.unit_cents,
        kind: 'sold-inferred',
        source: row.source,
        listingId: row.id,
      },
      db,
    );
    inferredSales++;
  }

  if (vanished.length > 0) {
    log.info(`${vanished.length} listings disappeared; ${inferredSales} look like sales.`);
  }
  return { markedGone: vanished.length, inferredSales };
}

/**
 * Data retention.
 *
 * eBay's API License Agreement allows only "limited intermediate copies" of
 * their data, to be deleted when no longer needed, so cached listing rows
 * expire. Our own derived price observations are kept: they are measurements
 * we made, not a copy of anyone's catalog, and they are what lets market
 * baselines keep improving without hoarding third-party data.
 */
export const LISTING_RETENTION_DAYS = 30;

export function purgeExpiredListings(now: Date = new Date(), db?: Db): number {
  const cutoff = new Date(now.getTime() - LISTING_RETENTION_DAYS * 86_400_000).toISOString();
  const removed = purgeOldListings(cutoff, db);
  if (removed > 0) log.info(`Purged ${removed} cached listings older than ${LISTING_RETENTION_DAYS} days.`);
  return removed;
}
