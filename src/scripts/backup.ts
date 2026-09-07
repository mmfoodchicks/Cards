/**
 * Database backup.
 *
 * A single SQLite file holding the financial records of a business is exactly
 * the sort of thing that should be copied automatically rather than when
 * someone remembers. Backups run on startup and keep a rolling set, so a
 * mistaken bulk edit is recoverable and a disk failure costs a day rather than
 * a year.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { logger } from '../util/logger.js';

const log = logger('backup');

/** How many backups to keep before the oldest are removed. */
export const KEEP_BACKUPS = 30;

export function runBackup(): string | null {
  if (config.databasePath === ':memory:' || !existsSync(config.databasePath)) return null;

  mkdirSync(config.backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(config.backupsDir, `cardledger-${stamp}.db`);

  // Use SQLite's own backup so a copy taken mid-write is still consistent.
  try {
    const db = getDb();
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // A checkpoint failure is not fatal; the file copy is still worth taking.
  }
  copyFileSync(config.databasePath, target);

  prune();
  return target;
}

function prune(): void {
  const files = readdirSync(config.backupsDir)
    .filter((f) => f.startsWith('cardledger-') && f.endsWith('.db'))
    .map((f) => ({ name: f, path: join(config.backupsDir, f), mtime: statSync(join(config.backupsDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const stale of files.slice(KEEP_BACKUPS)) {
    unlinkSync(stale.path);
    log.debug(`Removed old backup ${stale.name}`);
  }
}

// Allow `npm run backup` to invoke this directly.
if (process.argv[1]?.endsWith('backup.ts') || process.argv[1]?.endsWith('backup.js')) {
  const path = runBackup();
  console.log(path ? `Backed up to ${path}` : 'Nothing to back up yet.');
}
