/**
 * Tax figures for the 2026 tax year.
 *
 * Split into two kinds, because they age very differently:
 *
 *   STATUTORY figures are written into the Internal Revenue Code and have not
 *   moved in years. The 15.3% self-employment rate, the 92.35% multiplier, the
 *   $400 filing floor and the $200,000 additional Medicare threshold are not
 *   indexed to inflation at all. These are safe.
 *
 *   INDEXED figures are re-set every year. Carrying one forward from last year
 *   is the single most likely way for this application to produce a wrong
 *   return, so anything not confirmed against a primary source is marked and
 *   the app refuses to compute with it.
 *
 * Anything marked `reported` was found in a credible secondary source but the
 * primary source could not be read directly. Anything marked `unverified` must
 * be confirmed before filing.
 */

import { figure, type TaxYearFigures } from '../figures.js';

const IRS_SE = 'https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes';

export const FIGURES_2026: TaxYearFigures = {
  year: 2026,
  reviewed: false,
  reviewedOn: null,
  brackets: [],
  deadlines: [],
  figures: {
    // --- Self-employment tax: all statutory -------------------------------
    'se.socialSecurityRate': figure({
      key: 'se.socialSecurityRate',
      label: 'Social Security portion of self-employment tax',
      value: 0.124,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 1401(a)',
      source: IRS_SE,
      confidence: 'verified',
    }),
    'se.medicareRate': figure({
      key: 'se.medicareRate',
      label: 'Medicare portion of self-employment tax',
      value: 0.029,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 1401(b)',
      source: IRS_SE,
      confidence: 'verified',
    }),
    'se.netEarningsMultiplier': figure({
      key: 'se.netEarningsMultiplier',
      label: 'Net earnings from self-employment multiplier',
      value: 0.9235,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 1402(a)(12)',
      source: IRS_SE,
      confidence: 'verified',
      note: 'Net profit is multiplied by 92.35% before the tax applies, which approximates the employer-side deduction.',
    }),
    'se.minimumNetEarnings': figure({
      key: 'se.minimumNetEarnings',
      label: 'Net earnings below which no self-employment tax is due',
      value: 40000,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 1402(b)(2)',
      source: IRS_SE,
      confidence: 'verified',
      note: '$400. Below this, no self-employment tax — but the income is still reported.',
    }),
    'se.additionalMedicareRate': figure({
      key: 'se.additionalMedicareRate',
      label: 'Additional Medicare tax rate',
      value: 0.009,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 1401(b)(2)',
      source: 'https://www.irs.gov/taxtopics/tc560',
      confidence: 'verified',
    }),
    'se.additionalMedicareThreshold.single': figure({
      key: 'se.additionalMedicareThreshold.single',
      label: 'Additional Medicare tax threshold (single)',
      value: 20000000,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 1401(b)(2)(A)',
      source: 'https://www.irs.gov/taxtopics/tc560',
      confidence: 'verified',
      note: '$200,000. Deliberately NOT indexed for inflation, so it does not change year to year.',
    }),
    'se.additionalMedicareThreshold.marriedJoint': figure({
      key: 'se.additionalMedicareThreshold.marriedJoint',
      label: 'Additional Medicare tax threshold (married filing jointly)',
      value: 25000000,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 1401(b)(2)(A)',
      source: 'https://www.irs.gov/taxtopics/tc560',
      confidence: 'verified',
    }),
    'se.additionalMedicareThreshold.marriedSeparate': figure({
      key: 'se.additionalMedicareThreshold.marriedSeparate',
      label: 'Additional Medicare tax threshold (married filing separately)',
      value: 12500000,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 1401(b)(2)(A)',
      source: 'https://www.irs.gov/taxtopics/tc560',
      confidence: 'verified',
    }),

    // --- Indexed: must be re-checked every year ---------------------------
    'se.socialSecurityWageBase': figure({
      key: 'se.socialSecurityWageBase',
      label: 'Social Security wage base',
      value: 18450000,
      year: 2026,
      kind: 'indexed',
      authority: 'SSA announcement, 24 October 2025',
      source: 'https://www.ssa.gov/oact/cola/cbb.html',
      confidence: 'reported',
      note:
        '$184,500 for 2026. Found via secondary reporting; ssa.gov refused an automated request, so confirm ' +
        'against the SSA page before filing. Only the Social Security portion is capped — Medicare is uncapped.',
    }),

    // --- Collectibles -----------------------------------------------------
    'capital.collectiblesMaxRate': figure({
      key: 'capital.collectiblesMaxRate',
      label: 'Maximum rate on long-term collectibles gain',
      value: 0.28,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 1(h)(4)-(5); collectibles defined at IRC 408(m)',
      source: 'https://www.law.cornell.edu/uscode/text/26/408',
      confidence: 'verified',
      note:
        'A cap, not a flat rate. If your ordinary rate is below 28% you simply pay your ordinary rate. ' +
        'Applies only to a CAPITAL asset held more than a year — inventory never qualifies.',
    }),

    // --- Net investment income tax ----------------------------------------
    'niit.rate': figure({
      key: 'niit.rate',
      label: 'Net investment income tax rate',
      value: 0.038,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 1411',
      source: 'https://www.irs.gov/taxtopics/tc559',
      confidence: 'verified',
    }),
    'niit.threshold.single': figure({
      key: 'niit.threshold.single',
      label: 'Net investment income tax threshold (single)',
      value: 20000000,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 1411(b)',
      source: 'https://www.irs.gov/taxtopics/tc559',
      confidence: 'verified',
      note: 'Not indexed for inflation.',
    }),

    // --- Small business inventory relief ----------------------------------
    'inventory.grossReceiptsTest': figure({
      key: 'inventory.grossReceiptsTest',
      label: 'Gross receipts test for small business inventory relief',
      value: 3200000000,
      year: 2026,
      kind: 'indexed',
      authority: 'IRC 448(c), applied through IRC 471(c) and 263A(i); Rev. Proc. 2025-32',
      source: 'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf',
      confidence: 'reported',
      note:
        '$32,000,000 average annual gross receipts for 2026. A new card reseller is nowhere near it, so the ' +
        'simplified inventory treatment and exemption from uniform capitalisation both apply.',
    }),

    // --- Figures still to confirm -----------------------------------------
    'vehicle.standardMileageRate': figure({
      key: 'vehicle.standardMileageRate',
      label: 'Standard mileage rate (cents per mile)',
      value: 0,
      year: 2026,
      kind: 'indexed',
      authority: 'Announced annually by the IRS in a notice',
      source: 'https://www.irs.gov/tax-professionals/standard-mileage-rates',
      confidence: 'unverified',
      note:
        'Set every year and worth real money on show trips. Until it is confirmed, mileage is logged but not ' +
        'deducted, and the app says so rather than guessing.',
    }),
    'meals.deductiblePercent': figure({
      key: 'meals.deductiblePercent',
      label: 'Deductible share of business meals',
      value: 0.5,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 274(n)',
      source: 'https://www.irs.gov/publications/p463',
      confidence: 'reported',
      note:
        'Generally 50%. The temporary 100% allowance for restaurant meals applied only to 2021 and 2022. ' +
        'Confirm before relying on it.',
    }),
    'homeOffice.simplifiedRatePerSqFt': figure({
      key: 'homeOffice.simplifiedRatePerSqFt',
      label: 'Home office simplified method rate, per square foot',
      value: 500,
      year: 2026,
      kind: 'statutory',
      authority: 'Rev. Proc. 2013-13',
      source: 'https://www.irs.gov/businesses/small-businesses-self-employed/simplified-option-for-home-office-deduction',
      confidence: 'reported',
      note: '$5 per square foot. Unchanged since the simplified method was introduced, but confirm before filing.',
    }),
    'homeOffice.maxSquareFeet': figure({
      key: 'homeOffice.maxSquareFeet',
      label: 'Maximum area under the home office simplified method',
      value: 300,
      year: 2026,
      kind: 'statutory',
      authority: 'Rev. Proc. 2013-13',
      source: 'https://www.irs.gov/businesses/small-businesses-self-employed/simplified-option-for-home-office-deduction',
      confidence: 'reported',
      note: '300 square feet, capping the deduction at $1,500.',
    }),
    'deminimis.safeHarbor': figure({
      key: 'deminimis.safeHarbor',
      label: 'De minimis safe harbor per item, without an applicable financial statement',
      value: 250000,
      year: 2026,
      kind: 'statutory',
      authority: 'Treas. Reg. 1.263(a)-1(f)',
      source: 'https://www.irs.gov/businesses/small-businesses-self-employed/tangible-property-final-regulations',
      confidence: 'reported',
      note:
        '$2,500 per item or invoice. Requires a written accounting policy in place at the start of the year, ' +
        'and the election is made annually on the return.',
    }),
  },
};
