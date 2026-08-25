/** Runs one watch against its sources and stores what it finds. */

import { config } from '../config.js';
import {
  createAlert,
  finishScanRun,
  markWatchRun,
  startScanRun,
} from '../db/repos.js';
import type { Db } from '../db/index.js';
import { getSource } from '../sources/registry.js';
import type { SourceQuery } from '../sources/types.js';
import type { ScoredListing, Watch } from '../types.js';
import { logger } from '../util/logger.js';
import { enrichListing, isDeal, persistListings } from './ingest.js';

const log = logger('scanner');

export interface ScanResult {
  watchId: number | null;
  listings: ScoredListing[];
  seen: number;
  newListings: number;
  deals: number;
  callsUsed: number;
  warnings: string[];
  errors: string[];
}

export async function runWatch(watch: Watch, db?: Db): Promise<ScanResult> {
  const sourceIds = watch.sources.length > 0 ? watch.sources : ['demo'];
  const result: ScanResult = {
    watchId: watch.id,
    listings: [],
    seen: 0,
    newListings: 0,
    deals: 0,
    callsUsed: 0,
    warnings: [],
    errors: [],
  };

  for (const sourceId of sourceIds) {
    const source = getSource(sourceId);
    if (!source) {
      result.errors.push(`Unknown source "${sourceId}".`);
      continue;
    }
    if (!source.isConfigured()) {
      result.warnings.push(`${source.displayName}: ${source.unavailableReason() ?? 'not configured'}`);
      continue;
    }

    const runId = startScanRun(watch.id, sourceId, db);
    try {
      const query: SourceQuery = {
        q: watch.query,
        category: watch.category,
        productType: watch.productType,
        minPriceCents: watch.minPriceCents,
        maxPriceCents: watch.maxPriceCents,
        condition: watch.gradedOnly ? 'graded' : 'any',
        sealedOnly: watch.sealedOnly,
        includeAuctions: true,
        limit: 200,
      };

      const found = await source.search(query);
      result.callsUsed += found.callsUsed;
      result.warnings.push(...found.warnings);

      const scored = found.listings
        .map((raw) => enrichListing(raw, { db }))
        .filter((listing) => keepForWatch(listing, watch));

      const stats = persistListings(scored, watch.id, db);
      result.listings.push(...scored);
      result.seen += stats.seen;
      result.newListings += stats.newListings;
      result.deals += stats.deals;

      // Alert only on genuinely new finds that clear the watch's own bar.
      for (const listing of scored) {
        if (!isDeal(listing)) continue;
        const discount = listing.discountPct ?? 0;
        if (discount < Math.max(watch.minDiscountPct, config.alerts.minDiscountPct)) continue;
        createAlert(listing.id, watch.id, listing.label, listing.discountPct, db);
      }

      finishScanRun(
        runId,
        {
          listingsSeen: stats.seen,
          newListings: stats.newListings,
          dealsFound: stats.deals,
          callsUsed: found.callsUsed,
          warnings: found.warnings,
        },
        db,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${source.displayName}: ${message}`);
      log.error(`Watch "${watch.name}" failed on ${sourceId}`, message);
      finishScanRun(
        runId,
        { listingsSeen: 0, newListings: 0, dealsFound: 0, callsUsed: 0, warnings: [], error: message },
        db,
      );
    }
  }

  markWatchRun(watch.id, result.errors.length > 0 ? result.errors.join(' | ') : null, db);
  return result;
}

/** Watch-level filters applied after scoring, since they depend on the parse. */
function keepForWatch(listing: ScoredListing, watch: Watch): boolean {
  const p = listing.parsed;
  if (watch.sealedOnly && !p.sealed) return false;
  if (watch.gradedOnly && !p.graded) return false;
  if (watch.excludeLots && (p.mixedLot || p.quantity > 1)) return false;
  if (watch.category && p.category !== watch.category) return false;
  if (watch.productType && p.productType !== watch.productType) return false;
  return true;
}
