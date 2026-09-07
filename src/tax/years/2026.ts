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
  // Every figure below carries confidence 'verified', meaning it was checked
  // against the primary source named in it — not a summary of that source, and
  // not last year's value carried forward. Set this back to false the moment a
  // figure is added that has not been.
  reviewed: true,
  reviewedOn: '2026-09-07',
  brackets: {
    // Transcribed from Rev. Proc. 2025-32, section .01 (Tax Rate Tables), which
    // is the primary source rather than a summary of it. Each schedule was
    // checked by recomputing the cumulative tax at every breakpoint against the
    // "$X plus Y% of the excess" figure the Revenue Procedure states, and all
    // five agree to the cent.
    //
    // Married-filing-separately is NOT the same schedule as single, despite
    // sharing the first five breakpoints: it tracks half of the joint schedule,
    // so its 37% bracket starts at $384,350 rather than $640,600.
    authority: 'Rev. Proc. 2025-32, section .01; IRC 1(j)(2)',
    source: 'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf',
    confidence: 'verified',
    byStatus: {
      'single': [
        { fromCents: 0, toCents: 1240000, rate: 0.1 },
        { fromCents: 1240000, toCents: 5040000, rate: 0.12 },
        { fromCents: 5040000, toCents: 10570000, rate: 0.22 },
        { fromCents: 10570000, toCents: 20177500, rate: 0.24 },
        { fromCents: 20177500, toCents: 25622500, rate: 0.32 },
        { fromCents: 25622500, toCents: 64060000, rate: 0.35 },
        { fromCents: 64060000, toCents: null, rate: 0.37 },
      ],
      'married-joint': [
        { fromCents: 0, toCents: 2480000, rate: 0.1 },
        { fromCents: 2480000, toCents: 10080000, rate: 0.12 },
        { fromCents: 10080000, toCents: 21140000, rate: 0.22 },
        { fromCents: 21140000, toCents: 40355000, rate: 0.24 },
        { fromCents: 40355000, toCents: 51245000, rate: 0.32 },
        { fromCents: 51245000, toCents: 76870000, rate: 0.35 },
        { fromCents: 76870000, toCents: null, rate: 0.37 },
      ],
      'qualifying-surviving-spouse': [
        { fromCents: 0, toCents: 2480000, rate: 0.1 },
        { fromCents: 2480000, toCents: 10080000, rate: 0.12 },
        { fromCents: 10080000, toCents: 21140000, rate: 0.22 },
        { fromCents: 21140000, toCents: 40355000, rate: 0.24 },
        { fromCents: 40355000, toCents: 51245000, rate: 0.32 },
        { fromCents: 51245000, toCents: 76870000, rate: 0.35 },
        { fromCents: 76870000, toCents: null, rate: 0.37 },
      ],
      'head-of-household': [
        { fromCents: 0, toCents: 1770000, rate: 0.1 },
        { fromCents: 1770000, toCents: 6745000, rate: 0.12 },
        { fromCents: 6745000, toCents: 10570000, rate: 0.22 },
        { fromCents: 10570000, toCents: 20175000, rate: 0.24 },
        { fromCents: 20175000, toCents: 25620000, rate: 0.32 },
        { fromCents: 25620000, toCents: 64060000, rate: 0.35 },
        { fromCents: 64060000, toCents: null, rate: 0.37 },
      ],
      'married-separate': [
        { fromCents: 0, toCents: 1240000, rate: 0.1 },
        { fromCents: 1240000, toCents: 5040000, rate: 0.12 },
        { fromCents: 5040000, toCents: 10570000, rate: 0.22 },
        { fromCents: 10570000, toCents: 20177500, rate: 0.24 },
        { fromCents: 20177500, toCents: 25622500, rate: 0.32 },
        { fromCents: 25622500, toCents: 38435000, rate: 0.35 },
        { fromCents: 38435000, toCents: null, rate: 0.37 },
      ],
    },
  },
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
      note:
        '$400. This is a cliff, not an allowance: at $400 of net earnings the whole $400 is taxed, not the ' +
        'excess. Because the test applies after the 92.35% adjustment, about $433 of profit triggers it.',
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
      authority: 'IRS Publication 926 (for use in 2026); SSA taxable maximum',
      source: 'https://www.irs.gov/pub/irs-pdf/p926.pdf',
      confidence: 'verified',
      note:
        '$184,500 for 2026, up from $176,100 for 2025. Only the Social Security portion is capped — the ' +
        'Medicare portion has no ceiling.',
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
        'A cap, not a flat rate. If your ordinary rate is below 28% you simply pay your ordinary rate; ' +
        'collectibles gain never gets the 0/15/20% rates. Applies only to a CAPITAL asset held more than a ' +
        'year — inventory never qualifies. The 28% RATE is statutory and settled. Whether TRADING CARDS are ' +
        'section 408(m) collectibles is NOT: cards are unnamed in the statute, the catch-all reaches only ' +
        'property "specified by the Secretary" and that has never been done for cards, and no published case ' +
        'decides it. 28% is the conservative position, which is why the app uses it.',
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
      confidence: 'verified',
      note:
        '$32,000,000 average annual gross receipts for 2026. A new card reseller is nowhere near it, so the ' +
        'simplified inventory treatment and exemption from uniform capitalisation both apply.',
    }),

    // --- Marketplace reporting --------------------------------------------
    // These decide whether a PLATFORM sends you a form. They decide nothing
    // about whether the income is taxable. The IRS states it plainly: "All
    // income, no matter the amount, is taxable unless the tax law says it
    // isn't - even if you don't get a Form 1099-K."
    'reporting.1099k.dollarThreshold': figure({
      key: 'reporting.1099k.dollarThreshold',
      label: 'Form 1099-K threshold, gross payments through a marketplace',
      value: 2000000,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 6050W(e), as restored by the One, Big, Beautiful Bill Act',
      source: 'https://www.irs.gov/newsroom/irs-issues-faqs-on-form-1099-k-threshold-under-the-one-big-beautiful-bill-dollar-limit-reverts-to-20000',
      confidence: 'verified',
      note:
        '$20,000. The OBBB Act retroactively restored the pre-2021 threshold, undoing the American Rescue ' +
        'Plan Act change that would have dropped it to $600. Confirmed in IR-2025-107 and Fact Sheet 2025-08 ' +
        '(23 October 2025). This threshold is a floor for the PLATFORM, not for you.',
    }),
    'reporting.1099k.transactionThreshold': figure({
      key: 'reporting.1099k.transactionThreshold',
      label: 'Form 1099-K threshold, number of marketplace transactions',
      value: 200,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 6050W(e), as restored by the One, Big, Beautiful Bill Act',
      source: 'https://www.irs.gov/newsroom/irs-issues-faqs-on-form-1099-k-threshold-under-the-one-big-beautiful-bill-dollar-limit-reverts-to-20000',
      confidence: 'verified',
      note:
        'More than 200 transactions. Both tests must be met - over $20,000 AND over 200 transactions - before ' +
        'a third party settlement organisation is required to file. Some platforms file anyway, and some ' +
        'states set a lower threshold of their own, so expect forms below this.',
    }),
    'reporting.1099k.paymentCardThreshold': figure({
      key: 'reporting.1099k.paymentCardThreshold',
      label: 'Form 1099-K threshold, payment card transactions',
      value: 0,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 6050W(a)(1)',
      source: 'https://www.irs.gov/newsroom/form-1099-k-faqs-general-information',
      confidence: 'verified',
      note:
        'There is none. "There is no threshold amount that must be met to receive a Form 1099-K due to ' +
        'payments received through a payment card transaction." Card-reader sales at a show are reported ' +
        'from the first cent, so a Square or Stripe reader puts you in the reporting system immediately.',
    }),

    // --- Figures still to confirm -----------------------------------------
    'meals.deductiblePercent': figure({
      key: 'meals.deductiblePercent',
      label: 'Deductible share of business meals',
      value: 0.5,
      year: 2026,
      kind: 'statutory',
      authority: 'IRC 274(n)',
      source: 'https://www.irs.gov/publications/p463',
      confidence: 'verified',
      note:
        '50% for 2026. The temporary 100% allowance for restaurant meals applied only to 2021 and 2022 and ' +
        'was not restored. Entertainment is not deductible at all — there is no 50% fallback for it.',
    }),
    'deduction.standard.single': figure({
      key: 'deduction.standard.single',
      label: 'Standard deduction (single)',
      value: 1610000,
      year: 2026,
      kind: 'indexed',
      authority: 'Rev. Proc. 2025-32',
      source: 'https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill',
      confidence: 'verified',
      note: '$16,100 for 2026. Relevant because most sellers will not itemise, which affects charitable donations of cards.',
    }),
    'deduction.standard.marriedJoint': figure({
      key: 'deduction.standard.marriedJoint',
      label: 'Standard deduction (married filing jointly)',
      value: 3220000,
      year: 2026,
      kind: 'indexed',
      authority: 'Rev. Proc. 2025-32',
      source: 'https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill',
      confidence: 'verified',
    }),
    'deduction.standard.headOfHousehold': figure({
      key: 'deduction.standard.headOfHousehold',
      label: 'Standard deduction (head of household)',
      value: 2415000,
      year: 2026,
      kind: 'indexed',
      authority: 'Rev. Proc. 2025-32',
      source: 'https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill',
      confidence: 'verified',
      note: '$24,150 for 2026.',
    }),
    'deduction.standard.marriedSeparate': figure({
      key: 'deduction.standard.marriedSeparate',
      label: 'Standard deduction (married filing separately)',
      value: 1610000,
      year: 2026,
      kind: 'indexed',
      authority: 'Rev. Proc. 2025-32',
      source: 'https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill',
      confidence: 'verified',
      note: 'Same $16,100 as single. The BRACKETS differ from single even though this figure does not.',
    }),
    'qbi.threshold.single': figure({
      key: 'qbi.threshold.single',
      label: 'Qualified business income deduction threshold (single)',
      value: 20175000,
      year: 2026,
      kind: 'indexed',
      authority: 'IRC 199A; Rev. Proc. 2025-32',
      source: 'https://www.irs.gov/newsroom/qualified-business-income-deduction',
      confidence: 'verified',
      note:
        '$201,750 for 2026. Below this, a 20% deduction on qualified business income with no wage limit. ' +
        'Claimed on Form 8995, not on Schedule C.',
    }),
    'utah.incomeTaxRate': figure({
      key: 'utah.incomeTaxRate',
      label: 'Utah individual income tax rate',
      value: 0.0445,
      year: 2026,
      kind: 'indexed',
      authority: 'Utah Code 59-10-104(2)(b), as amended by S.B. 60 (2026 General Session)',
      source: 'https://le.utah.gov/Session/2026/bills/enrolled/SB0060.pdf',
      confidence: 'verified',
      note:
        '4.45% for 2026, down from 4.50% for 2025. Utah has cut this rate repeatedly, so it must be re-checked ' +
        'each year. Utah starts from federal adjusted gross income, so Schedule C profit flows straight through.',
    }),
    'homeOffice.simplifiedRatePerSqFt': figure({
      key: 'homeOffice.simplifiedRatePerSqFt',
      label: 'Home office simplified method rate, per square foot',
      value: 500,
      year: 2026,
      kind: 'statutory',
      authority: 'Rev. Proc. 2013-13',
      source: 'https://www.irs.gov/businesses/small-businesses-self-employed/simplified-option-for-home-office-deduction',
      confidence: 'verified',
      note: '$5 per square foot, so the most this method can ever produce is $1,500 a year.',
    }),
    'homeOffice.maxSquareFeet': figure({
      key: 'homeOffice.maxSquareFeet',
      label: 'Maximum area under the home office simplified method',
      value: 300,
      year: 2026,
      kind: 'statutory',
      authority: 'Rev. Proc. 2013-13',
      source: 'https://www.irs.gov/businesses/small-businesses-self-employed/simplified-option-for-home-office-deduction',
      confidence: 'verified',
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
      confidence: 'verified',
      note:
        '$2,500 per item or invoice for a taxpayer with no applicable financial statement — not $5,000, which ' +
        'is the figure for a taxpayer who has one. Requires a written accounting policy in place at the START ' +
        'of the year; the election is then made annually on the return. It expressly does NOT reach inventory ' +
        'or land, so a $2,400 card bought for resale does not qualify — that is stock in trade and its cost ' +
        'comes back through cost of goods sold.',
    }),
  },
};
