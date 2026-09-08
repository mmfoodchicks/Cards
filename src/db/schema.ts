/**
 * Database schema.
 *
 * Two principles shape it.
 *
 * FIRST: nothing is ever silently overwritten. This is a book of account that
 * has to stand up years later if a return is examined, so edits and deletions
 * are written to an audit log with the old values. IRC 6001 requires records
 * sufficient to establish income and deductions, and "I changed it and can't
 * remember why" is not that.
 *
 * SECOND: money never moves without a trace. A purchase lot's cost is allocated
 * across items and the allocations must sum back to the lot; an item's basis is
 * relieved into cost of goods sold when it sells. Every table that holds cents
 * exists so those chains can be walked and checked.
 */

export const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE IF NOT EXISTS business_profile (
    id                     INTEGER PRIMARY KEY CHECK (id = 1),
    business_name          TEXT NOT NULL DEFAULT '',
    owner_name             TEXT NOT NULL DEFAULT '',
    entity_type            TEXT NOT NULL DEFAULT 'sole-proprietor',
    ein                    TEXT,
    state                  TEXT NOT NULL DEFAULT 'UT',
    county                 TEXT NOT NULL DEFAULT 'Davis',
    city                   TEXT NOT NULL DEFAULT '',
    accounting_method      TEXT NOT NULL DEFAULT 'cash',
    inventory_method       TEXT NOT NULL DEFAULT 'inventory',
    started_on             TEXT,
    filing_status          TEXT NOT NULL DEFAULT 'single',
    other_income_cents     INTEGER NOT NULL DEFAULT 0,
    other_withholding_cents INTEGER NOT NULL DEFAULT 0,
    prior_year_tax_cents   INTEGER,
    prior_year_agi_cents   INTEGER,
    home_office_sqft       REAL,
    home_total_sqft        REAL,
    updated_at             TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS purchase_lots (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    purchased_on          TEXT NOT NULL,
    vendor                TEXT NOT NULL DEFAULT '',
    channel               TEXT NOT NULL DEFAULT 'other',
    description           TEXT NOT NULL DEFAULT '',
    subtotal_cents        INTEGER NOT NULL DEFAULT 0,
    shipping_cents        INTEGER NOT NULL DEFAULT 0,
    tax_cents             INTEGER NOT NULL DEFAULT 0,
    fees_cents            INTEGER NOT NULL DEFAULT 0,
    payment_method        TEXT,
    resale_exemption_used INTEGER NOT NULL DEFAULT 0,
    notes                 TEXT,
    receipt_path          TEXT,
    created_at            TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lots_date ON purchase_lots (purchased_on);

  CREATE TABLE IF NOT EXISTS inventory_items (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id                 INTEGER REFERENCES purchase_lots (id) ON DELETE SET NULL,
    parent_item_id         INTEGER REFERENCES inventory_items (id) ON DELETE SET NULL,
    kind                   TEXT NOT NULL DEFAULT 'single',
    holding_intent         TEXT NOT NULL DEFAULT 'inventory',
    description            TEXT NOT NULL,
    category               TEXT,
    set_name               TEXT,
    year                   INTEGER,
    quantity               INTEGER NOT NULL DEFAULT 1,
    acquired_on            TEXT NOT NULL,
    basis_cents            INTEGER NOT NULL DEFAULT 0,
    estimated_value_cents  INTEGER,
    status                 TEXT NOT NULL DEFAULT 'on-hand',
    graded_by              TEXT,
    grade                  TEXT,
    cert_number            TEXT,
    location               TEXT,
    notes                  TEXT,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_items_status  ON inventory_items (status);
  CREATE INDEX IF NOT EXISTS idx_items_lot     ON inventory_items (lot_id);
  CREATE INDEX IF NOT EXISTS idx_items_parent  ON inventory_items (parent_item_id);
  CREATE INDEX IF NOT EXISTS idx_items_intent  ON inventory_items (holding_intent);
  CREATE INDEX IF NOT EXISTS idx_items_acquired ON inventory_items (acquired_on);

  CREATE TABLE IF NOT EXISTS opening_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id           INTEGER NOT NULL REFERENCES inventory_items (id) ON DELETE CASCADE,
    opened_on         TEXT NOT NULL,
    allocation_method TEXT NOT NULL DEFAULT 'relative-fmv',
    notes             TEXT,
    created_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS grading_submissions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    grader              TEXT NOT NULL,
    service_level       TEXT,
    submitted_on        TEXT NOT NULL,
    returned_on         TEXT,
    submission_number   TEXT,
    fee_cents           INTEGER NOT NULL DEFAULT 0,
    shipping_to_cents   INTEGER NOT NULL DEFAULT 0,
    shipping_back_cents INTEGER NOT NULL DEFAULT 0,
    insurance_cents     INTEGER NOT NULL DEFAULT 0,
    notes               TEXT,
    created_at          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS grading_submission_items (
    submission_id         INTEGER NOT NULL REFERENCES grading_submissions (id) ON DELETE CASCADE,
    item_id               INTEGER NOT NULL REFERENCES inventory_items (id) ON DELETE CASCADE,
    result_grade          TEXT,
    cert_number           TEXT,
    allocated_cost_cents  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (submission_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS sales (
    id                             INTEGER PRIMARY KEY AUTOINCREMENT,
    sold_on                        TEXT NOT NULL,
    channel                        TEXT NOT NULL DEFAULT 'other',
    order_ref                      TEXT,
    buyer_state                    TEXT,
    gross_cents                    INTEGER NOT NULL DEFAULT 0,
    shipping_charged_cents         INTEGER NOT NULL DEFAULT 0,
    sales_tax_collected_cents      INTEGER NOT NULL DEFAULT 0,
    sales_tax_remitted_by_platform INTEGER NOT NULL DEFAULT 1,
    platform_fee_cents             INTEGER NOT NULL DEFAULT 0,
    payment_processing_fee_cents   INTEGER NOT NULL DEFAULT 0,
    shipping_cost_cents            INTEGER NOT NULL DEFAULT 0,
    other_fee_cents                INTEGER NOT NULL DEFAULT 0,
    refunded_cents                 INTEGER NOT NULL DEFAULT 0,
    notes                          TEXT,
    created_at                     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sales_date    ON sales (sold_on);
  CREATE INDEX IF NOT EXISTS idx_sales_channel ON sales (channel);

  CREATE TABLE IF NOT EXISTS sale_lines (
    sale_id               INTEGER NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
    item_id               INTEGER NOT NULL REFERENCES inventory_items (id) ON DELETE RESTRICT,
    quantity              INTEGER NOT NULL DEFAULT 1,
    allocated_gross_cents INTEGER NOT NULL DEFAULT 0,
    cogs_cents            INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (sale_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    incurred_on           TEXT NOT NULL,
    account_key           TEXT NOT NULL,
    vendor                TEXT,
    description           TEXT NOT NULL DEFAULT '',
    amount_cents          INTEGER NOT NULL,
    business_use_percent  REAL NOT NULL DEFAULT 100,
    payment_method        TEXT,
    receipt_path          TEXT,
    notes                 TEXT,
    created_at            TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_date    ON expenses (incurred_on);
  CREATE INDEX IF NOT EXISTS idx_expenses_account ON expenses (account_key);

  CREATE TABLE IF NOT EXISTS mileage_trips (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    driven_on      TEXT NOT NULL,
    purpose        TEXT NOT NULL,
    from_location  TEXT,
    to_location    TEXT,
    miles          REAL NOT NULL,
    round_trip     INTEGER NOT NULL DEFAULT 0,
    odometer_start REAL,
    odometer_end   REAL,
    notes          TEXT,
    created_at     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_mileage_date ON mileage_trips (driven_on);

  CREATE TABLE IF NOT EXISTS payouts (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    channel              TEXT NOT NULL,
    received_on          TEXT NOT NULL,
    period_start         TEXT,
    period_end           TEXT,
    gross_cents          INTEGER NOT NULL DEFAULT 0,
    fees_cents           INTEGER NOT NULL DEFAULT 0,
    refunds_cents        INTEGER NOT NULL DEFAULT 0,
    shipping_labels_cents INTEGER NOT NULL DEFAULT 0,
    sales_tax_cents      INTEGER NOT NULL DEFAULT 0,
    net_cents            INTEGER NOT NULL DEFAULT 0,
    reference            TEXT,
    notes                TEXT,
    created_at           TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_payouts_date ON payouts (received_on);

  CREATE TABLE IF NOT EXISTS compliance_status (
    task_id        TEXT PRIMARY KEY,
    completed      INTEGER NOT NULL DEFAULT 0,
    completed_on   TEXT,
    reference      TEXT,
    notes          TEXT,
    not_applicable INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT NOT NULL
  );

  -- Every change to a money-bearing row, so the books can be reconstructed.
  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL,
    table_name  TEXT NOT NULL,
    row_id      TEXT NOT NULL,
    action      TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
    before_json TEXT,
    after_json  TEXT,
    reason      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_time  ON audit_log (occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_row   ON audit_log (table_name, row_id);

  -- Which tax year's figures have been reviewed against their sources.
  CREATE TABLE IF NOT EXISTS tax_year_review (
    year         INTEGER PRIMARY KEY,
    reviewed     INTEGER NOT NULL DEFAULT 0,
    reviewed_on  TEXT,
    reviewed_by  TEXT,
    notes        TEXT
  );
  `,

  /* v2 — when a value was observed, and where it came from.
   *
   * An estimated value is only meaningful with a date attached. Treas. Reg.
   * 1.61-6 allocates cost by fair market value AT THE TIME of the purchase, so
   * a price pulled today is the wrong number for a box bought last March —
   * structurally, not marginally. Without a date nothing could tell the
   * difference. */
  `
  ALTER TABLE inventory_items ADD COLUMN estimated_value_as_of TEXT;
  ALTER TABLE inventory_items ADD COLUMN estimated_value_source TEXT;
  `,
];
