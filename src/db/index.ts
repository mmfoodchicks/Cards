/** SQLite connection and migrations. */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { logger } from '../util/logger.js';
import { MIGRATIONS } from './schema.js';

const log = logger('db');

export type Db = Database.Database;

let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;
  if (config.databasePath !== ':memory:') {
    mkdirSync(dirname(config.databasePath), { recursive: true });
  }
  db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/** An isolated in-memory database, for tests. */
export function openMemoryDb(): Db {
  const memory = new Database(':memory:');
  memory.pragma('foreign_keys = ON');
  migrate(memory);
  return memory;
}

function migrate(target: Db): void {
  const current = (target.pragma('user_version', { simple: true }) as number) ?? 0;
  if (current >= MIGRATIONS.length) return;
  for (let version = current; version < MIGRATIONS.length; version++) {
    log.info(`Applying migration ${version + 1}.`);
    target.exec(MIGRATIONS[version]!);
  }
  target.pragma(`user_version = ${MIGRATIONS.length}`);
}

export function closeDb(): void {
  db?.close();
  db = null;
}
