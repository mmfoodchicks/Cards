/** Configuration. Everything has a working default; nothing is required. */

import 'dotenv/config';
import { fromRoot } from './util/paths.js';

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(v) ? v : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = (process.env[name] ?? '').toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

const dbPath = str('DATABASE_PATH', './data/cardledger.db');

export const config = {
  port: num('PORT', 8420),
  host: str('HOST', '0.0.0.0'),
  /** ':memory:' is honoured as-is so tests do not touch the disk. */
  databasePath: dbPath === ':memory:' ? dbPath : fromRoot(dbPath),
  receiptsDir: fromRoot(str('RECEIPTS_DIR', './data/receipts')),
  backupsDir: fromRoot(str('BACKUPS_DIR', './backups')),
  /** The tax year the app is currently working in. */
  taxYear: num('TAX_YEAR', new Date().getFullYear()),
  /** Write a backup on startup. Cheap insurance for a file full of financial records. */
  backupOnStart: bool('BACKUP_ON_START', true),
  logLevel: str('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
} as const;
