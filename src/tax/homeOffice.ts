/**
 * Home office deduction, simplified method.
 *
 * Two hurdles before any arithmetic:
 *
 *   REGULAR use — occasional use does not count.
 *   EXCLUSIVE use — the space must be used for business AND NOTHING ELSE. A
 *   desk in a bedroom that is also a bedroom does not qualify. This is the one
 *   people get wrong, and it is the one that gets disallowed.
 *
 * BUT — and this matters more to a card seller than anything else on this page
 * — IRC 280A(c)(2) waives the EXCLUSIVE use test for space used regularly to
 * store inventory or product samples. Pub. 587: "If you use part of your home
 * for storage of inventory or product samples, you can deduct expenses for the
 * business use of your home without meeting the exclusive use test."
 *
 * Five conditions, all required: you sell at retail or wholesale, the stock is
 * kept at home for the business, your home is the ONLY fixed location of that
 * business, the space is used regularly, and it is a separately identifiable
 * space suitable for storage.
 *
 * Someone running cards out of a spare room usually fails exclusive use on the
 * desk and passes it on the shelving. Both can be claimed under this exception,
 * and most people never learn it exists.
 *
 * The simplified method multiplies the square footage by a fixed rate, up to a
 * capped area. It is worth less than the actual-expense method for most people
 * but requires no allocation of utilities, insurance or depreciation, and it
 * leaves no depreciation to recapture when the home is sold.
 *
 * The deduction cannot create or deepen a business loss; the cap is applied by
 * the profit-and-loss report, not here.
 */

import type { Cents } from '../domain/money.js';
import { figureRef, figureValue } from './registry.js';

export interface HomeOfficeInput {
  officeSqFt: number | null;
  totalSqFt: number | null;
}

export interface HomeOfficeResult {
  method: 'simplified';
  qualifyingSqFt: number;
  rateCentsPerSqFt: number;
  deductionCents: Cents;
  /** True when the area was trimmed to the statutory maximum. */
  cappedByArea: boolean;
  requirements: string[];
  /** The 280A(c)(2) carve-out, which most card sellers qualify for. */
  inventoryStorageException: string[];
  source: string;
}

export function homeOfficeDeduction(input: HomeOfficeInput, year: number): HomeOfficeResult | null {
  const sqFt = input.officeSqFt;
  if (sqFt === null || !Number.isFinite(sqFt) || sqFt <= 0) return null;

  const rate = figureValue(year, 'homeOffice.simplifiedRatePerSqFt');
  const maxArea = figureValue(year, 'homeOffice.maxSquareFeet');
  if (rate === null || maxArea === null) return null;

  const qualifying = Math.min(sqFt, maxArea);
  const ref = figureRef(year, 'homeOffice.simplifiedRatePerSqFt');

  return {
    method: 'simplified',
    qualifyingSqFt: qualifying,
    rateCentsPerSqFt: rate,
    deductionCents: Math.round(qualifying * rate),
    cappedByArea: sqFt > maxArea,
    requirements: [
      'The space must be used REGULARLY for the business.',
      'The space must be used EXCLUSIVELY for the business — no other use at all. This is where most claims fail.',
      'It must be your principal place of business, or a place you meet clients, or a separate structure.',
      'The deduction cannot create or increase a business loss.',
    ],
    inventoryStorageException: [
      'Space used regularly to STORE INVENTORY does not have to meet the exclusive use test (IRC 280A(c)(2)).',
      'It must be a separately identifiable space suitable for storage — shelving, a closet, a corner of a room.',
      'Your home must be the ONLY fixed location of the business, and you must sell at retail or wholesale.',
      'This is the part most card sellers qualify for and never claim. Measure the storage area, not just the desk.',
    ],
    source: ref?.source ?? 'https://www.irs.gov/businesses/small-businesses-self-employed/home-office-deduction',
  };
}
