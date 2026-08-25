/**
 * Background scheduler.
 *
 * Deliberately a plain interval rather than a cron library: the only schedule
 * this app needs is "run each watch every N minutes", and each watch tracks its
 * own last-run time in the database, so the schedule survives a restart without
 * any additional state.
 */

import { config } from '../config.js';
import { dueWatches } from '../db/repos.js';
import { deliverPendingAlerts } from '../notify/index.js';
import { logger } from '../util/logger.js';
import { rebuildBaselines, purgeExpiredListings, sweepVanishedListings } from './baselines.js';
import { refreshComps } from './comps.js';
import { runWatch } from './scanner.js';

const log = logger('scheduler');

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastMaintenanceMs = 0;

/** Baselines and the vanished-listing sweep run hourly, not every tick. */
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

export function startScheduler(): void {
  if (timer) return;
  if (!config.scheduler.enabled) {
    log.info('Scheduler disabled (SCHEDULER_ENABLED=false). Scans run on demand only.');
    return;
  }
  log.info(`Scheduler started, ticking every ${config.scheduler.tickSeconds}s.`);
  timer = setInterval(() => {
    void tick();
  }, config.scheduler.tickSeconds * 1000);
  // Do not hold the process open purely for the timer.
  timer.unref?.();
  void tick();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function tick(now: Date = new Date()): Promise<void> {
  // Overlapping ticks would double-charge the API quota for the same watches.
  if (running) return;
  running = true;
  try {
    const due = dueWatches(now);
    for (const watch of due) {
      log.info(`Running watch "${watch.name}".`);
      const result = await runWatch(watch);
      if (result.errors.length > 0) log.warn(`Watch "${watch.name}" had errors`, result.errors);
    }

    if (now.getTime() - lastMaintenanceMs >= MAINTENANCE_INTERVAL_MS) {
      lastMaintenanceMs = now.getTime();
      sweepVanishedListings(now);
      rebuildBaselines(now);
      await refreshComps(40, now);
      purgeExpiredListings(now);
    }

    await deliverPendingAlerts();
  } catch (err) {
    log.error('Scheduler tick failed', err instanceof Error ? err.message : String(err));
  } finally {
    running = false;
  }
}
