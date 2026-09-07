/**
 * The year-end package: everything needed to fill in a return, in one place.
 *
 * The goal is that this can be handed to a preparer, or read straight onto the
 * forms, without anyone having to re-derive a number or guess where something
 * belongs.
 */

import type { Cents } from '../domain/money.js';
import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import { getProfile } from '../db/repos.js';
import { figureValue, figureHealth, taxYear } from '../tax/registry.js';
import { selfEmploymentTax, type SelfEmploymentResult } from '../tax/selfEmployment.js';
import { profitAndLoss, type ProfitLossReport } from './profitLoss.js';
import { capitalGainsForYear, type CapitalGainsReport } from './capitalGains.js';
import { endingInventory, beginningInventory, type InventorySnapshot } from './inventory.js';
import { homeOfficeDeduction, type HomeOfficeResult } from '../tax/homeOffice.js';

export interface ScheduleCWorksheet {
  year: number;
  generatedAt: string;
  profitLoss: ProfitLossReport;
  selfEmployment: SelfEmploymentResult | null;
  capitalGains: CapitalGainsReport;
  homeOffice: HomeOfficeResult | null;
  beginningInventory: InventorySnapshot;
  endingInventory: InventorySnapshot;
  /** Lines 33 and 34: the two questions above Part III that people skip. */
  inventoryValuation: {
    line33: string;
    line34: string;
    note: string;
  };
  /** Vehicle questions Schedule C Part IV asks. */
  vehicle: { totalBusinessMiles: number; tripCount: number; hasWrittenRecords: boolean };
  /** Figures behind the numbers that have not been confirmed. */
  figuresNeedingCheck: Array<{ key: string; label: string; source: string; note: string | null }>;
  warnings: string[];
  /** Not tax advice; stated once, plainly, where it belongs. */
  disclaimer: string;
}

export const DISCLAIMER =
  'This worksheet is produced from the records you entered. It is bookkeeping output, not tax advice, ' +
  'and it has not been reviewed by anyone qualified to give you tax advice. Check every figure against ' +
  'its source, and have a CPA or enrolled agent review the return before you file it — particularly the ' +
  'first one, and particularly the treatment of anything you hold as an investment rather than as stock in trade.';

export function scheduleCWorksheet(year: number, db: Db = getDb()): ScheduleCWorksheet {
  const profile = getProfile(db);
  const figures = taxYear(year);
  const warnings: string[] = [];

  if (!figures) {
    warnings.push(
      `No tax figures are on file for ${year}, so nothing that depends on a rate or threshold has been computed.`,
    );
  }

  const mealsPercent = figureValue(year, 'meals.deductiblePercent');

  const home = homeOfficeDeduction(
    { officeSqFt: profile.homeOfficeSqFt, totalSqFt: profile.homeTotalSqFt },
    year,
  );

  const pl = profitAndLoss(
    year,
    {
      mealsDeductiblePercent: mealsPercent,
      homeOfficeCents: home?.deductionCents ?? 0,
    },
    db,
  );

  const se = figures
    ? selfEmploymentTax(
        {
          netProfitCents: pl.netProfitCents,
          wagesCents: profile.otherIncomeCents,
          filingStatus: profile.filingStatus,
        },
        figures,
      )
    : null;

  const trips = db.prepare(`
    SELECT COUNT(*) AS n,
           COALESCE(SUM(CASE WHEN round_trip = 1 THEN miles * 2 ELSE miles END), 0) AS miles,
           SUM(CASE WHEN odometer_start IS NOT NULL AND odometer_end IS NOT NULL THEN 1 ELSE 0 END) AS withOdometer
    FROM mileage_trips WHERE driven_on BETWEEN @from AND @to
  `).get({ from: `${year}-01-01`, to: `${year}-12-31` }) as { n: number; miles: number; withOdometer: number };

  const health = figureHealth(year);
  const figuresNeedingCheck = (health?.needsAttention ?? []).map((f) => ({
    key: f.key,
    label: f.label,
    source: f.source,
    note: f.note ?? null,
  }));

  if (se?.unverified.length) {
    warnings.push(
      `Self-employment tax was computed using figures that are not fully confirmed: ${se.unverified.join('; ')}.`,
    );
  }
  if (pl.cogs.warning) warnings.push(pl.cogs.warning);
  warnings.push(...pl.warnings);

  if (trips.n > 0 && trips.withOdometer < trips.n) {
    warnings.push(
      `${trips.n - trips.withOdometer} of ${trips.n} trips have no odometer readings. The substantiation rules ` +
        'for vehicle use are strict, and a log with dates, destinations, purposes and mileage is what they expect.',
    );
  }

  return {
    year,
    generatedAt: new Date().toISOString(),
    profitLoss: pl,
    selfEmployment: se,
    capitalGains: capitalGainsForYear(year, db),
    homeOffice: home,
    beginningInventory: beginningInventory(year, db),
    endingInventory: endingInventory(year, db),
    inventoryValuation: {
      // This app carries inventory at what you PAID. It never uses market
      // value as an amount, so the answer to line 33 is always (a) Cost.
      line33: 'a — Cost',
      line34: 'No',
      note:
        'Inventory here is carried at cost, so tick 33(a). Answer 34 "No" unless you changed method this ' +
        'year — if you did, that is an accounting method change and needs more than a tick box.',
    },
    vehicle: {
      totalBusinessMiles: trips.miles,
      tripCount: trips.n,
      hasWrittenRecords: trips.n > 0,
    },
    figuresNeedingCheck,
    warnings: [...new Set(warnings)],
    disclaimer: DISCLAIMER,
  };
}
