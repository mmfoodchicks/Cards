/** Data access. All SQL lives here; nothing above this layer writes SQL. */

import type { Db } from './index.js';
import { getDb } from './index.js';
import type {
  Baseline,
  BenchmarkKind,
  Category,
  DealLabel,
  ParsedListing,
  PriceObservation,
  ProductType,
  ScoredListing,
  Watch,
} from '../types.js';

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export interface ListingRow {
  id: string;
  source: string;
  source_item_id: string;
  title: string;
  url: string;
  image_url: string | null;
  currency: string;
  price_cents: number;
  shipping_cents: number | null;
  landed_cents: number;
  unit_cents: number;
  quantity: number;
  listing_type: string;
  bid_count: number | null;
  ends_at: string | null;
  condition: string | null;
  seller_name: string | null;
  seller_feedback_pct: number | null;
  seller_feedback_count: number | null;
  location_country: string | null;
  product_key: string | null;
  category: string | null;
  product_type: string | null;
  sealed: number;
  graded: number;
  grader: string | null;
  grade: number | null;
  set_slug: string | null;
  set_name: string | null;
  year: number | null;
  parse_json: string;
  benchmark_kind: string;
  benchmark_cents: number | null;
  benchmark_label: string | null;
  benchmark_source: string | null;
  discount_pct: number | null;
  label: string;
  under_msrp: number;
  confidence: number;
  score: number;
  notes_json: string;
  first_seen_at: string;
  last_seen_at: string;
  gone_at: string | null;
  watch_id: number | null;
  raw_json: string | null;
}

/**
 * Insert or refresh a listing.
 *
 * `first_seen_at` is preserved across updates — knowing how long something has
 * sat unsold is a real signal, and clobbering it would lose that history.
 */
export function upsertListing(listing: ScoredListing, watchId: number | null, db: Db = getDb()): { isNew: boolean } {
  const existing = db.prepare('SELECT first_seen_at FROM listings WHERE id = ?').get(listing.id) as
    | { first_seen_at: string }
    | undefined;

  db.prepare(`
    INSERT INTO listings (
      id, source, source_item_id, title, url, image_url, currency,
      price_cents, shipping_cents, landed_cents, unit_cents, quantity,
      listing_type, bid_count, ends_at, condition,
      seller_name, seller_feedback_pct, seller_feedback_count, location_country,
      product_key, category, product_type, sealed, graded, grader, grade,
      set_slug, set_name, year, parse_json,
      benchmark_kind, benchmark_cents, benchmark_label, benchmark_source,
      discount_pct, label, under_msrp, confidence, score, notes_json,
      first_seen_at, last_seen_at, gone_at, watch_id, raw_json
    ) VALUES (
      @id, @source, @source_item_id, @title, @url, @image_url, @currency,
      @price_cents, @shipping_cents, @landed_cents, @unit_cents, @quantity,
      @listing_type, @bid_count, @ends_at, @condition,
      @seller_name, @seller_feedback_pct, @seller_feedback_count, @location_country,
      @product_key, @category, @product_type, @sealed, @graded, @grader, @grade,
      @set_slug, @set_name, @year, @parse_json,
      @benchmark_kind, @benchmark_cents, @benchmark_label, @benchmark_source,
      @discount_pct, @label, @under_msrp, @confidence, @score, @notes_json,
      @first_seen_at, @last_seen_at, NULL, @watch_id, @raw_json
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      image_url = excluded.image_url,
      price_cents = excluded.price_cents,
      shipping_cents = excluded.shipping_cents,
      landed_cents = excluded.landed_cents,
      unit_cents = excluded.unit_cents,
      quantity = excluded.quantity,
      listing_type = excluded.listing_type,
      bid_count = excluded.bid_count,
      ends_at = excluded.ends_at,
      benchmark_kind = excluded.benchmark_kind,
      benchmark_cents = excluded.benchmark_cents,
      benchmark_label = excluded.benchmark_label,
      benchmark_source = excluded.benchmark_source,
      discount_pct = excluded.discount_pct,
      label = excluded.label,
      under_msrp = excluded.under_msrp,
      confidence = excluded.confidence,
      score = excluded.score,
      notes_json = excluded.notes_json,
      last_seen_at = excluded.last_seen_at,
      -- A listing that reappears was not sold after all.
      gone_at = NULL,
      watch_id = COALESCE(excluded.watch_id, listings.watch_id)
  `).run({
    id: listing.id,
    source: listing.source,
    source_item_id: listing.sourceItemId,
    title: listing.title,
    url: listing.url,
    image_url: listing.imageUrl,
    currency: listing.currency,
    price_cents: listing.priceCents,
    shipping_cents: listing.shippingCents,
    landed_cents: listing.landedCents,
    unit_cents: listing.unitCents,
    quantity: listing.parsed.quantity,
    listing_type: listing.listingType,
    bid_count: listing.bidCount,
    ends_at: listing.endsAt,
    condition: listing.condition,
    seller_name: listing.sellerName,
    seller_feedback_pct: listing.sellerFeedbackPct,
    seller_feedback_count: listing.sellerFeedbackCount,
    location_country: listing.locationCountry,
    product_key: listing.parsed.productKey,
    category: listing.parsed.category,
    product_type: listing.parsed.productType,
    sealed: listing.parsed.sealed ? 1 : 0,
    graded: listing.parsed.graded ? 1 : 0,
    grader: listing.parsed.grader,
    grade: listing.parsed.grade,
    set_slug: listing.parsed.setSlug,
    set_name: listing.parsed.setName,
    year: listing.parsed.year,
    parse_json: JSON.stringify(listing.parsed),
    benchmark_kind: listing.benchmarkKind,
    benchmark_cents: listing.benchmarkCents,
    benchmark_label: listing.benchmarkLabel,
    benchmark_source: listing.benchmarkSource,
    discount_pct: listing.discountPct,
    label: listing.label,
    under_msrp: listing.underMsrp ? 1 : 0,
    confidence: listing.confidence,
    score: listing.score,
    notes_json: JSON.stringify(listing.notes),
    first_seen_at: existing?.first_seen_at ?? listing.firstSeenAt,
    last_seen_at: listing.lastSeenAt,
    watch_id: watchId,
    raw_json: listing.raw === undefined ? null : JSON.stringify(listing.raw),
  });

  return { isNew: existing === undefined };
}

export interface DealFilter {
  labels?: DealLabel[];
  underMsrpOnly?: boolean;
  category?: Category | null;
  productType?: ProductType | null;
  sealedOnly?: boolean;
  gradedOnly?: boolean;
  minDiscountPct?: number | null;
  maxUnitCents?: number | null;
  watchId?: number | null;
  source?: string | null;
  /** Auctions closing within this many hours. */
  endingWithinHours?: number | null;
  includeGone?: boolean;
  search?: string | null;
  sort?: 'score' | 'discount' | 'newest' | 'ending' | 'price';
  limit?: number;
  offset?: number;
}

export function queryListings(filter: DealFilter, db: Db = getDb()): { rows: ListingRow[]; total: number } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (!filter.includeGone) where.push('gone_at IS NULL');
  if (filter.labels?.length) {
    where.push(`label IN (${filter.labels.map((_, i) => `@label${i}`).join(',')})`);
    filter.labels.forEach((l, i) => { params[`label${i}`] = l; });
  }
  if (filter.underMsrpOnly) where.push('under_msrp = 1');
  if (filter.category) { where.push('category = @category'); params.category = filter.category; }
  if (filter.productType) { where.push('product_type = @productType'); params.productType = filter.productType; }
  if (filter.sealedOnly) where.push('sealed = 1');
  if (filter.gradedOnly) where.push('graded = 1');
  if (filter.minDiscountPct != null) { where.push('discount_pct >= @minDiscount'); params.minDiscount = filter.minDiscountPct; }
  if (filter.maxUnitCents != null) { where.push('unit_cents <= @maxUnit'); params.maxUnit = filter.maxUnitCents; }
  if (filter.watchId != null) { where.push('watch_id = @watchId'); params.watchId = filter.watchId; }
  if (filter.source) { where.push('source = @source'); params.source = filter.source; }
  if (filter.endingWithinHours != null) {
    where.push("ends_at IS NOT NULL AND ends_at <= @endsBefore AND ends_at >= @now");
    params.endsBefore = new Date(Date.now() + filter.endingWithinHours * 3_600_000).toISOString();
    params.now = new Date().toISOString();
  }
  if (filter.search) { where.push('title LIKE @search'); params.search = `%${filter.search}%`; }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const order = {
    score: 'score DESC, discount_pct DESC',
    discount: 'discount_pct DESC NULLS LAST, score DESC',
    newest: 'first_seen_at DESC',
    ending: 'ends_at ASC NULLS LAST',
    price: 'unit_cents ASC',
  }[filter.sort ?? 'score'];

  const limit = Math.min(500, Math.max(1, filter.limit ?? 100));
  const offset = Math.max(0, filter.offset ?? 0);

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM listings ${clause}`).get(params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT * FROM listings ${clause} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`)
    .all(params) as ListingRow[];

  return { rows, total };
}

export function getListing(id: string, db: Db = getDb()): ListingRow | null {
  return (db.prepare('SELECT * FROM listings WHERE id = ?').get(id) as ListingRow | undefined) ?? null;
}

/**
 * Listings we have stopped seeing.
 *
 * A fixed-price listing that vanishes before its scheduled end date has almost
 * always sold. That inference is the only legitimate source of completed-sale
 * data available here, so it is recorded — but as its own weaker observation
 * kind, never as a reported sale.
 */
export function findVanishedListings(
  staleBeforeIso: string,
  db: Db = getDb(),
): Array<{ id: string; product_key: string | null; unit_cents: number; source: string; ends_at: string | null; last_seen_at: string; first_seen_at: string }> {
  return db
    .prepare(`
      SELECT id, product_key, unit_cents, source, ends_at, last_seen_at, first_seen_at
      FROM listings
      WHERE gone_at IS NULL
        AND last_seen_at < @stale
        AND product_key IS NOT NULL
        -- Seen more than once, so a single blip in search results does not
        -- get mistaken for a sale.
        AND first_seen_at < last_seen_at
    `)
    .all({ stale: staleBeforeIso }) as ReturnType<typeof findVanishedListings>;
}

export function markGone(id: string, goneAt: string, db: Db = getDb()): void {
  db.prepare('UPDATE listings SET gone_at = @goneAt WHERE id = @id').run({ id, goneAt });
}

// ---------------------------------------------------------------------------
// Price observations (append-only)
// ---------------------------------------------------------------------------

/**
 * How many times one listing may ever contribute an asking price.
 *
 * A listing that sits unsold for months is weak evidence repeated, not strong
 * evidence: the seller's price is one opinion no matter how long it stays up.
 * Four observations spans the 45-day baseline window at weekly spacing with
 * room for a re-price.
 */
export const MAX_OBSERVATIONS_PER_LISTING = 4;

export function recordObservation(obs: PriceObservation, db: Db = getDb()): void {
  if (obs.listingId) {
    const seen = db
      .prepare('SELECT COUNT(*) AS n FROM price_observations WHERE listing_id = ? AND kind = ?')
      .get(obs.listingId, obs.kind) as { n: number };
    if (seen.n >= MAX_OBSERVATIONS_PER_LISTING) return;
  }

  db.prepare(`
    INSERT OR IGNORE INTO price_observations
      (product_key, observed_at, unit_cents, kind, source, listing_id, seller_id)
    VALUES (@productKey, @observedAt, @unitCents, @kind, @source, @listingId, @sellerId)
  `).run({
    productKey: obs.productKey,
    observedAt: obs.observedAt,
    unitCents: obs.unitCents,
    kind: obs.kind,
    source: obs.source,
    listingId: obs.listingId,
    sellerId: obs.sellerId ?? null,
  });
}

export function observationsFor(productKey: string, sinceIso: string, db: Db = getDb()): PriceObservation[] {
  const rows = db
    .prepare(`
      SELECT product_key, observed_at, unit_cents, kind, source, listing_id, seller_id
      FROM price_observations
      WHERE product_key = @key AND observed_at >= @since
      ORDER BY observed_at DESC
      LIMIT 2000
    `)
    .all({ key: productKey, since: sinceIso }) as Array<{
      product_key: string; observed_at: string; unit_cents: number;
      kind: PriceObservation['kind']; source: string; listing_id: string | null;
      seller_id: string | null;
    }>;

  return rows.map((r) => ({
    productKey: r.product_key,
    observedAt: r.observed_at,
    unitCents: r.unit_cents,
    kind: r.kind,
    source: r.source,
    listingId: r.listing_id,
    sellerId: r.seller_id,
  }));
}

export function productKeysWithObservations(sinceIso: string, db: Db = getDb()): string[] {
  const rows = db
    .prepare('SELECT DISTINCT product_key FROM price_observations WHERE observed_at >= ?')
    .all(sinceIso) as Array<{ product_key: string }>;
  return rows.map((r) => r.product_key);
}

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

export function saveBaseline(baseline: Baseline, db: Db = getDb()): void {
  db.prepare(`
    INSERT INTO baselines (product_key, value_cents, kind, n, dispersion, confidence, computed_at)
    VALUES (@productKey, @valueCents, @kind, @n, @dispersion, @confidence, @computedAt)
    ON CONFLICT(product_key) DO UPDATE SET
      value_cents = excluded.value_cents, kind = excluded.kind, n = excluded.n,
      dispersion = excluded.dispersion, confidence = excluded.confidence,
      computed_at = excluded.computed_at
  `).run(baseline);
}

export function getBaseline(productKey: string, db: Db = getDb()): Baseline | null {
  const row = db.prepare('SELECT * FROM baselines WHERE product_key = ?').get(productKey) as
    | { product_key: string; value_cents: number; kind: string; n: number; dispersion: number; confidence: number; computed_at: string }
    | undefined;
  if (!row) return null;
  return {
    productKey: row.product_key,
    valueCents: row.value_cents,
    kind: row.kind as BenchmarkKind,
    n: row.n,
    dispersion: row.dispersion,
    confidence: row.confidence,
    computedAt: row.computed_at,
  };
}

// ---------------------------------------------------------------------------
// Watches
// ---------------------------------------------------------------------------

interface WatchRow {
  id: number; name: string; query: string; sources_json: string;
  category: string | null; product_type: string | null;
  min_price_cents: number | null; max_price_cents: number | null;
  min_discount_pct: number; sealed_only: number; graded_only: number;
  exclude_lots: number; enabled: number; interval_minutes: number;
  last_run_at: string | null; last_error: string | null; created_at: string;
}

function toWatch(row: WatchRow): Watch {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    sources: JSON.parse(row.sources_json) as string[],
    category: (row.category as Category | null) ?? null,
    productType: (row.product_type as ProductType | null) ?? null,
    minPriceCents: row.min_price_cents,
    maxPriceCents: row.max_price_cents,
    minDiscountPct: row.min_discount_pct,
    sealedOnly: row.sealed_only === 1,
    gradedOnly: row.graded_only === 1,
    excludeLots: row.exclude_lots === 1,
    enabled: row.enabled === 1,
    intervalMinutes: row.interval_minutes,
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

export function listWatches(db: Db = getDb()): Watch[] {
  return (db.prepare('SELECT * FROM watches ORDER BY id').all() as WatchRow[]).map(toWatch);
}

export function getWatch(id: number, db: Db = getDb()): Watch | null {
  const row = db.prepare('SELECT * FROM watches WHERE id = ?').get(id) as WatchRow | undefined;
  return row ? toWatch(row) : null;
}

export type WatchInput = Omit<Watch, 'id' | 'lastRunAt' | 'lastError' | 'createdAt'>;

export function createWatch(input: WatchInput, db: Db = getDb()): Watch {
  const result = db.prepare(`
    INSERT INTO watches (
      name, query, sources_json, category, product_type,
      min_price_cents, max_price_cents, min_discount_pct,
      sealed_only, graded_only, exclude_lots, enabled, interval_minutes, created_at
    ) VALUES (
      @name, @query, @sourcesJson, @category, @productType,
      @minPriceCents, @maxPriceCents, @minDiscountPct,
      @sealedOnly, @gradedOnly, @excludeLots, @enabled, @intervalMinutes, @createdAt
    )
  `).run({
    name: input.name,
    query: input.query,
    sourcesJson: JSON.stringify(input.sources),
    category: input.category,
    productType: input.productType,
    minPriceCents: input.minPriceCents,
    maxPriceCents: input.maxPriceCents,
    minDiscountPct: input.minDiscountPct,
    sealedOnly: input.sealedOnly ? 1 : 0,
    gradedOnly: input.gradedOnly ? 1 : 0,
    excludeLots: input.excludeLots ? 1 : 0,
    enabled: input.enabled ? 1 : 0,
    intervalMinutes: input.intervalMinutes,
    createdAt: new Date().toISOString(),
  });
  return getWatch(Number(result.lastInsertRowid), db)!;
}

export function updateWatch(id: number, patch: Partial<WatchInput>, db: Db = getDb()): Watch | null {
  const current = getWatch(id, db);
  if (!current) return null;
  const merged = { ...current, ...patch };
  db.prepare(`
    UPDATE watches SET
      name = @name, query = @query, sources_json = @sourcesJson,
      category = @category, product_type = @productType,
      min_price_cents = @minPriceCents, max_price_cents = @maxPriceCents,
      min_discount_pct = @minDiscountPct, sealed_only = @sealedOnly,
      graded_only = @gradedOnly, exclude_lots = @excludeLots,
      enabled = @enabled, interval_minutes = @intervalMinutes
    WHERE id = @id
  `).run({
    id,
    name: merged.name,
    query: merged.query,
    sourcesJson: JSON.stringify(merged.sources),
    category: merged.category,
    productType: merged.productType,
    minPriceCents: merged.minPriceCents,
    maxPriceCents: merged.maxPriceCents,
    minDiscountPct: merged.minDiscountPct,
    sealedOnly: merged.sealedOnly ? 1 : 0,
    gradedOnly: merged.gradedOnly ? 1 : 0,
    excludeLots: merged.excludeLots ? 1 : 0,
    enabled: merged.enabled ? 1 : 0,
    intervalMinutes: merged.intervalMinutes,
  });
  return getWatch(id, db);
}

export function deleteWatch(id: number, db: Db = getDb()): boolean {
  return db.prepare('DELETE FROM watches WHERE id = ?').run(id).changes > 0;
}

export function markWatchRun(id: number, error: string | null, db: Db = getDb()): void {
  db.prepare('UPDATE watches SET last_run_at = @now, last_error = @error WHERE id = @id')
    .run({ id, now: new Date().toISOString(), error });
}

/** Watches whose interval has elapsed. */
export function dueWatches(now: Date, db: Db = getDb()): Watch[] {
  return listWatches(db).filter((w) => {
    if (!w.enabled) return false;
    if (!w.lastRunAt) return true;
    return now.getTime() - Date.parse(w.lastRunAt) >= w.intervalMinutes * 60_000;
  });
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export function createAlert(
  listingId: string,
  watchId: number | null,
  label: DealLabel,
  discountPct: number | null,
  db: Db = getDb(),
): boolean {
  const res = db.prepare(`
    INSERT OR IGNORE INTO alerts (listing_id, watch_id, label, discount_pct, created_at)
    VALUES (@listingId, @watchId, @label, @discountPct, @createdAt)
  `).run({ listingId, watchId, label, discountPct, createdAt: new Date().toISOString() });
  return res.changes > 0;
}

export function pendingAlerts(db: Db = getDb()): Array<{ id: number; listing_id: string; label: string; discount_pct: number | null }> {
  return db
    .prepare('SELECT id, listing_id, label, discount_pct FROM alerts WHERE notified_at IS NULL AND dismissed = 0 ORDER BY id')
    .all() as ReturnType<typeof pendingAlerts>;
}

export function markAlertNotified(id: number, db: Db = getDb()): void {
  db.prepare('UPDATE alerts SET notified_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

export function dismissAlert(id: number, db: Db = getDb()): void {
  db.prepare('UPDATE alerts SET dismissed = 1 WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// MSRP overrides
// ---------------------------------------------------------------------------

export interface MsrpOverride {
  entryId: string;
  msrpCents: number | null;
  confidence: 'high' | 'medium' | 'low' | null;
  note: string | null;
  deleted: boolean;
  payload: Record<string, unknown> | null;
  updatedAt: string;
}

export function listMsrpOverrides(db: Db = getDb()): MsrpOverride[] {
  const rows = db.prepare('SELECT * FROM msrp_overrides').all() as Array<{
    entry_id: string; msrp_cents: number | null; confidence: string | null;
    note: string | null; deleted: number; payload_json: string | null; updated_at: string;
  }>;
  return rows.map((r) => ({
    entryId: r.entry_id,
    msrpCents: r.msrp_cents,
    confidence: r.confidence as MsrpOverride['confidence'],
    note: r.note,
    deleted: r.deleted === 1,
    payload: r.payload_json ? (JSON.parse(r.payload_json) as Record<string, unknown>) : null,
    updatedAt: r.updated_at,
  }));
}

export function saveMsrpOverride(override: Omit<MsrpOverride, 'updatedAt'>, db: Db = getDb()): void {
  db.prepare(`
    INSERT INTO msrp_overrides (entry_id, msrp_cents, confidence, note, deleted, payload_json, updated_at)
    VALUES (@entryId, @msrpCents, @confidence, @note, @deleted, @payloadJson, @updatedAt)
    ON CONFLICT(entry_id) DO UPDATE SET
      msrp_cents = excluded.msrp_cents, confidence = excluded.confidence,
      note = excluded.note, deleted = excluded.deleted,
      payload_json = excluded.payload_json, updated_at = excluded.updated_at
  `).run({
    entryId: override.entryId,
    msrpCents: override.msrpCents,
    confidence: override.confidence,
    note: override.note,
    deleted: override.deleted ? 1 : 0,
    payloadJson: override.payload ? JSON.stringify(override.payload) : null,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Scan runs
// ---------------------------------------------------------------------------

export function startScanRun(watchId: number | null, source: string, db: Db = getDb()): number {
  const res = db
    .prepare('INSERT INTO scan_runs (watch_id, source, started_at) VALUES (?, ?, ?)')
    .run(watchId, source, new Date().toISOString());
  return Number(res.lastInsertRowid);
}

export function finishScanRun(
  id: number,
  stats: { listingsSeen: number; newListings: number; dealsFound: number; callsUsed: number; warnings: string[]; error?: string | null },
  db: Db = getDb(),
): void {
  db.prepare(`
    UPDATE scan_runs SET finished_at = @finishedAt, listings_seen = @listingsSeen,
      new_listings = @newListings, deals_found = @dealsFound, calls_used = @callsUsed,
      warnings_json = @warningsJson, error = @error
    WHERE id = @id
  `).run({
    id,
    finishedAt: new Date().toISOString(),
    listingsSeen: stats.listingsSeen,
    newListings: stats.newListings,
    dealsFound: stats.dealsFound,
    callsUsed: stats.callsUsed,
    warningsJson: JSON.stringify(stats.warnings),
    error: stats.error ?? null,
  });
}

export function recentScanRuns(limit = 25, db: Db = getDb()): unknown[] {
  return db.prepare('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT ?').all(limit);
}

/** Rehydrates the parsed structure stored alongside a listing row. */
export function parsedFromRow(row: ListingRow): ParsedListing {
  return JSON.parse(row.parse_json) as ParsedListing;
}

// ---------------------------------------------------------------------------
// Provider comps
// ---------------------------------------------------------------------------

export interface ProviderComp {
  productKey: string;
  provider: string;
  valueCents: number;
  basis: string;
  sampleSize: number | null;
  fetchedAt: string;
  detail: Record<string, unknown> | null;
}

export function saveProviderComp(comp: Omit<ProviderComp, 'fetchedAt'>, db: Db = getDb()): void {
  db.prepare(`
    INSERT INTO provider_comps (product_key, provider, value_cents, basis, sample_size, fetched_at, detail_json)
    VALUES (@productKey, @provider, @valueCents, @basis, @sampleSize, @fetchedAt, @detailJson)
    ON CONFLICT(product_key, provider) DO UPDATE SET
      value_cents = excluded.value_cents, basis = excluded.basis,
      sample_size = excluded.sample_size, fetched_at = excluded.fetched_at,
      detail_json = excluded.detail_json
  `).run({
    productKey: comp.productKey,
    provider: comp.provider,
    valueCents: comp.valueCents,
    basis: comp.basis,
    sampleSize: comp.sampleSize,
    fetchedAt: new Date().toISOString(),
    detailJson: comp.detail ? JSON.stringify(comp.detail) : null,
  });
}

export function getProviderComp(productKey: string, db: Db = getDb()): ProviderComp | null {
  const row = db
    .prepare('SELECT * FROM provider_comps WHERE product_key = ? ORDER BY fetched_at DESC LIMIT 1')
    .get(productKey) as
    | { product_key: string; provider: string; value_cents: number; basis: string; sample_size: number | null; fetched_at: string; detail_json: string | null }
    | undefined;
  if (!row) return null;
  return {
    productKey: row.product_key,
    provider: row.provider,
    valueCents: row.value_cents,
    basis: row.basis,
    sampleSize: row.sample_size,
    fetchedAt: row.fetched_at,
    detail: row.detail_json ? (JSON.parse(row.detail_json) as Record<string, unknown>) : null,
  };
}

/**
 * Product keys that would benefit from a comp lookup: seen recently, and
 * either never quoted or quoted long enough ago to be stale.
 */
export function productKeysNeedingComps(
  staleBeforeIso: string,
  limit: number,
  db: Db = getDb(),
): Array<{ product_key: string; parse_json: string }> {
  return db
    .prepare(`
      SELECT l.product_key, MIN(l.parse_json) AS parse_json
      FROM listings l
      LEFT JOIN provider_comps pc ON pc.product_key = l.product_key
      WHERE l.product_key IS NOT NULL
        AND l.gone_at IS NULL
        AND l.sealed = 0
        AND (pc.fetched_at IS NULL OR pc.fetched_at < @stale)
      GROUP BY l.product_key
      ORDER BY COUNT(*) DESC
      LIMIT @limit
    `)
    .all({ stale: staleBeforeIso, limit }) as ReturnType<typeof productKeysNeedingComps>;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Delete stored marketplace listings older than a cutoff.
 *
 * eBay's API License Agreement permits only "limited intermediate copies" of
 * their data, to be deleted when no longer needed, so listing rows are treated
 * as an expiring cache. The derived price observations are our own
 * measurements and are kept — that is what makes the market baselines improve
 * over time without retaining anyone else's catalog.
 */
export function purgeOldListings(cutoffIso: string, db: Db = getDb()): number {
  return db
    .prepare('DELETE FROM listings WHERE (gone_at IS NOT NULL AND gone_at < @cutoff) OR last_seen_at < @cutoff')
    .run({ cutoff: cutoffIso }).changes;
}
