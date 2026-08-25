/**
 * `npm run scan` — run every enabled watch once, then rebuild baselines.
 *
 * Useful for a cron job on a machine where you would rather not leave the
 * server running, and for seeing what the engine does without a browser.
 */

import { listWatches } from '../db/repos.js';
import { getDb } from '../db/index.js';
import { rebuildBaselines, sweepVanishedListings } from '../pipeline/baselines.js';
import { runWatch } from '../pipeline/scanner.js';
import { deliverPendingAlerts } from '../notify/index.js';
import { formatCents } from '../pricing/landedCost.js';
import { seedDefaultWatches } from './seedWatches.js';

async function main(): Promise<void> {
  getDb();
  seedDefaultWatches();

  const watches = listWatches().filter((w) => w.enabled);
  if (watches.length === 0) {
    console.log('No enabled watches. Add one in the web UI first.');
    return;
  }

  for (const watch of watches) {
    process.stdout.write(`\nWatch: ${watch.name}\n`);
    const result = await runWatch(watch);
    console.log(`  seen ${result.seen}, new ${result.newListings}, deals ${result.deals}, api calls ${result.callsUsed}`);
    for (const w of result.warnings) console.log(`  ! ${w}`);
    for (const e of result.errors) console.log(`  x ${e}`);

    const top = [...result.listings].sort((a, b) => b.score - a.score).slice(0, 5);
    for (const listing of top) {
      if (listing.score <= 0) continue;
      const pct = listing.discountPct != null ? `${Math.round(listing.discountPct * 100)}%` : '  -';
      const flag = listing.underMsrp ? ' [UNDER MSRP]' : '';
      console.log(`    ${pct.padStart(4)} off  ${formatCents(listing.unitCents).padStart(9)}  ${listing.label}${flag}  ${listing.title.slice(0, 70)}`);
    }
  }

  sweepVanishedListings();
  rebuildBaselines();
  await deliverPendingAlerts();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
