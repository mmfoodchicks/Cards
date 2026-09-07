/**
 * Audit trail.
 *
 * A book of account has to be defensible years after the fact. IRC 6001
 * requires records sufficient to establish income and deductions, and an
 * amount that changed with no record of why is exactly what an examiner asks
 * about. Every insert, update and delete of a money-bearing row is logged with
 * the values before and after.
 *
 * This is cheap — a few hundred bytes per change — and it is the difference
 * between "I must have mistyped it" and being able to show what happened.
 */

import type { Db } from './index.js';
import { getDb } from './index.js';

export type AuditAction = 'insert' | 'update' | 'delete';

export function recordAudit(
  table: string,
  rowId: string | number,
  action: AuditAction,
  before: unknown,
  after: unknown,
  reason?: string,
  db: Db = getDb(),
): void {
  db.prepare(`
    INSERT INTO audit_log (occurred_at, table_name, row_id, action, before_json, after_json, reason)
    VALUES (@at, @table, @rowId, @action, @before, @after, @reason)
  `).run({
    at: new Date().toISOString(),
    table,
    rowId: String(rowId),
    action,
    before: before === undefined || before === null ? null : JSON.stringify(before),
    after: after === undefined || after === null ? null : JSON.stringify(after),
    reason: reason ?? null,
  });
}

export interface AuditEntry {
  id: number;
  occurred_at: string;
  table_name: string;
  row_id: string;
  action: AuditAction;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
}

export function auditHistory(table: string, rowId: string | number, db: Db = getDb()): AuditEntry[] {
  return db
    .prepare('SELECT * FROM audit_log WHERE table_name = ? AND row_id = ? ORDER BY id')
    .all(table, String(rowId)) as AuditEntry[];
}

export function recentAudit(limit = 100, db: Db = getDb()): AuditEntry[] {
  return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as AuditEntry[];
}
