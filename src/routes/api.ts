/** HTTP API. The web UI talks only to these endpoints. */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { allocate } from '../domain/money.js';
import { getDb } from '../db/index.js';
import { recentAudit, auditHistory } from '../db/audit.js';
import {
  createExpense, createPayout, createSale, createSubmission, createTrip,
  deleteExpense, deleteItem, deleteLot, deleteSale, deleteTrip,
  getItem, getProfile, listExpenses, listItems, listLots, listPayouts,
  listSales, listSubmissions, listTrips, saleLines, setComplianceStatus,
  submissionItems, updateExpense, updateItem, updateProfile, complianceStatuses,
} from '../db/repos.js';
import { recordPurchase, reallocateLot } from '../ledger/purchases.js';
import { openSealedItem, reallocateOpening, receiveGradedCards, withdrawToPersonalUse } from '../ledger/inventory.js';
import { profitAndLoss } from '../reports/profitLoss.js';
import { cogsForYear } from '../reports/cogs.js';
import { inventoryAsOf } from '../reports/inventory.js';
import { capitalGainsForYear, investmentSchedule } from '../reports/capitalGains.js';
import { scheduleCWorksheet } from '../reports/scheduleCWorksheet.js';
import { exportYear } from '../reports/export.js';
import { estimatedTaxPlan } from '../tax/estimatedTax.js';
import { selfEmploymentTax, setAsideGuidance } from '../tax/selfEmployment.js';
import { availableYears, figureHealth, taxYear } from '../tax/registry.js';
import { ACCOUNTS, SCHEDULE_C_LINES, selectableAccounts } from '../tax/scheduleC.js';
import { complianceChecklist } from '../compliance/checklist.js';
import { guidanceFor } from '../compliance/guidance.js';
import { upcomingDeadlines } from '../compliance/calendar.js';
import { logger } from '../util/logger.js';

const log = logger('api');
export const api = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');
const cents = z.number().int();

function fail(res: Response, status: number, error: string, details?: unknown): void {
  res.status(status).json({ error, details });
}

/** Wraps a handler so a thrown domain error becomes a readable message. */
function handle(fn: (req: Request, res: Response) => void | Promise<void>) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      log.warn(`${req.method} ${req.path} failed`, message);
      fail(res, 400, message);
    }
  };
}

// ---------------------------------------------------------------------------
// Status and reference data
// ---------------------------------------------------------------------------

api.get('/health', (_req, res) => {
  const db = getDb();
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM inventory_items WHERE status IN ('on-hand','listed','at-grading')) AS onHand,
      (SELECT COUNT(*) FROM purchase_lots) AS purchases,
      (SELECT COUNT(*) FROM sales) AS sales,
      (SELECT COUNT(*) FROM expenses) AS expenses,
      (SELECT COUNT(*) FROM mileage_trips) AS trips,
      (SELECT COUNT(*) FROM grading_submissions WHERE returned_on IS NULL) AS atGrading
  `).get();

  res.json({
    ok: true,
    taxYear: config.taxYear,
    availableTaxYears: availableYears(),
    figureHealth: figureHealth(config.taxYear),
    counts,
    profile: getProfile(),
  });
});

api.get('/accounts', (_req, res) => {
  res.json({
    accounts: selectableAccounts(),
    allAccounts: ACCOUNTS,
    scheduleCLines: SCHEDULE_C_LINES,
  });
});

api.get('/tax/figures/:year', (req, res) => {
  const year = Number(req.params.year);
  const figures = taxYear(year);
  if (!figures) {
    fail(res, 404, `No tax figures on file for ${year}.`);
    return;
  }
  res.json({
    year: figures.year,
    reviewed: figures.reviewed,
    reviewedOn: figures.reviewedOn,
    figures: Object.values(figures.figures),
    health: figureHealth(year),
  });
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  businessName: z.string().max(200).optional(),
  ownerName: z.string().max(200).optional(),
  entityType: z.enum(['sole-proprietor', 'single-member-llc', 'multi-member-llc', 's-corp', 'c-corp']).optional(),
  ein: z.string().max(20).nullable().optional(),
  state: z.string().length(2).optional(),
  county: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  accountingMethod: z.enum(['cash', 'accrual']).optional(),
  inventoryMethod: z.enum(['inventory', 'materials-and-supplies']).optional(),
  startedOn: isoDate.nullable().optional(),
  filingStatus: z.enum(['single', 'married-joint', 'married-separate', 'head-of-household', 'qualifying-surviving-spouse']).optional(),
  otherIncomeCents: cents.optional(),
  otherWithholdingCents: cents.optional(),
  priorYearTaxCents: cents.nullable().optional(),
  priorYearAgiCents: cents.nullable().optional(),
  homeOfficeSqFt: z.number().nullable().optional(),
  homeTotalSqFt: z.number().nullable().optional(),
});

api.get('/profile', (_req, res) => res.json(getProfile()));

api.put('/profile', handle((req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid profile', parsed.error.flatten());
  res.json(updateProfile(parsed.data));
}));

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

const purchaseItemSchema = z.object({
  description: z.string().min(1).max(300),
  kind: z.enum(['single', 'sealed', 'sealed-to-open', 'supply', 'equipment']),
  holdingIntent: z.enum(['inventory', 'investment']).optional(),
  quantity: z.number().int().positive().optional(),
  category: z.string().max(100).nullable().optional(),
  setName: z.string().max(200).nullable().optional(),
  year: z.number().int().nullable().optional(),
  estimatedValueCents: cents.nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  manualBasisCents: cents.optional(),
});

const purchaseSchema = z.object({
  lot: z.object({
    purchasedOn: isoDate,
    vendor: z.string().max(200).default(''),
    channel: z.enum(['card-show', 'online-marketplace', 'retail-store', 'distributor', 'private-sale', 'trade', 'personal-collection', 'other']),
    description: z.string().max(500).default(''),
    subtotalCents: cents.nonnegative(),
    shippingCents: cents.nonnegative().default(0),
    taxCents: cents.nonnegative().default(0),
    feesCents: cents.nonnegative().default(0),
    paymentMethod: z.string().max(100).nullable().default(null),
    resaleExemptionUsed: z.boolean().default(false),
    notes: z.string().max(2000).nullable().default(null),
    receiptPath: z.string().max(500).nullable().default(null),
  }),
  items: z.array(purchaseItemSchema).min(1),
  allocationMethod: z.enum(['relative-fmv', 'equal', 'manual']).optional(),
});

api.get('/purchases', (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  res.json({ purchases: listLots({ from, to }) });
});

api.post('/purchases', handle((req, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid purchase', parsed.error.flatten());
  res.status(201).json(recordPurchase(parsed.data));
}));

api.post('/purchases/:id/reallocate', handle((req, res) => {
  const method = z.enum(['relative-fmv', 'equal']).parse(req.body?.method ?? 'relative-fmv');
  res.json(reallocateLot(Number(req.params.id), method));
}));

api.delete('/purchases/:id', handle((req, res) => {
  res.json({ deleted: deleteLot(Number(req.params.id), typeof req.body?.reason === 'string' ? req.body.reason : undefined) });
}));

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

api.get('/items', (req, res) => {
  const q = req.query;
  res.json(listItems({
    status: typeof q.status === 'string' ? (q.status.split(',') as never) : undefined,
    kind: typeof q.kind === 'string' ? (q.kind.split(',') as never) : undefined,
    holdingIntent: q.holdingIntent === 'investment' || q.holdingIntent === 'inventory' ? q.holdingIntent : undefined,
    lotId: typeof q.lotId === 'string' ? Number(q.lotId) : undefined,
    parentItemId: typeof q.parentItemId === 'string' ? Number(q.parentItemId) : undefined,
    search: typeof q.search === 'string' ? q.search : undefined,
    limit: typeof q.limit === 'string' ? Number(q.limit) : undefined,
    offset: typeof q.offset === 'string' ? Number(q.offset) : undefined,
  }));
});

api.get('/items/:id', (req, res) => {
  const item = getItem(Number(req.params.id));
  if (!item) return fail(res, 404, 'Item not found');
  res.json({ item, history: auditHistory('inventory_items', item.id) });
});

const itemPatchSchema = purchaseItemSchema.partial().extend({
  status: z.enum(['on-hand', 'listed', 'at-grading', 'sold', 'opened', 'personal-use', 'lost', 'donated']).optional(),
  gradedBy: z.string().max(50).nullable().optional(),
  grade: z.string().max(20).nullable().optional(),
  certNumber: z.string().max(50).nullable().optional(),
  basisCents: cents.optional(),
  reason: z.string().max(500).optional(),
});

api.patch('/items/:id', handle((req, res) => {
  const parsed = itemPatchSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid item', parsed.error.flatten());
  const { reason, ...patch } = parsed.data;
  const updated = updateItem(Number(req.params.id), patch as never, reason);
  if (!updated) return fail(res, 404, 'Item not found');
  res.json(updated);
}));

api.delete('/items/:id', handle((req, res) => {
  res.json({ deleted: deleteItem(Number(req.params.id), typeof req.body?.reason === 'string' ? req.body.reason : undefined) });
}));

const openSchema = z.object({
  openedOn: isoDate,
  contents: z.array(purchaseItemSchema).min(1),
  allocationMethod: z.enum(['relative-fmv', 'equal', 'manual']).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

api.post('/items/:id/open', handle((req, res) => {
  const parsed = openSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid opening', parsed.error.flatten());
  res.status(201).json(openSealedItem({ itemId: Number(req.params.id), ...parsed.data }));
}));

api.post('/items/:id/reallocate', handle((req, res) => {
  const method = z.enum(['relative-fmv', 'equal']).parse(req.body?.method ?? 'relative-fmv');
  res.json(reallocateOpening(Number(req.params.id), method));
}));

api.post('/items/:id/withdraw', handle((req, res) => {
  const reason = z.string().min(1).max(500).parse(req.body?.reason);
  const item = withdrawToPersonalUse(Number(req.params.id), reason);
  if (!item) return fail(res, 404, 'Item not found');
  res.json(item);
}));

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

const saleSchema = z.object({
  soldOn: isoDate,
  channel: z.enum(['ebay', 'whatnot', 'tcgplayer', 'comc', 'mercari', 'fanatics-collect', 'card-show', 'local-in-person', 'website', 'other']),
  orderRef: z.string().max(200).nullable().default(null),
  buyerState: z.string().max(2).nullable().default(null),
  grossCents: cents.nonnegative(),
  shippingChargedCents: cents.nonnegative().default(0),
  salesTaxCollectedCents: cents.nonnegative().default(0),
  salesTaxRemittedByPlatform: z.boolean().default(true),
  platformFeeCents: cents.nonnegative().default(0),
  paymentProcessingFeeCents: cents.nonnegative().default(0),
  shippingCostCents: cents.nonnegative().default(0),
  otherFeeCents: cents.nonnegative().default(0),
  refundedCents: cents.nonnegative().default(0),
  notes: z.string().max(2000).nullable().default(null),
  lines: z.array(z.object({
    itemId: z.number().int().positive(),
    quantity: z.number().int().positive().default(1),
    allocatedGrossCents: cents.optional(),
  })).min(1),
});

api.get('/sales', (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const sales = listSales({ from, to });
  res.json({ sales: sales.map((s) => ({ ...s, lines: saleLines(s.id) })) });
});

api.post('/sales', handle((req, res) => {
  const parsed = saleSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid sale', parsed.error.flatten());
  const { lines, ...sale } = parsed.data;

  // Split the sale price across its items by their recorded value, and relieve
  // each item's own basis into cost of goods sold.
  const items = lines.map((l) => {
    const item = getItem(l.itemId);
    if (!item) throw new Error(`Item ${l.itemId} does not exist.`);
    return { line: l, item };
  });

  const explicit = items.every((i) => i.line.allocatedGrossCents !== undefined);
  const weights = items.map((i) => i.item.estimatedValueCents ?? 1);
  const allocated = explicit
    ? items.map((i) => i.line.allocatedGrossCents!)
    : allocateGross(sale.grossCents, weights);

  res.status(201).json(createSale(sale, items.map((i, idx) => ({
    itemId: i.item.id,
    quantity: i.line.quantity,
    allocatedGrossCents: allocated[idx]!,
    cogsCents: i.item.basisCents,
  }))));
}));

api.delete('/sales/:id', handle((req, res) => {
  res.json({ deleted: deleteSale(Number(req.params.id), typeof req.body?.reason === 'string' ? req.body.reason : undefined) });
}));

// ---------------------------------------------------------------------------
// Expenses, mileage, payouts, grading
// ---------------------------------------------------------------------------

const expenseSchema = z.object({
  incurredOn: isoDate,
  accountKey: z.string().min(1).max(50),
  vendor: z.string().max(200).nullable().default(null),
  description: z.string().max(500).default(''),
  amountCents: cents,
  businessUsePercent: z.number().min(0).max(100).default(100),
  paymentMethod: z.string().max(100).nullable().default(null),
  receiptPath: z.string().max(500).nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
});

api.get('/expenses', (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  res.json({ expenses: listExpenses({ from, to }) });
});

api.post('/expenses', handle((req, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid expense', parsed.error.flatten());
  res.status(201).json(createExpense(parsed.data));
}));

api.patch('/expenses/:id', handle((req, res) => {
  const parsed = expenseSchema.partial().safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid expense', parsed.error.flatten());
  const updated = updateExpense(Number(req.params.id), parsed.data, 'Edited');
  if (!updated) return fail(res, 404, 'Expense not found');
  res.json(updated);
}));

api.delete('/expenses/:id', handle((req, res) => {
  res.json({ deleted: deleteExpense(Number(req.params.id), undefined) });
}));

const mileageSchema = z.object({
  drivenOn: isoDate,
  purpose: z.string().min(1).max(300),
  fromLocation: z.string().max(200).nullable().default(null),
  toLocation: z.string().max(200).nullable().default(null),
  miles: z.number().positive(),
  roundTrip: z.boolean().default(false),
  odometerStart: z.number().nullable().default(null),
  odometerEnd: z.number().nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
});

api.get('/mileage', (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  res.json({ trips: listTrips({ from, to }) });
});

api.post('/mileage', handle((req, res) => {
  const parsed = mileageSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid trip', parsed.error.flatten());
  res.status(201).json(createTrip(parsed.data));
}));

api.delete('/mileage/:id', handle((req, res) => {
  res.json({ deleted: deleteTrip(Number(req.params.id), undefined) });
}));

const payoutSchema = z.object({
  channel: z.enum(['ebay', 'whatnot', 'tcgplayer', 'comc', 'mercari', 'fanatics-collect', 'card-show', 'local-in-person', 'website', 'other']),
  receivedOn: isoDate,
  periodStart: isoDate.nullable().default(null),
  periodEnd: isoDate.nullable().default(null),
  grossCents: cents.default(0),
  feesCents: cents.default(0),
  refundsCents: cents.default(0),
  shippingLabelsCents: cents.default(0),
  salesTaxCents: cents.default(0),
  netCents: cents.default(0),
  reference: z.string().max(200).nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
});

api.get('/payouts', (_req, res) => res.json({ payouts: listPayouts() }));

api.post('/payouts', handle((req, res) => {
  const parsed = payoutSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid payout', parsed.error.flatten());
  res.status(201).json(createPayout(parsed.data));
}));

const submissionSchema = z.object({
  grader: z.string().min(1).max(50),
  serviceLevel: z.string().max(100).nullable().default(null),
  submittedOn: isoDate,
  returnedOn: isoDate.nullable().default(null),
  submissionNumber: z.string().max(100).nullable().default(null),
  feeCents: cents.nonnegative().default(0),
  shippingToCents: cents.nonnegative().default(0),
  shippingBackCents: cents.nonnegative().default(0),
  insuranceCents: cents.nonnegative().default(0),
  notes: z.string().max(2000).nullable().default(null),
  itemIds: z.array(z.number().int().positive()).min(1),
});

api.get('/grading', (_req, res) => {
  res.json({
    submissions: listSubmissions().map((s) => ({ ...s, items: submissionItems(s.id) })),
  });
});

api.post('/grading', handle((req, res) => {
  const parsed = submissionSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid submission', parsed.error.flatten());
  const { itemIds, ...submission } = parsed.data;
  res.status(201).json(createSubmission(submission, itemIds));
}));

const receiveSchema = z.object({
  returnedOn: isoDate,
  results: z.array(z.object({
    itemId: z.number().int().positive(),
    grade: z.string().max(20).nullable(),
    certNumber: z.string().max(50).nullable().optional(),
    estimatedValueCents: cents.nullable().optional(),
  })),
  allocationMethod: z.enum(['equal', 'relative-fmv']).optional(),
});

api.post('/grading/:id/receive', handle((req, res) => {
  const parsed = receiveSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid results', parsed.error.flatten());
  res.json(receiveGradedCards({ submissionId: Number(req.params.id), ...parsed.data }));
}));

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function yearParam(req: Request): number {
  const raw = Number(req.query.year ?? config.taxYear);
  return Number.isFinite(raw) ? raw : config.taxYear;
}

api.get('/reports/profit-loss', (req, res) => {
  const year = yearParam(req);
  const worksheet = scheduleCWorksheet(year);
  res.json(worksheet.profitLoss);
});

api.get('/reports/cogs', (req, res) => res.json(cogsForYear(yearParam(req))));

api.get('/reports/inventory', (req, res) => {
  const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : `${yearParam(req)}-12-31`;
  res.json(inventoryAsOf(asOf));
});

api.get('/reports/capital-gains', (req, res) => res.json(capitalGainsForYear(yearParam(req))));

api.get('/reports/investment-schedule', (_req, res) => res.json(investmentSchedule()));

api.get('/reports/schedule-c', (req, res) => res.json(scheduleCWorksheet(yearParam(req))));

api.get('/reports/estimated-tax', handle((req, res) => {
  const year = yearParam(req);
  const profile = getProfile();
  const figures = taxYear(year);
  const worksheet = scheduleCWorksheet(year);

  const se = worksheet.selfEmployment;
  // Income tax is not modelled here — brackets and the standard deduction have
  // not been verified — so the projection covers self-employment tax only and
  // says so, rather than inventing a number.
  const projectedTax = se ? se.totalCents : 0;

  const plan = estimatedTaxPlan({
    year,
    projectedTaxCents: projectedTax,
    priorYearTaxCents: profile.priorYearTaxCents,
    priorYearAgiCents: profile.priorYearAgiCents,
    withholdingCents: profile.otherWithholdingCents,
  });

  res.json({
    ...plan,
    projectionBasis:
      'Self-employment tax on the profit recorded so far. Federal income tax is NOT included — the brackets ' +
      'and standard deduction for this year have not been verified in this app, so adding them would be a ' +
      'guess. Treat this as a floor, not a total.',
    selfEmployment: se,
    setAside: setAsideGuidance(null),
    figuresNeedingCheck: worksheet.figuresNeedingCheck,
    hasFigures: figures !== null,
  });
}));

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

api.get('/export/:year', handle((req, res) => {
  const year = Number(req.params.year);
  if (!Number.isFinite(year)) return fail(res, 400, 'Invalid year');
  res.json({ year, files: exportYear(year) });
}));

/** A single CSV, for downloading one table straight into a spreadsheet. */
api.get('/export/:year/:file', handle((req, res) => {
  const year = Number(req.params.year);
  const files = exportYear(year);
  const name = Object.keys(files).find((f) => f.includes(String(req.params.file)));
  if (!name) return fail(res, 404, `No export file matching "${req.params.file}"`);
  res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(files[name]);
}));

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

api.get('/guidance', handle((_req, res) => {
  res.json({ guidance: guidanceFor() });
}));

api.get('/compliance', (_req, res) => {
  const profile = getProfile();
  const statuses = new Map(complianceStatuses().map((s) => [s.task_id, s]));
  const tasks = complianceChecklist(profile).map((task): Record<string, unknown> => {
    const status = statuses.get(task.id);
    return {
      ...task,
      completed: status?.completed === 1,
      completedOn: status?.completed_on ?? null,
      reference: status?.reference ?? null,
      notes: status?.notes ?? null,
      notApplicable: status?.not_applicable === 1,
    };
  });
  res.json({ tasks, deadlines: upcomingDeadlines(config.taxYear, new Date()) });
});

api.put('/compliance/:taskId', handle((req, res) => {
  const parsed = z.object({
    completed: z.boolean().optional(),
    completedOn: isoDate.nullable().optional(),
    reference: z.string().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    notApplicable: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid status', parsed.error.flatten());
  setComplianceStatus(String(req.params.taskId), parsed.data);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

api.get('/audit', (req, res) => {
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
  res.json({ entries: recentAudit(Math.min(500, Math.max(1, limit))) });
});

/** Split a sale price across its lines by recorded value, exact to the cent. */
function allocateGross(total: number, weights: number[]): number[] {
  return allocate(total, weights);
}

export function apiErrorHandler(err: unknown, _req: Request, res: Response, _next: unknown): void {
  log.error('Unhandled API error', err instanceof Error ? (err.stack ?? err.message) : String(err));
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
}
