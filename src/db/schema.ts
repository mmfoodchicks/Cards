/**
 * Database schema.
 *
 * One design decision shapes everything here: `price_observations` is
 * APPEND-ONLY. Completed-sale data is not available from eBay's public API and
 * scraping it is prohibited, so the only comps this app will ever own are the
 * ones it records itself, starting from the first scan. Storing only "current
 * state" would make that impossible to reconstruct later, and it cannot be
 * backfilled — so every observed price is written down permanently from day one.
 */

export const SCHEMA_VERSION = 3;

export const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE IF NOT EXISTS listings (
    id                    TEXT PRIMARY KEY,
    source                TEXT NOT NULL,
    source_item_id        TEXT NOT NULL,
    title                 TEXT NOT NULL,
    url                   TEXT NOT NULL,
    image_url             TEXT,
    currency              TEXT NOT NULL DEFAULT 'USD',
    price_cents           INTEGER NOT NULL,
    shipping_cents        INTEGER,
    landed_cents          INTEGER NOT NULL,
    unit_cents            INTEGER NOT NULL,
    quantity              INTEGER NOT NULL DEFAULT 1,
    listing_type          TEXT NOT NULL,
    bid_count             INTEGER,
    ends_at               TEXT,
    condition             TEXT,
    seller_name           TEXT,
    seller_feedback_pct   REAL,
    seller_feedback_count INTEGER,
    location_country      TEXT,

    product_key           TEXT,
    category              TEXT,
    product_type          TEXT,
    sealed                INTEGER NOT NULL DEFAULT 0,
    graded                INTEGER NOT NULL DEFAULT 0,
    grader                TEXT,
    grade                 REAL,
    set_slug              TEXT,
    set_name              TEXT,
    year                  INTEGER,
    parse_json            TEXT NOT NULL,

    benchmark_kind        TEXT NOT NULL DEFAULT 'none',
    benchmark_cents       INTEGER,
    benchmark_label       TEXT,
    benchmark_source      TEXT,
    discount_pct          REAL,
    label                 TEXT NOT NULL DEFAULT 'unscored',
    under_msrp            INTEGER NOT NULL DEFAULT 0,
    confidence            REAL NOT NULL DEFAULT 0,
    score                 REAL NOT NULL DEFAULT 0,
    notes_json            TEXT NOT NULL DEFAULT '[]',

    first_seen_at         TEXT NOT NULL,
    last_seen_at          TEXT NOT NULL,
    -- Set when a listing we were tracking stopped appearing in results.
    gone_at               TEXT,
    watch_id              INTEGER,
    raw_json              TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_listings_score       ON listings (score DESC);
  CREATE INDEX IF NOT EXISTS idx_listings_label       ON listings (label, score DESC);
  CREATE INDEX IF NOT EXISTS idx_listings_under_msrp  ON listings (under_msrp, score DESC);
  CREATE INDEX IF NOT EXISTS idx_listings_product_key ON listings (product_key);
  CREATE INDEX IF NOT EXISTS idx_listings_last_seen   ON listings (last_seen_at);
  CREATE INDEX IF NOT EXISTS idx_listings_watch       ON listings (watch_id, score DESC);
  CREATE INDEX IF NOT EXISTS idx_listings_ends_at     ON listings (ends_at);

  -- Append-only. Never UPDATE or DELETE rows here.
  CREATE TABLE IF NOT EXISTS price_observations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    product_key  TEXT NOT NULL,
    observed_at  TEXT NOT NULL,
    unit_cents   INTEGER NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('ask','sold','sold-inferred')),
    source       TEXT NOT NULL,
    listing_id   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_obs_key_time ON price_observations (product_key, observed_at DESC);
  -- One ask per listing per day is plenty; this keeps a hourly poller from
  -- writing the same price 24 times and skewing the distribution.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_dedupe
    ON price_observations (listing_id, kind, substr(observed_at, 1, 10))
    WHERE listing_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS baselines (
    product_key TEXT PRIMARY KEY,
    value_cents INTEGER NOT NULL,
    kind        TEXT NOT NULL,
    n           INTEGER NOT NULL,
    dispersion  REAL NOT NULL,
    confidence  REAL NOT NULL,
    computed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS watches (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    query            TEXT NOT NULL,
    sources_json     TEXT NOT NULL DEFAULT '[]',
    category         TEXT,
    product_type     TEXT,
    min_price_cents  INTEGER,
    max_price_cents  INTEGER,
    min_discount_pct REAL NOT NULL DEFAULT 0.1,
    sealed_only      INTEGER NOT NULL DEFAULT 0,
    graded_only      INTEGER NOT NULL DEFAULT 0,
    exclude_lots     INTEGER NOT NULL DEFAULT 1,
    enabled          INTEGER NOT NULL DEFAULT 1,
    interval_minutes INTEGER NOT NULL DEFAULT 30,
    last_run_at      TEXT,
    last_error       TEXT,
    created_at       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id   TEXT NOT NULL,
    watch_id     INTEGER,
    label        TEXT NOT NULL,
    discount_pct REAL,
    created_at   TEXT NOT NULL,
    notified_at  TEXT,
    dismissed    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (listing_id, label)
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts (created_at DESC);

  -- User edits to the shipped MSRP catalog, kept separate so regenerating
  -- catalog/msrp.json never destroys someone's corrections.
  CREATE TABLE IF NOT EXISTS msrp_overrides (
    entry_id     TEXT PRIMARY KEY,
    msrp_cents   INTEGER,
    confidence   TEXT,
    note         TEXT,
    deleted      INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scan_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    watch_id      INTEGER,
    source        TEXT NOT NULL,
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    listings_seen INTEGER NOT NULL DEFAULT 0,
    new_listings  INTEGER NOT NULL DEFAULT 0,
    deals_found   INTEGER NOT NULL DEFAULT 0,
    calls_used    INTEGER NOT NULL DEFAULT 0,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    error         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_scan_runs_started ON scan_runs (started_at DESC);
  `,

  /* v2 */ `
  -- Market values fetched from a price-data provider (TCGplayer via
  -- pokemontcg.io, PriceCharting, ...). Kept apart from price_observations
  -- because these are authoritative single figures, not individual data
  -- points, and one of them outweighs a hundred asking prices.
  CREATE TABLE IF NOT EXISTS provider_comps (
    product_key  TEXT NOT NULL,
    provider     TEXT NOT NULL,
    value_cents  INTEGER NOT NULL,
    -- What the provider says the figure represents, e.g. 'tcgplayer-market'.
    basis        TEXT NOT NULL,
    sample_size  INTEGER,
    fetched_at   TEXT NOT NULL,
    detail_json  TEXT,
    PRIMARY KEY (product_key, provider)
  );
  CREATE INDEX IF NOT EXISTS idx_provider_comps_fetched ON provider_comps (fetched_at);
  `,

  /* v3 */ `
  -- Who listed it, so one seller with twenty identical listings cannot define
  -- the market for a product.
  ALTER TABLE price_observations ADD COLUMN seller_id TEXT;

  -- Tighten sampling. The old index allowed one observation per listing per
  -- DAY, so a listing that sat unsold for two months contributed sixty
  -- "independent" data points and single-handedly set the baseline. Bucketing
  -- by week cuts that by seven, and the ingest layer caps each listing's
  -- lifetime contribution on top.
  DROP INDEX IF EXISTS idx_obs_dedupe;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_dedupe_week
    ON price_observations (listing_id, kind, strftime('%Y-%W', observed_at))
    WHERE listing_id IS NOT NULL;
  `,
];
