/**
 * Standard mileage rates.
 *
 * Modelled as a dated schedule rather than one number per year, because the
 * rate can and does change mid-year: for 2026 the IRS set 72.5 cents per mile
 * from 1 January, then raised it to 76 cents from 1 July in response to fuel
 * prices. A single annual rate would silently understate every trip in the
 * second half of the year.
 *
 * Each trip is therefore valued at the rate in force on the day it was driven,
 * and the report shows the split so it can be checked against the log.
 */

import type { Cents } from '../domain/money.js';
import type { IsoDate } from '../domain/types.js';
import type { FigureConfidence } from './figures.js';

export interface MileageRatePeriod {
  from: IsoDate;
  /** Inclusive. */
  to: IsoDate;
  centsPerMile: number;
  authority: string;
  source: string;
  confidence: FigureConfidence;
}

/**
 * Business standard mileage rates.
 *
 * Only business rates are here; the charitable, medical and moving rates are
 * different and are not used by this application.
 */
export const MILEAGE_RATES: MileageRatePeriod[] = [
  {
    from: '2025-01-01',
    to: '2025-12-31',
    centsPerMile: 70,
    authority: 'IRS Notice 2025-05',
    source: 'https://www.irs.gov/tax-professionals/standard-mileage-rates',
    confidence: 'reported',
  },
  {
    from: '2026-01-01',
    to: '2026-06-30',
    centsPerMile: 72.5,
    authority: 'IRS Notice 2026-10',
    source: 'https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile-up-25-cents',
    confidence: 'reported',
  },
  {
    from: '2026-07-01',
    to: '2026-12-31',
    centsPerMile: 76,
    authority: 'IRS Announcement 2026-11, modifying Notice 2026-10',
    source: 'https://www.irs.gov/irb/2026-29_irb',
    confidence: 'reported',
  },
];

export function rateOn(date: IsoDate): MileageRatePeriod | null {
  return MILEAGE_RATES.find((r) => date >= r.from && date <= r.to) ?? null;
}

export interface MileageTripInput {
  drivenOn: IsoDate;
  miles: number;
  roundTrip: boolean;
}

export interface MileageBand {
  from: IsoDate;
  to: IsoDate;
  centsPerMile: number;
  miles: number;
  deductionCents: Cents;
  authority: string;
  source: string;
}

export interface MileageDeduction {
  totalMiles: number;
  deductionCents: Cents;
  /** One entry per rate period the trips fell into. */
  bands: MileageBand[];
  /** Trips whose date has no rate on file and which were therefore not counted. */
  unratedMiles: number;
  notes: string[];
}

/**
 * Value a year's trips at the rate in force on each day.
 *
 * Trips with no rate on file are counted separately rather than valued at a
 * neighbouring year's rate, and the caller is told how many miles were left
 * out. Quietly applying the wrong rate is worse than showing a gap.
 */
export function mileageDeduction(trips: readonly MileageTripInput[]): MileageDeduction {
  const bands = new Map<string, MileageBand>();
  let unrated = 0;
  const notes: string[] = [];

  for (const trip of trips) {
    const miles = trip.roundTrip ? trip.miles * 2 : trip.miles;
    const rate = rateOn(trip.drivenOn);
    if (!rate) {
      unrated += miles;
      continue;
    }
    const key = `${rate.from}:${rate.to}`;
    const existing = bands.get(key);
    if (existing) {
      existing.miles += miles;
      existing.deductionCents = Math.round(existing.miles * rate.centsPerMile);
    } else {
      bands.set(key, {
        from: rate.from,
        to: rate.to,
        centsPerMile: rate.centsPerMile,
        miles,
        deductionCents: Math.round(miles * rate.centsPerMile),
        authority: rate.authority,
        source: rate.source,
      });
    }
  }

  const ordered = [...bands.values()].sort((a, b) => a.from.localeCompare(b.from));

  if (ordered.length > 1) {
    notes.push(
      'The standard mileage rate changed part-way through the year, so trips are valued at the rate in force ' +
        'on the day each was driven. Your log has to be split at the changeover date.',
    );
  }
  if (unrated > 0) {
    notes.push(
      `${unrated.toFixed(1)} miles were driven on dates with no rate on file and are NOT included. ` +
        'Add the rate for those dates rather than letting the miles go uncounted.',
    );
  }
  notes.push('Parking and tolls on a business trip are deductible on top of the mileage rate, not included in it.');

  return {
    totalMiles: ordered.reduce((sum, b) => sum + b.miles, 0) + unrated,
    deductionCents: ordered.reduce((sum, b) => sum + b.deductionCents, 0),
    bands: ordered,
    unratedMiles: unrated,
    notes,
  };
}
