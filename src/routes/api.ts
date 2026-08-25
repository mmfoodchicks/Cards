/** HTTP API. The web UI talks only to these endpoints. */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { loadCatalog } from '../catalog/msrpCatalog.js';
import { getDb } from '../db/index.js';
import {
  createWatch,
  deleteWatch,
  dismissAlert,
  getListing,
  getWatch,
  listMsrpOverrides,
  listWatches,
  queryListings,
  recentScanRuns,
  saveMsrpOverride,
  updateWatch,
  type DealFilter,
} from '../db/repos.js';
import { enrichListing } from '../pipeline/ingest.js';
import { rebuildBaselines, sweepVanishedListings } from '../pipeline/baselines.js';
import { runWatch } from '../pipeline/scanner.js';
import { LABEL_META } from '../pricing/score.js';
import { ebayLimiter } from '../sources/ebayBrowse.js';
import { allSources, defaultSourceIds, getSource } from '../sources/registry.js';
import { allCompProviders } from '../sources/comps/registry.js';
import { notificationsConfigured } from '../notify/index.js';
import type { Category, DealLabel, ProductType } from '../types.js';
import { logger } from '../util/logger.js';
import { scoredToDto, toListingDto } from './serialize.js';

const log = logger('api');
export const api = Router();

// ---------------------------------------------------------------------------
// Health and metadata
// ---------------------------------------------------------------------------

api.get('/health', (_req, res) => {
  const db = getDb();
  const counts = db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM listings WHERE gone_at IS NULL) AS listings,
        (SELECT COUNT(*) FROM listings WHERE gone_at IS NULL AND under_msrp = 1) AS underMsrp,
        (SELECT COUNT(*) FROM price_observations) AS observations,
        (SELECT COUNT(*) FROM baselines) AS baselines,
        (SELECT COUNT(*) FROM watches WHERE enabled = 1) AS activeWatches,
        (SELECT COUNT(*) FROM alerts WHERE dismissed = 0) AS alerts
    `)
    .get();

  res.json({
    ok: true,
    counts,
    quota: ebayLimiter.status(),
    scheduler: { enabled: config.scheduler.enabled, tickSeconds: config.scheduler.tickSeconds },
    notifications: { configured: notificationsConfigured() },
    sources: allSources().map((s) => ({
      id: s.id,
      name: s.displayName,
      configured: s.isConfigured(),
      reason: s.unavailableReason(),
      capabilities: s.capabilities,
    })),
    defaultSources: defaultSourceIds(),
    compProviders: allCompProviders().map((p) => ({
      id: p.id,
      name: p.displayName,
      configured: p.isConfigured(),
      reason: p.unavailableReason(),
    })),
  });
});

api.get('/meta', (_req, res) => {
  const catalog = loadCatalog();
  res.json({
    labels: Object.entries(LABEL_META).map(([id, meta]) => ({ id, ...meta })),
    categories: [...new Set(catalog.entries.map((e) => e.category))].sort(),
    productTypes: [...new Set(catalog.entries.map((e) => e.productType))].sort(),
    sets: [...new Map(catalog.entries.map((e) => [e.setSlug, { slug: e.setSlug, name: e.setName, category: e.category }])).values()],
    currency: config.currency,
    estTaxRate: config.estTaxRate,
  });
});

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

const dealsQuerySchema = z.object({
  labels: z.string().optional(),
  underMsrpOnly: z.coerce.boolean().optional(),
  category: z.string().optional(),
  productType: z.string().optional(),
  sealedOnly: z.coerce.boolean().optional(),
  gradedOnly: z.coerce.boolean().optional(),
  minDiscountPct: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  watchId: z.coerce.number().optional(),
  source: z.string().optional(),
  endingWithinHours: z.coerce.number().optional(),
  includeGone: z.coerce.boolean().optional(),
  search: z.string().optional(),
  sort: z.enum(['score', 'discount', 'newest', 'ending', 'price']).optional(),
  limit: z.coerce.number().min(1).max(500).optional(),
  offset: z.coerce.number().min(0).optional(),
});

api.get('/deals', (req, res) => {
  const parsed = dealsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    return;
  }
  const q = parsed.data;

  const filter: DealFilter = {
    labels: q.labels ? (q.labels.split(',').filter(Boolean) as DealLabel[]) : undefined,
    underMsrpOnly: q.underMsrpOnly,
    category: (q.category as Category | undefined) ?? null,
    productType: (q.productType as ProductType | undefined) ?? null,
    sealedOnly: q.sealedOnly,
    gradedOnly: q.gradedOnly,
    minDiscountPct: q.minDiscountPct != null ? q.minDiscountPct / 100 : null,
    maxUnitCents: q.maxPrice != null ? Math.round(q.maxPrice * 100) : null,
    watchId: q.watchId ?? null,
    source: q.source ?? null,
    endingWithinHours: q.endingWithinHours ?? null,
    includeGone: q.includeGone ?? false,
    search: q.search ?? null,
    sort: q.sort ?? 'score',
    limit: q.limit ?? 60,
    offset: q.offset ?? 0,
  };

  const { rows, total } = queryListings(filter);
  res.json({ total, listings: rows.map(toListingDto) });
});

api.get('/deals/:id', (req, res) => {
  const row = getListing(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }
  res.json(toListingDto(row));
});

// ---------------------------------------------------------------------------
// Ad-hoc search: run a query right now without saving a watch
// ---------------------------------------------------------------------------

const searchSchema = z.object({
  q: z.string().min(1).max(100),
  sources: z.array(z.string()).optional(),
  category: z.string().optional(),
  productType: z.string().optional(),
  sealedOnly: z.boolean().optional(),
  gradedOnly: z.boolean().optional(),
  includeAuctions: z.boolean().optional(),
  minPrice: z.number().optional(),
  maxPrice: z.number().optional(),
  limit: z.number().min(1).max(200).optional(),
});

api.post('/search', async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid search', details: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;
  const sourceIds = input.sources?.length ? input.sources : defaultSourceIds();

  const listings = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const id of sourceIds) {
    const source = getSource(id);
    if (!source) {
      errors.push(`Unknown source "${id}".`);
      continue;
    }
    if (!source.isConfigured()) {
      warnings.push(`${source.displayName}: ${source.unavailableReason() ?? 'not configured'}`);
      continue;
    }
    try {
      const found = await source.search({
        q: input.q,
        category: (input.category as Category | undefined) ?? null,
        productType: (input.productType as ProductType | undefined) ?? null,
        minPriceCents: input.minPrice != null ? Math.round(input.minPrice * 100) : null,
        maxPriceCents: input.maxPrice != null ? Math.round(input.maxPrice * 100) : null,
        condition: input.gradedOnly ? 'graded' : 'any',
        sealedOnly: input.sealedOnly ?? false,
        includeAuctions: input.includeAuctions ?? true,
        limit: input.limit ?? 100,
      });
      warnings.push(...found.warnings);
      // Scored but NOT stored: an exploratory search should not pollute the
      // price history that saved watches build up.
      listings.push(...found.listings.map((raw) => enrichListing(raw)));
    } catch (err) {
      errors.push(`${source.displayName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  listings.sort((a, b) => b.score - a.score);
  res.json({
    warnings: [...new Set(warnings)],
    errors,
    total: listings.length,
    listings: listings.map(scoredToDto),
  });
});

// ---------------------------------------------------------------------------
// Watches
// ---------------------------------------------------------------------------

const watchSchema = z.object({
  name: z.string().min(1).max(120),
  query: z.string().min(1).max(100),
  sources: z.array(z.string()).default([]),
  category: z.string().nullable().default(null),
  productType: z.string().nullable().default(null),
  minPriceCents: z.number().int().nullable().default(null),
  maxPriceCents: z.number().int().nullable().default(null),
  minDiscountPct: z.number().min(0).max(1).default(0.1),
  sealedOnly: z.boolean().default(false),
  gradedOnly: z.boolean().default(false),
  excludeLots: z.boolean().default(true),
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().int().min(5).max(1440).default(30),
});

api.get('/watches', (_req, res) => {
  res.json({ watches: listWatches() });
});

api.post('/watches', (req, res) => {
  const parsed = watchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid watch', details: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;
  const watch = createWatch({
    ...input,
    sources: input.sources.length > 0 ? input.sources : defaultSourceIds(),
    category: input.category as Category | null,
    productType: input.productType as ProductType | null,
  });
  res.status(201).json(watch);
});

api.patch('/watches/:id', (req, res) => {
  const id = Number(req.params.id);
  const parsed = watchSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid watch', details: parsed.error.flatten() });
    return;
  }
  const updated = updateWatch(id, parsed.data as never);
  if (!updated) {
    res.status(404).json({ error: 'Watch not found' });
    return;
  }
  res.json(updated);
});

api.delete('/watches/:id', (req, res) => {
  res.json({ deleted: deleteWatch(Number(req.params.id)) });
});

api.post('/watches/:id/run', async (req, res) => {
  const watch = getWatch(Number(req.params.id));
  if (!watch) {
    res.status(404).json({ error: 'Watch not found' });
    return;
  }
  try {
    const result = await runWatch(watch);
    res.json({
      seen: result.seen,
      newListings: result.newListings,
      deals: result.deals,
      callsUsed: result.callsUsed,
      warnings: result.warnings,
      errors: result.errors,
    });
  } catch (err) {
    log.error('Manual watch run failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: err instanceof Error ? err.message : 'Scan failed' });
  }
});

// ---------------------------------------------------------------------------
// MSRP catalog
// ---------------------------------------------------------------------------

api.get('/catalog', (req, res) => {
  const catalog = loadCatalog();
  const overrides = new Map(listMsrpOverrides().map((o) => [o.entryId, o]));
  const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : null;

  const entries = catalog.entries
    .map((entry) => {
      const override = overrides.get(entry.id);
      return {
        ...entry,
        msrpCents: override?.msrpCents ?? entry.msrpCents,
        confidence: override?.confidence ?? entry.confidence,
        edited: override != null,
        note: override?.note ?? null,
        deleted: override?.deleted ?? false,
      };
    })
    .filter((e) => !e.deleted)
    .filter((e) => !search || `${e.setName} ${e.productType} ${e.brand} ${e.year}`.toLowerCase().includes(search));

  res.json({ entries, defaults: catalog.defaults });
});

const overrideSchema = z.object({
  msrpCents: z.number().int().positive().nullable(),
  confidence: z.enum(['high', 'medium', 'low']).nullable().default(null),
  note: z.string().max(500).nullable().default(null),
  deleted: z.boolean().default(false),
});

api.put('/catalog/:entryId', (req, res) => {
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid override', details: parsed.error.flatten() });
    return;
  }
  saveMsrpOverride({ entryId: req.params.entryId, ...parsed.data, payload: null });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Maintenance and diagnostics
// ---------------------------------------------------------------------------

api.post('/maintenance/rebuild-baselines', (_req, res) => {
  const sweep = sweepVanishedListings();
  const rebuild = rebuildBaselines();
  res.json({ sweep, rebuild });
});

api.get('/scans', (_req, res) => {
  res.json({ runs: recentScanRuns(25) });
});

api.post('/alerts/:id/dismiss', (req, res) => {
  dismissAlert(Number(req.params.id));
  res.json({ ok: true });
});

/** Express error handler, registered by the server. */
export function apiErrorHandler(err: unknown, _req: Request, res: Response, _next: unknown): void {
  log.error('Unhandled API error', err instanceof Error ? err.stack ?? err.message : String(err));
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
}
