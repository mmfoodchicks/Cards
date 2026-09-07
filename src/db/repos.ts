/** Data access. All SQL lives here. */

import type { Db } from './index.js';
import { getDb } from './index.js';
import { recordAudit } from './audit.js';
import type {
  BusinessProfile,
  Expense,
  GradingSubmission,
  InventoryItem,
  IsoDate,
  MileageTrip,
  Payout,
  PurchaseLot,
  Sale,
} from '../domain/types.js';

const now = (): string => new Date().toISOString();

// ---------------------------------------------------------------------------
// Business profile
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: number; business_name: string; owner_name: string; entity_type: string; ein: string | null;
  state: string; county: string; city: string; accounting_method: string; inventory_method: string;
  started_on: string | null; filing_status: string; other_income_cents: number;
  other_withholding_cents: number; prior_year_tax_cents: number | null; prior_year_agi_cents: number | null;
  home_office_sqft: number | null; home_total_sqft: number | null; updated_at: string;
}

function toProfile(row: ProfileRow): BusinessProfile {
  return {
    id: row.id,
    businessName: row.business_name,
    ownerName: row.owner_name,
    entityType: row.entity_type as BusinessProfile['entityType'],
    ein: row.ein,
    state: row.state,
    county: row.county,
    city: row.city,
    accountingMethod: row.accounting_method as BusinessProfile['accountingMethod'],
    inventoryMethod: row.inventory_method as BusinessProfile['inventoryMethod'],
    startedOn: row.started_on,
    filingStatus: row.filing_status as BusinessProfile['filingStatus'],
    otherIncomeCents: row.other_income_cents,
    otherWithholdingCents: row.other_withholding_cents,
    priorYearTaxCents: row.prior_year_tax_cents,
    priorYearAgiCents: row.prior_year_agi_cents,
    homeOfficeSqFt: row.home_office_sqft,
    homeTotalSqFt: row.home_total_sqft,
    updatedAt: row.updated_at,
  };
}

export function getProfile(db: Db = getDb()): BusinessProfile {
  const row = db.prepare('SELECT * FROM business_profile WHERE id = 1').get() as ProfileRow | undefined;
  if (row) return toProfile(row);
  db.prepare('INSERT INTO business_profile (id, updated_at) VALUES (1, ?)').run(now());
  return toProfile(db.prepare('SELECT * FROM business_profile WHERE id = 1').get() as ProfileRow);
}

export function updateProfile(patch: Partial<BusinessProfile>, db: Db = getDb()): BusinessProfile {
  const before = getProfile(db);
  const merged = { ...before, ...patch };
  db.prepare(`
    UPDATE business_profile SET
      business_name = @businessName, owner_name = @ownerName, entity_type = @entityType, ein = @ein,
      state = @state, county = @county, city = @city, accounting_method = @accountingMethod,
      inventory_method = @inventoryMethod, started_on = @startedOn, filing_status = @filingStatus,
      other_income_cents = @otherIncomeCents, other_withholding_cents = @otherWithholdingCents,
      prior_year_tax_cents = @priorYearTaxCents, prior_year_agi_cents = @priorYearAgiCents,
      home_office_sqft = @homeOfficeSqFt, home_total_sqft = @homeTotalSqFt, updated_at = @updatedAt
    WHERE id = 1
  `).run({ ...merged, updatedAt: now() });
  const after = getProfile(db);
  recordAudit('business_profile', 1, 'update', before, after, undefined, db);
  return after;
}

// ---------------------------------------------------------------------------
// Purchase lots
// ---------------------------------------------------------------------------

interface LotRow {
  id: number; purchased_on: string; vendor: string; channel: string; description: string;
  subtotal_cents: number; shipping_cents: number; tax_cents: number; fees_cents: number;
  payment_method: string | null; resale_exemption_used: number; notes: string | null;
  receipt_path: string | null; created_at: string;
}

function toLot(row: LotRow): PurchaseLot {
  return {
    id: row.id,
    purchasedOn: row.purchased_on,
    vendor: row.vendor,
    channel: row.channel as PurchaseLot['channel'],
    description: row.description,
    subtotalCents: row.subtotal_cents,
    shippingCents: row.shipping_cents,
    taxCents: row.tax_cents,
    feesCents: row.fees_cents,
    paymentMethod: row.payment_method,
    resaleExemptionUsed: row.resale_exemption_used === 1,
    notes: row.notes,
    receiptPath: row.receipt_path,
    createdAt: row.created_at,
  };
}

export type LotInput = Omit<PurchaseLot, 'id' | 'createdAt'>;

export function createLot(input: LotInput, db: Db = getDb()): PurchaseLot {
  const res = db.prepare(`
    INSERT INTO purchase_lots (
      purchased_on, vendor, channel, description, subtotal_cents, shipping_cents,
      tax_cents, fees_cents, payment_method, resale_exemption_used, notes, receipt_path, created_at
    ) VALUES (
      @purchasedOn, @vendor, @channel, @description, @subtotalCents, @shippingCents,
      @taxCents, @feesCents, @paymentMethod, @resaleExemptionUsed, @notes, @receiptPath, @createdAt
    )
  `).run({
    ...input,
    resaleExemptionUsed: input.resaleExemptionUsed ? 1 : 0,
    createdAt: now(),
  });
  const lot = getLot(Number(res.lastInsertRowid), db)!;
  recordAudit('purchase_lots', lot.id, 'insert', null, lot, undefined, db);
  return lot;
}

export function getLot(id: number, db: Db = getDb()): PurchaseLot | null {
  const row = db.prepare('SELECT * FROM purchase_lots WHERE id = ?').get(id) as LotRow | undefined;
  return row ? toLot(row) : null;
}

export function listLots(range?: { from?: IsoDate; to?: IsoDate }, db: Db = getDb()): PurchaseLot[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (range?.from) { clauses.push('purchased_on >= @from'); params.from = range.from; }
  if (range?.to) { clauses.push('purchased_on <= @to'); params.to = range.to; }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (db.prepare(`SELECT * FROM purchase_lots ${where} ORDER BY purchased_on DESC, id DESC`).all(params) as LotRow[]).map(toLot);
}

export function deleteLot(id: number, reason: string | undefined, db: Db = getDb()): boolean {
  const before = getLot(id, db);
  if (!before) return false;
  const changed = db.prepare('DELETE FROM purchase_lots WHERE id = ?').run(id).changes > 0;
  if (changed) recordAudit('purchase_lots', id, 'delete', before, null, reason, db);
  return changed;
}

// ---------------------------------------------------------------------------
// Inventory items
// ---------------------------------------------------------------------------

interface ItemRow {
  id: number; lot_id: number | null; parent_item_id: number | null; kind: string; holding_intent: string;
  description: string; category: string | null; set_name: string | null; year: number | null;
  quantity: number; acquired_on: string; basis_cents: number; estimated_value_cents: number | null;
  status: string; graded_by: string | null; grade: string | null; cert_number: string | null;
  location: string | null; notes: string | null; created_at: string; updated_at: string;
}

function toItem(row: ItemRow): InventoryItem {
  return {
    id: row.id,
    lotId: row.lot_id,
    parentItemId: row.parent_item_id,
    kind: row.kind as InventoryItem['kind'],
    holdingIntent: row.holding_intent as InventoryItem['holdingIntent'],
    description: row.description,
    category: row.category,
    setName: row.set_name,
    year: row.year,
    quantity: row.quantity,
    acquiredOn: row.acquired_on,
    basisCents: row.basis_cents,
    estimatedValueCents: row.estimated_value_cents,
    status: row.status as InventoryItem['status'],
    gradedBy: row.graded_by,
    grade: row.grade,
    certNumber: row.cert_number,
    location: row.location,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ItemInput = Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>;

export function createItem(input: ItemInput, db: Db = getDb()): InventoryItem {
  const stamp = now();
  const res = db.prepare(`
    INSERT INTO inventory_items (
      lot_id, parent_item_id, kind, holding_intent, description, category, set_name, year,
      quantity, acquired_on, basis_cents, estimated_value_cents, status,
      graded_by, grade, cert_number, location, notes, created_at, updated_at
    ) VALUES (
      @lotId, @parentItemId, @kind, @holdingIntent, @description, @category, @setName, @year,
      @quantity, @acquiredOn, @basisCents, @estimatedValueCents, @status,
      @gradedBy, @grade, @certNumber, @location, @notes, @createdAt, @updatedAt
    )
  `).run({ ...input, createdAt: stamp, updatedAt: stamp });
  const item = getItem(Number(res.lastInsertRowid), db)!;
  recordAudit('inventory_items', item.id, 'insert', null, item, undefined, db);
  return item;
}

export function getItem(id: number, db: Db = getDb()): InventoryItem | null {
  const row = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) as ItemRow | undefined;
  return row ? toItem(row) : null;
}

export function updateItem(id: number, patch: Partial<ItemInput>, reason: string | undefined, db: Db = getDb()): InventoryItem | null {
  const before = getItem(id, db);
  if (!before) return null;
  const merged = { ...before, ...patch };
  db.prepare(`
    UPDATE inventory_items SET
      lot_id = @lotId, parent_item_id = @parentItemId, kind = @kind, holding_intent = @holdingIntent,
      description = @description, category = @category, set_name = @setName, year = @year,
      quantity = @quantity, acquired_on = @acquiredOn, basis_cents = @basisCents,
      estimated_value_cents = @estimatedValueCents, status = @status, graded_by = @gradedBy,
      grade = @grade, cert_number = @certNumber, location = @location, notes = @notes,
      updated_at = @updatedAt
    WHERE id = @id
  `).run({ ...merged, id, updatedAt: now() });
  const after = getItem(id, db)!;
  recordAudit('inventory_items', id, 'update', before, after, reason, db);
  return after;
}

export interface ItemFilter {
  status?: InventoryItem['status'][];
  kind?: InventoryItem['kind'][];
  holdingIntent?: InventoryItem['holdingIntent'];
  lotId?: number;
  parentItemId?: number;
  search?: string;
  acquiredBefore?: IsoDate;
  limit?: number;
  offset?: number;
}

export function listItems(filter: ItemFilter = {}, db: Db = getDb()): { items: InventoryItem[]; total: number } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.status?.length) {
    clauses.push(`status IN (${filter.status.map((_, i) => `@st${i}`).join(',')})`);
    filter.status.forEach((s, i) => { params[`st${i}`] = s; });
  }
  if (filter.kind?.length) {
    clauses.push(`kind IN (${filter.kind.map((_, i) => `@kd${i}`).join(',')})`);
    filter.kind.forEach((k, i) => { params[`kd${i}`] = k; });
  }
  if (filter.holdingIntent) { clauses.push('holding_intent = @intent'); params.intent = filter.holdingIntent; }
  if (filter.lotId !== undefined) { clauses.push('lot_id = @lotId'); params.lotId = filter.lotId; }
  if (filter.parentItemId !== undefined) { clauses.push('parent_item_id = @parentId'); params.parentId = filter.parentItemId; }
  if (filter.acquiredBefore) { clauses.push('acquired_on <= @acquiredBefore'); params.acquiredBefore = filter.acquiredBefore; }
  if (filter.search) {
    clauses.push('(description LIKE @q OR set_name LIKE @q OR category LIKE @q OR cert_number LIKE @q)');
    params.q = `%${filter.search}%`;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM inventory_items ${where}`).get(params) as { n: number }).n;
  const limit = Math.min(1000, Math.max(1, filter.limit ?? 200));
  const offset = Math.max(0, filter.offset ?? 0);
  const rows = db
    .prepare(`SELECT * FROM inventory_items ${where} ORDER BY acquired_on DESC, id DESC LIMIT ${limit} OFFSET ${offset}`)
    .all(params) as ItemRow[];
  return { items: rows.map(toItem), total };
}

/** Items in the given lot, used when reallocating a lot's cost. */
export function itemsInLot(lotId: number, db: Db = getDb()): InventoryItem[] {
  return (db.prepare('SELECT * FROM inventory_items WHERE lot_id = ? ORDER BY id').all(lotId) as ItemRow[]).map(toItem);
}

export function childItems(parentId: number, db: Db = getDb()): InventoryItem[] {
  return (db.prepare('SELECT * FROM inventory_items WHERE parent_item_id = ? ORDER BY id').all(parentId) as ItemRow[]).map(toItem);
}

export function deleteItem(id: number, reason: string | undefined, db: Db = getDb()): boolean {
  const before = getItem(id, db);
  if (!before) return false;
  const sold = db.prepare('SELECT COUNT(*) AS n FROM sale_lines WHERE item_id = ?').get(id) as { n: number };
  if (sold.n > 0) {
    throw new Error('This item has been sold. Delete the sale first, or the books will not tie.');
  }
  const changed = db.prepare('DELETE FROM inventory_items WHERE id = ?').run(id).changes > 0;
  if (changed) recordAudit('inventory_items', id, 'delete', before, null, reason, db);
  return changed;
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

interface SaleRow {
  id: number; sold_on: string; channel: string; order_ref: string | null; buyer_state: string | null;
  gross_cents: number; shipping_charged_cents: number; sales_tax_collected_cents: number;
  sales_tax_remitted_by_platform: number; platform_fee_cents: number;
  payment_processing_fee_cents: number; shipping_cost_cents: number; other_fee_cents: number;
  refunded_cents: number; notes: string | null; created_at: string;
}

function toSale(row: SaleRow): Sale {
  return {
    id: row.id,
    soldOn: row.sold_on,
    channel: row.channel as Sale['channel'],
    orderRef: row.order_ref,
    buyerState: row.buyer_state,
    grossCents: row.gross_cents,
    shippingChargedCents: row.shipping_charged_cents,
    salesTaxCollectedCents: row.sales_tax_collected_cents,
    salesTaxRemittedByPlatform: row.sales_tax_remitted_by_platform === 1,
    platformFeeCents: row.platform_fee_cents,
    paymentProcessingFeeCents: row.payment_processing_fee_cents,
    shippingCostCents: row.shipping_cost_cents,
    otherFeeCents: row.other_fee_cents,
    refundedCents: row.refunded_cents,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export interface SaleLineInput {
  itemId: number;
  quantity: number;
  allocatedGrossCents: number;
  cogsCents: number;
}

export type SaleInput = Omit<Sale, 'id' | 'createdAt'>;

/**
 * Record a sale and relieve the sold items from inventory.
 *
 * Done in one transaction: a sale that recorded revenue without moving the
 * item's basis into cost of goods sold would overstate profit, and the two
 * halves must never be able to come apart.
 */
export function createSale(input: SaleInput, lines: SaleLineInput[], db: Db = getDb()): Sale {
  const run = db.transaction(() => {
    const res = db.prepare(`
      INSERT INTO sales (
        sold_on, channel, order_ref, buyer_state, gross_cents, shipping_charged_cents,
        sales_tax_collected_cents, sales_tax_remitted_by_platform, platform_fee_cents,
        payment_processing_fee_cents, shipping_cost_cents, other_fee_cents, refunded_cents,
        notes, created_at
      ) VALUES (
        @soldOn, @channel, @orderRef, @buyerState, @grossCents, @shippingChargedCents,
        @salesTaxCollectedCents, @salesTaxRemittedByPlatform, @platformFeeCents,
        @paymentProcessingFeeCents, @shippingCostCents, @otherFeeCents, @refundedCents,
        @notes, @createdAt
      )
    `).run({
      ...input,
      salesTaxRemittedByPlatform: input.salesTaxRemittedByPlatform ? 1 : 0,
      createdAt: now(),
    });

    const saleId = Number(res.lastInsertRowid);
    const insertLine = db.prepare(`
      INSERT INTO sale_lines (sale_id, item_id, quantity, allocated_gross_cents, cogs_cents)
      VALUES (@saleId, @itemId, @quantity, @allocatedGrossCents, @cogsCents)
    `);

    for (const line of lines) {
      const item = getItem(line.itemId, db);
      if (!item) throw new Error(`Cannot sell item ${line.itemId}: it does not exist.`);
      if (item.status === 'sold') throw new Error(`"${item.description}" is already marked sold.`);
      insertLine.run({ saleId, ...line });
      db.prepare('UPDATE inventory_items SET status = ?, updated_at = ? WHERE id = ?')
        .run('sold', now(), line.itemId);
    }
    return saleId;
  });

  const saleId = run();
  const sale = getSale(saleId, db)!;
  recordAudit('sales', saleId, 'insert', null, { sale, lines }, undefined, db);
  return sale;
}

export function getSale(id: number, db: Db = getDb()): Sale | null {
  const row = db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as SaleRow | undefined;
  return row ? toSale(row) : null;
}

export function saleLines(saleId: number, db: Db = getDb()): Array<SaleLineInput & { saleId: number }> {
  return db.prepare('SELECT sale_id AS saleId, item_id AS itemId, quantity, allocated_gross_cents AS allocatedGrossCents, cogs_cents AS cogsCents FROM sale_lines WHERE sale_id = ?')
    .all(saleId) as Array<SaleLineInput & { saleId: number }>;
}

export function listSales(range?: { from?: IsoDate; to?: IsoDate; channel?: string }, db: Db = getDb()): Sale[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (range?.from) { clauses.push('sold_on >= @from'); params.from = range.from; }
  if (range?.to) { clauses.push('sold_on <= @to'); params.to = range.to; }
  if (range?.channel) { clauses.push('channel = @channel'); params.channel = range.channel; }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (db.prepare(`SELECT * FROM sales ${where} ORDER BY sold_on DESC, id DESC`).all(params) as SaleRow[]).map(toSale);
}

/** Reverse a sale, putting its items back on hand. */
export function deleteSale(id: number, reason: string | undefined, db: Db = getDb()): boolean {
  const before = getSale(id, db);
  if (!before) return false;
  const lines = saleLines(id, db);
  const run = db.transaction(() => {
    for (const line of lines) {
      db.prepare('UPDATE inventory_items SET status = ?, updated_at = ? WHERE id = ?')
        .run('on-hand', now(), line.itemId);
    }
    return db.prepare('DELETE FROM sales WHERE id = ?').run(id).changes > 0;
  });
  const changed = run();
  if (changed) recordAudit('sales', id, 'delete', { sale: before, lines }, null, reason, db);
  return changed;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

interface ExpenseRow {
  id: number; incurred_on: string; account_key: string; vendor: string | null; description: string;
  amount_cents: number; business_use_percent: number; payment_method: string | null;
  receipt_path: string | null; notes: string | null; created_at: string;
}

function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    incurredOn: row.incurred_on,
    accountKey: row.account_key,
    vendor: row.vendor,
    description: row.description,
    amountCents: row.amount_cents,
    businessUsePercent: row.business_use_percent,
    paymentMethod: row.payment_method,
    receiptPath: row.receipt_path,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export type ExpenseInput = Omit<Expense, 'id' | 'createdAt'>;

export function createExpense(input: ExpenseInput, db: Db = getDb()): Expense {
  const res = db.prepare(`
    INSERT INTO expenses (
      incurred_on, account_key, vendor, description, amount_cents,
      business_use_percent, payment_method, receipt_path, notes, created_at
    ) VALUES (
      @incurredOn, @accountKey, @vendor, @description, @amountCents,
      @businessUsePercent, @paymentMethod, @receiptPath, @notes, @createdAt
    )
  `).run({ ...input, createdAt: now() });
  const expense = getExpense(Number(res.lastInsertRowid), db)!;
  recordAudit('expenses', expense.id, 'insert', null, expense, undefined, db);
  return expense;
}

export function getExpense(id: number, db: Db = getDb()): Expense | null {
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseRow | undefined;
  return row ? toExpense(row) : null;
}

export function updateExpense(id: number, patch: Partial<ExpenseInput>, reason: string | undefined, db: Db = getDb()): Expense | null {
  const before = getExpense(id, db);
  if (!before) return null;
  const merged = { ...before, ...patch };
  db.prepare(`
    UPDATE expenses SET incurred_on = @incurredOn, account_key = @accountKey, vendor = @vendor,
      description = @description, amount_cents = @amountCents, business_use_percent = @businessUsePercent,
      payment_method = @paymentMethod, receipt_path = @receiptPath, notes = @notes
    WHERE id = @id
  `).run({ ...merged, id });
  const after = getExpense(id, db)!;
  recordAudit('expenses', id, 'update', before, after, reason, db);
  return after;
}

export function listExpenses(range?: { from?: IsoDate; to?: IsoDate; accountKey?: string }, db: Db = getDb()): Expense[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (range?.from) { clauses.push('incurred_on >= @from'); params.from = range.from; }
  if (range?.to) { clauses.push('incurred_on <= @to'); params.to = range.to; }
  if (range?.accountKey) { clauses.push('account_key = @accountKey'); params.accountKey = range.accountKey; }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (db.prepare(`SELECT * FROM expenses ${where} ORDER BY incurred_on DESC, id DESC`).all(params) as ExpenseRow[]).map(toExpense);
}

export function deleteExpense(id: number, reason: string | undefined, db: Db = getDb()): boolean {
  const before = getExpense(id, db);
  if (!before) return false;
  const changed = db.prepare('DELETE FROM expenses WHERE id = ?').run(id).changes > 0;
  if (changed) recordAudit('expenses', id, 'delete', before, null, reason, db);
  return changed;
}

// ---------------------------------------------------------------------------
// Mileage
// ---------------------------------------------------------------------------

interface MileageRow {
  id: number; driven_on: string; purpose: string; from_location: string | null; to_location: string | null;
  miles: number; round_trip: number; odometer_start: number | null; odometer_end: number | null;
  notes: string | null; created_at: string;
}

function toTrip(row: MileageRow): MileageTrip {
  return {
    id: row.id,
    drivenOn: row.driven_on,
    purpose: row.purpose,
    fromLocation: row.from_location,
    toLocation: row.to_location,
    miles: row.miles,
    roundTrip: row.round_trip === 1,
    odometerStart: row.odometer_start,
    odometerEnd: row.odometer_end,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export type MileageInput = Omit<MileageTrip, 'id' | 'createdAt'>;

export function createTrip(input: MileageInput, db: Db = getDb()): MileageTrip {
  const res = db.prepare(`
    INSERT INTO mileage_trips (
      driven_on, purpose, from_location, to_location, miles, round_trip,
      odometer_start, odometer_end, notes, created_at
    ) VALUES (
      @drivenOn, @purpose, @fromLocation, @toLocation, @miles, @roundTrip,
      @odometerStart, @odometerEnd, @notes, @createdAt
    )
  `).run({ ...input, roundTrip: input.roundTrip ? 1 : 0, createdAt: now() });
  const trip = getTrip(Number(res.lastInsertRowid), db)!;
  recordAudit('mileage_trips', trip.id, 'insert', null, trip, undefined, db);
  return trip;
}

export function getTrip(id: number, db: Db = getDb()): MileageTrip | null {
  const row = db.prepare('SELECT * FROM mileage_trips WHERE id = ?').get(id) as MileageRow | undefined;
  return row ? toTrip(row) : null;
}

export function listTrips(range?: { from?: IsoDate; to?: IsoDate }, db: Db = getDb()): MileageTrip[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (range?.from) { clauses.push('driven_on >= @from'); params.from = range.from; }
  if (range?.to) { clauses.push('driven_on <= @to'); params.to = range.to; }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (db.prepare(`SELECT * FROM mileage_trips ${where} ORDER BY driven_on DESC, id DESC`).all(params) as MileageRow[]).map(toTrip);
}

export function deleteTrip(id: number, reason: string | undefined, db: Db = getDb()): boolean {
  const before = getTrip(id, db);
  if (!before) return false;
  const changed = db.prepare('DELETE FROM mileage_trips WHERE id = ?').run(id).changes > 0;
  if (changed) recordAudit('mileage_trips', id, 'delete', before, null, reason, db);
  return changed;
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

interface PayoutRow {
  id: number; channel: string; received_on: string; period_start: string | null; period_end: string | null;
  gross_cents: number; fees_cents: number; refunds_cents: number; shipping_labels_cents: number;
  sales_tax_cents: number; net_cents: number; reference: string | null; notes: string | null; created_at: string;
}

function toPayout(row: PayoutRow): Payout {
  return {
    id: row.id,
    channel: row.channel as Payout['channel'],
    receivedOn: row.received_on,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    grossCents: row.gross_cents,
    feesCents: row.fees_cents,
    refundsCents: row.refunds_cents,
    shippingLabelsCents: row.shipping_labels_cents,
    salesTaxCents: row.sales_tax_cents,
    netCents: row.net_cents,
    reference: row.reference,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export type PayoutInput = Omit<Payout, 'id' | 'createdAt'>;

export function createPayout(input: PayoutInput, db: Db = getDb()): Payout {
  const res = db.prepare(`
    INSERT INTO payouts (
      channel, received_on, period_start, period_end, gross_cents, fees_cents,
      refunds_cents, shipping_labels_cents, sales_tax_cents, net_cents, reference, notes, created_at
    ) VALUES (
      @channel, @receivedOn, @periodStart, @periodEnd, @grossCents, @feesCents,
      @refundsCents, @shippingLabelsCents, @salesTaxCents, @netCents, @reference, @notes, @createdAt
    )
  `).run({ ...input, createdAt: now() });
  const payout = db.prepare('SELECT * FROM payouts WHERE id = ?').get(Number(res.lastInsertRowid)) as PayoutRow;
  recordAudit('payouts', payout.id, 'insert', null, toPayout(payout), undefined, db);
  return toPayout(payout);
}

export function listPayouts(range?: { from?: IsoDate; to?: IsoDate }, db: Db = getDb()): Payout[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (range?.from) { clauses.push('received_on >= @from'); params.from = range.from; }
  if (range?.to) { clauses.push('received_on <= @to'); params.to = range.to; }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (db.prepare(`SELECT * FROM payouts ${where} ORDER BY received_on DESC, id DESC`).all(params) as PayoutRow[]).map(toPayout);
}

// ---------------------------------------------------------------------------
// Grading submissions
// ---------------------------------------------------------------------------

interface SubmissionRow {
  id: number; grader: string; service_level: string | null; submitted_on: string; returned_on: string | null;
  submission_number: string | null; fee_cents: number; shipping_to_cents: number;
  shipping_back_cents: number; insurance_cents: number; notes: string | null; created_at: string;
}

function toSubmission(row: SubmissionRow): GradingSubmission {
  return {
    id: row.id,
    grader: row.grader,
    serviceLevel: row.service_level,
    submittedOn: row.submitted_on,
    returnedOn: row.returned_on,
    submissionNumber: row.submission_number,
    feeCents: row.fee_cents,
    shippingToCents: row.shipping_to_cents,
    shippingBackCents: row.shipping_back_cents,
    insuranceCents: row.insurance_cents,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export type SubmissionInput = Omit<GradingSubmission, 'id' | 'createdAt'>;

export function createSubmission(input: SubmissionInput, itemIds: number[], db: Db = getDb()): GradingSubmission {
  const run = db.transaction(() => {
    const res = db.prepare(`
      INSERT INTO grading_submissions (
        grader, service_level, submitted_on, returned_on, submission_number,
        fee_cents, shipping_to_cents, shipping_back_cents, insurance_cents, notes, created_at
      ) VALUES (
        @grader, @serviceLevel, @submittedOn, @returnedOn, @submissionNumber,
        @feeCents, @shippingToCents, @shippingBackCents, @insuranceCents, @notes, @createdAt
      )
    `).run({ ...input, createdAt: now() });
    const submissionId = Number(res.lastInsertRowid);

    const link = db.prepare(`
      INSERT INTO grading_submission_items (submission_id, item_id, allocated_cost_cents)
      VALUES (?, ?, 0)
    `);
    for (const itemId of itemIds) {
      link.run(submissionId, itemId);
      // The card is physically gone; it should not show as available to sell.
      db.prepare('UPDATE inventory_items SET status = ?, updated_at = ? WHERE id = ?')
        .run('at-grading', now(), itemId);
    }
    return submissionId;
  });

  const id = run();
  const submission = getSubmission(id, db)!;
  recordAudit('grading_submissions', id, 'insert', null, { submission, itemIds }, undefined, db);
  return submission;
}

export function getSubmission(id: number, db: Db = getDb()): GradingSubmission | null {
  const row = db.prepare('SELECT * FROM grading_submissions WHERE id = ?').get(id) as SubmissionRow | undefined;
  return row ? toSubmission(row) : null;
}

export function listSubmissions(db: Db = getDb()): GradingSubmission[] {
  return (db.prepare('SELECT * FROM grading_submissions ORDER BY submitted_on DESC, id DESC').all() as SubmissionRow[]).map(toSubmission);
}

export function submissionItems(submissionId: number, db: Db = getDb()): Array<{ itemId: number; resultGrade: string | null; certNumber: string | null; allocatedCostCents: number }> {
  return db.prepare(`
    SELECT item_id AS itemId, result_grade AS resultGrade, cert_number AS certNumber,
           allocated_cost_cents AS allocatedCostCents
    FROM grading_submission_items WHERE submission_id = ?
  `).all(submissionId) as Array<{ itemId: number; resultGrade: string | null; certNumber: string | null; allocatedCostCents: number }>;
}

export function updateSubmissionItem(
  submissionId: number,
  itemId: number,
  patch: { resultGrade?: string | null; certNumber?: string | null; allocatedCostCents?: number },
  db: Db = getDb(),
): void {
  const current = db.prepare('SELECT * FROM grading_submission_items WHERE submission_id = ? AND item_id = ?')
    .get(submissionId, itemId) as { result_grade: string | null; cert_number: string | null; allocated_cost_cents: number } | undefined;
  if (!current) return;
  db.prepare(`
    UPDATE grading_submission_items
    SET result_grade = @grade, cert_number = @cert, allocated_cost_cents = @cost
    WHERE submission_id = @submissionId AND item_id = @itemId
  `).run({
    submissionId,
    itemId,
    grade: patch.resultGrade !== undefined ? patch.resultGrade : current.result_grade,
    cert: patch.certNumber !== undefined ? patch.certNumber : current.cert_number,
    cost: patch.allocatedCostCents !== undefined ? patch.allocatedCostCents : current.allocated_cost_cents,
  });
}

export function markSubmissionReturned(id: number, returnedOn: IsoDate, db: Db = getDb()): void {
  db.prepare('UPDATE grading_submissions SET returned_on = ? WHERE id = ?').run(returnedOn, id);
}

// ---------------------------------------------------------------------------
// Opening events
// ---------------------------------------------------------------------------

export function recordOpening(
  itemId: number,
  openedOn: IsoDate,
  allocationMethod: string,
  notes: string | null,
  db: Db = getDb(),
): number {
  const res = db.prepare(`
    INSERT INTO opening_events (item_id, opened_on, allocation_method, notes, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(itemId, openedOn, allocationMethod, notes, now());
  return Number(res.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

export interface ComplianceRow {
  task_id: string; completed: number; completed_on: string | null;
  reference: string | null; notes: string | null; not_applicable: number; updated_at: string;
}

export function complianceStatuses(db: Db = getDb()): ComplianceRow[] {
  return db.prepare('SELECT * FROM compliance_status').all() as ComplianceRow[];
}

export function setComplianceStatus(
  taskId: string,
  patch: { completed?: boolean; completedOn?: IsoDate | null; reference?: string | null; notes?: string | null; notApplicable?: boolean },
  db: Db = getDb(),
): void {
  const existing = db.prepare('SELECT * FROM compliance_status WHERE task_id = ?').get(taskId) as ComplianceRow | undefined;
  db.prepare(`
    INSERT INTO compliance_status (task_id, completed, completed_on, reference, notes, not_applicable, updated_at)
    VALUES (@taskId, @completed, @completedOn, @reference, @notes, @notApplicable, @updatedAt)
    ON CONFLICT(task_id) DO UPDATE SET
      completed = excluded.completed, completed_on = excluded.completed_on,
      reference = excluded.reference, notes = excluded.notes,
      not_applicable = excluded.not_applicable, updated_at = excluded.updated_at
  `).run({
    taskId,
    completed: (patch.completed ?? (existing?.completed === 1)) ? 1 : 0,
    completedOn: patch.completedOn !== undefined ? patch.completedOn : (existing?.completed_on ?? null),
    reference: patch.reference !== undefined ? patch.reference : (existing?.reference ?? null),
    notes: patch.notes !== undefined ? patch.notes : (existing?.notes ?? null),
    notApplicable: (patch.notApplicable ?? (existing?.not_applicable === 1)) ? 1 : 0,
    updatedAt: now(),
  });
}
