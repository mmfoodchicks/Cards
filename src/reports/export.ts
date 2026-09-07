/**
 * Export.
 *
 * Two audiences. A CPA wants the underlying records in a spreadsheet, not a
 * screenshot of a dashboard. And the business itself needs its data to be
 * portable — a book of account locked inside one application is a liability,
 * not an asset.
 *
 * Everything is plain CSV and JSON. No lock-in, no proprietary format, and the
 * whole database is a single file that can simply be copied.
 */

import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import { scheduleCWorksheet } from './scheduleCWorksheet.js';
import { investmentSchedule } from './capitalGains.js';

/** Quote a CSV field, escaping quotes and anything that would break a row. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // A leading =, +, - or @ can be interpreted as a formula by spreadsheet
  // software. Prefixing with a quote keeps a card called "-1st Edition" from
  // becoming a computation.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  if (rows.length === 0) return '';
  const headers = columns ?? Object.keys(rows[0]!);
  const lines = [headers.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvField(row[h])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Money as a decimal string, which is what a spreadsheet wants. */
function dollars(cents: unknown): string {
  const value = Number(cents);
  return Number.isFinite(value) ? (value / 100).toFixed(2) : '';
}

export interface ExportSet {
  [filename: string]: string;
}

/**
 * Everything for one tax year, as a set of CSV files plus the worksheet.
 *
 * Named so the files sort into a sensible order when unzipped.
 */
export function exportYear(year: number, db: Db = getDb()): ExportSet {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const params = { from, to };

  const purchases = db.prepare(`
    SELECT l.id, l.purchased_on, l.vendor, l.channel, l.description,
           l.subtotal_cents, l.shipping_cents, l.tax_cents, l.fees_cents,
           l.resale_exemption_used, l.payment_method, l.notes
    FROM purchase_lots l WHERE l.purchased_on BETWEEN @from AND @to
    ORDER BY l.purchased_on, l.id
  `).all(params) as Array<Record<string, unknown>>;

  const items = db.prepare(`
    SELECT i.id, i.lot_id, i.parent_item_id, i.description, i.kind, i.holding_intent,
           i.category, i.set_name, i.year, i.quantity, i.acquired_on,
           i.basis_cents, i.estimated_value_cents, i.status,
           i.graded_by, i.grade, i.cert_number, i.location
    FROM inventory_items i ORDER BY i.acquired_on, i.id
  `).all() as Array<Record<string, unknown>>;

  const sales = db.prepare(`
    SELECT s.id, s.sold_on, s.channel, s.order_ref, s.buyer_state,
           s.gross_cents, s.shipping_charged_cents, s.sales_tax_collected_cents,
           s.sales_tax_remitted_by_platform, s.platform_fee_cents,
           s.payment_processing_fee_cents, s.shipping_cost_cents,
           s.other_fee_cents, s.refunded_cents, s.notes
    FROM sales s WHERE s.sold_on BETWEEN @from AND @to
    ORDER BY s.sold_on, s.id
  `).all(params) as Array<Record<string, unknown>>;

  const saleLines = db.prepare(`
    SELECT sl.sale_id, s.sold_on, sl.item_id, i.description AS item_description,
           i.holding_intent, sl.quantity, sl.allocated_gross_cents, sl.cogs_cents
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    JOIN inventory_items i ON i.id = sl.item_id
    WHERE s.sold_on BETWEEN @from AND @to
    ORDER BY s.sold_on, sl.sale_id
  `).all(params) as Array<Record<string, unknown>>;

  const expenses = db.prepare(`
    SELECT e.id, e.incurred_on, e.account_key, e.vendor, e.description,
           e.amount_cents, e.business_use_percent, e.payment_method, e.notes
    FROM expenses e WHERE e.incurred_on BETWEEN @from AND @to
    ORDER BY e.incurred_on, e.id
  `).all(params) as Array<Record<string, unknown>>;

  const mileage = db.prepare(`
    SELECT m.id, m.driven_on, m.purpose, m.from_location, m.to_location,
           m.miles, m.round_trip, m.odometer_start, m.odometer_end, m.notes
    FROM mileage_trips m WHERE m.driven_on BETWEEN @from AND @to
    ORDER BY m.driven_on, m.id
  `).all(params) as Array<Record<string, unknown>>;

  const grading = db.prepare(`
    SELECT g.id, g.grader, g.service_level, g.submitted_on, g.returned_on,
           g.submission_number, g.fee_cents, g.shipping_to_cents,
           g.shipping_back_cents, g.insurance_cents, g.notes
    FROM grading_submissions g ORDER BY g.submitted_on, g.id
  `).all() as Array<Record<string, unknown>>;

  const worksheet = scheduleCWorksheet(year, db);
  const investments = investmentSchedule(db);

  const withDollars = (rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
    rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (key.endsWith('_cents')) out[key.replace(/_cents$/, '_dollars')] = dollars(value);
        else out[key] = value;
      }
      return out;
    });

  return {
    [`${year}-01-purchases.csv`]: toCsv(withDollars(purchases)),
    [`${year}-02-inventory.csv`]: toCsv(withDollars(items)),
    [`${year}-03-sales.csv`]: toCsv(withDollars(sales)),
    [`${year}-04-sale-lines.csv`]: toCsv(withDollars(saleLines)),
    [`${year}-05-expenses.csv`]: toCsv(withDollars(expenses)),
    [`${year}-06-mileage.csv`]: toCsv(mileage),
    [`${year}-07-grading.csv`]: toCsv(withDollars(grading)),
    [`${year}-08-schedule-c-worksheet.json`]: JSON.stringify(worksheet, null, 2),
    [`${year}-09-investment-schedule.json`]: JSON.stringify(investments, null, 2),
    [`${year}-00-README.txt`]: readme(year, worksheet),
  };
}

function readme(year: number, worksheet: ReturnType<typeof scheduleCWorksheet>): string {
  const pl = worksheet.profitLoss;
  const d = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

  return [
    `CardLedger export — tax year ${year}`,
    `Generated ${new Date().toISOString()}`,
    '',
    'FILES',
    '  01-purchases.csv          every buying event, with what it cost',
    '  02-inventory.csv          every item, its cost basis and where it came from',
    '  03-sales.csv              every sale, with fees and shipping broken out',
    '  04-sale-lines.csv         which items were in each sale, and the basis relieved',
    '  05-expenses.csv           every expense, tagged to a Schedule C line',
    '  06-mileage.csv            the mileage log',
    '  07-grading.csv            grading submissions and their costs',
    '  08-schedule-c-worksheet   the computed return figures',
    '  09-investment-schedule    cards held as personal collection, not inventory',
    '',
    'HEADLINE FIGURES',
    `  Gross receipts (line 1)      ${d(pl.grossReceiptsCents)}`,
    `  Cost of goods sold (line 4)  ${d(pl.cogsCents)}`,
    `  Total expenses (line 28)     ${d(pl.totalExpensesCents)}`,
    `  Net profit (line 31)         ${d(pl.netProfitCents)}`,
    worksheet.selfEmployment
      ? `  Self-employment tax          ${d(worksheet.selfEmployment.totalCents)}`
      : '  Self-employment tax          not computed',
    '',
    'CHECK BEFORE FILING',
    pl.cogs.differenceCents === 0
      ? '  Cost of goods sold ties both ways, which is what you want.'
      : `  WARNING: cost of goods sold does not tie. ${pl.cogs.warning ?? ''}`,
    ...worksheet.warnings.map((w) => `  - ${w}`),
    ...(worksheet.figuresNeedingCheck.length > 0
      ? ['', 'FIGURES STILL TO CONFIRM', ...worksheet.figuresNeedingCheck.map((f) => `  - ${f.label}: ${f.source}`)]
      : []),
    '',
    'NOTE',
    `  ${worksheet.disclaimer}`,
    '',
  ].join('\n');
}
