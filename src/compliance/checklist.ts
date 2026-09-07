/**
 * The compliance checklist: everything that has to be done to run this business
 * legally, in the order it should be done.
 *
 * Organised by who is asking — federal, Utah, Davis County, city — because they
 * are separate agencies with separate rules, and the usual failure is assuming
 * that registering with one satisfies another. Getting an EIN does not register
 * you with Utah. A Utah sales tax licence is not a city business licence.
 *
 * Each task is marked:
 *   REQUIRED     the law requires it for this business
 *   CONDITIONAL  required only if something is true, and `appliesWhen` says what
 *   RECOMMENDED  not legally required, but doing it prevents predictable problems
 *
 * Every task carries the agency, the form number where there is one, a link,
 * and what it costs. Anything the app could not confirm from a primary source
 * says so rather than stating it as fact.
 */

import type { BusinessProfile, ComplianceTask } from '../domain/types.js';

/** Marks content that has not been confirmed against a primary source. */
export const UNCONFIRMED = 'NOT YET CONFIRMED — check the agency directly before relying on this.';

const FEDERAL: ComplianceTask[] = [
  {
    id: 'fed-ein',
    jurisdiction: 'federal',
    title: 'Get an EIN (Employer Identification Number)',
    detail:
      'A sole proprietor with no employees may use their Social Security number instead, but an EIN is free, ' +
      'takes about ten minutes online, and means you are not writing your SSN on forms for suppliers, ' +
      'consignors and marketplaces. Most banks want one to open a business account.',
    requirement: 'recommended',
    appliesWhen: 'Required if you form an LLC that is taxed as a partnership or corporation, or hire employees.',
    formNumber: 'SS-4',
    agency: 'Internal Revenue Service',
    url: 'https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online',
    estimatedCost: 'Free',
  },
  {
    id: 'fed-separate-account',
    jurisdiction: 'federal',
    title: 'Open a separate bank account for the business',
    detail:
      'Not a legal requirement for a sole proprietor, but it is the single highest-value thing on this list. ' +
      'Mixed personal and business money is what turns a routine examination into a painful one, and it is ' +
      'what most often defeats the argument that a personal collection is separate from inventory. ' +
      'Never buy a collection piece with the business card, and never deposit a collection sale into it.',
    requirement: 'recommended',
    appliesWhen: null,
    formNumber: null,
    agency: 'Any bank',
    url: null,
    estimatedCost: 'Usually free',
  },
  {
    id: 'fed-recordkeeping',
    jurisdiction: 'federal',
    title: 'Set up recordkeeping that can support every number on the return',
    detail:
      'The law requires records sufficient to establish income and deductions. In practice that means: a receipt ' +
      'for every purchase, a record of every sale, a mileage log with dates, destinations and business purposes, ' +
      'and the ability to show how any given card’s cost basis was arrived at. Keep records at least three years ' +
      'after filing, and longer for anything affecting the basis of something you still own — a card bought today ' +
      'and sold in six years needs its purchase receipt in six years.',
    requirement: 'required',
    appliesWhen: null,
    formNumber: null,
    agency: 'Internal Revenue Service',
    url: 'https://www.irs.gov/businesses/small-businesses-self-employed/recordkeeping',
    estimatedCost: 'Free',
  },
  {
    id: 'fed-estimated-tax',
    jurisdiction: 'federal',
    title: 'Pay quarterly estimated tax',
    detail:
      'Nobody withholds tax from a card sale. The IRS expects payment as income is earned, in four instalments, ' +
      'and charges an underpayment penalty when it is not — even if the return is filed on time and paid in full. ' +
      'Missing an instalment cannot be fixed by paying more later, so this is the deadline that costs money quietly.',
    requirement: 'conditional',
    appliesWhen: 'You expect to owe $1,000 or more in tax for the year after withholding and credits.',
    formNumber: '1040-ES',
    agency: 'Internal Revenue Service',
    url: 'https://www.irs.gov/forms-pubs/about-form-1040-es',
    estimatedCost: 'The tax itself',
  },
  {
    id: 'fed-schedule-c',
    jurisdiction: 'federal',
    title: 'File Schedule C and Schedule SE with your Form 1040',
    detail:
      'Business profit is reported on Schedule C, and self-employment tax on Schedule SE. Self-employment tax ' +
      'starts once net earnings reach $400 — a threshold low enough that a first partial year of card sales ' +
      'usually crosses it.',
    requirement: 'required',
    appliesWhen: null,
    formNumber: 'Schedule C, Schedule SE',
    agency: 'Internal Revenue Service',
    url: 'https://www.irs.gov/forms-pubs/about-schedule-c-form-1040',
    estimatedCost: 'The tax itself',
  },
  {
    id: 'fed-accounting-policy',
    jurisdiction: 'federal',
    title: 'Write a de minimis capitalisation policy before the year starts',
    detail:
      'Lets you expense equipment below a per-item threshold immediately instead of depreciating it. The policy ' +
      'has to be in writing and in place at the START of the tax year, and the election is made on the return. ' +
      'It is one page, and writing it in January is worth more than remembering it in April.',
    requirement: 'recommended',
    appliesWhen: 'You buy equipment — a printer, a scale, a display case, a camera.',
    formNumber: null,
    agency: 'Internal Revenue Service',
    url: 'https://www.irs.gov/businesses/small-businesses-self-employed/tangible-property-final-regulations',
    estimatedCost: 'Free',
  },
  {
    id: 'fed-investment-schedule',
    jurisdiction: 'federal',
    title: 'Document which cards are personal collection rather than inventory',
    detail:
      'If you hold cards as investments alongside cards held for resale, keep a dated written schedule of the ' +
      'investment ones, store them separately, and never list them for sale or run them through the business ' +
      'account. There is no statutory safe harbour for this with collectibles the way there is for securities ' +
      'dealers, so contemporaneous documentation is the best evidence available — and the case law that lets ' +
      'a dealer hold personal pieces turned on exactly that kind of separation.',
    requirement: 'conditional',
    appliesWhen: 'You hold any cards as a personal collection or investment rather than as stock in trade.',
    formNumber: null,
    agency: 'Internal Revenue Service',
    url: null,
    estimatedCost: 'Free',
  },
];

/**
 * Utah and Davis County requirements.
 *
 * Populated from research into the Utah State Tax Commission, the Utah Division
 * of Corporations, and Davis County city ordinances. Anything still marked
 * unconfirmed is flagged in the app rather than presented as settled.
 */
const UTAH: ComplianceTask[] = [
  {
    id: 'ut-dba',
    jurisdiction: 'state',
    title: 'Register a DBA, if you trade under a business name',
    detail:
      'Trading under your own legal name needs no filing at all. Using any trade name means registering an ' +
      'assumed name with the Utah Division of Corporations. Registration is $22 and it runs for THREE years, ' +
      'not one — renewal is $18. Several popular guides quote $27 for the renewal; the Division’s own fee ' +
      'schedule says $18.',
    requirement: 'conditional',
    appliesWhen: 'You use a business name that is not your own legal name.',
    formNumber: null,
    agency: 'Utah Division of Corporations and Commercial Code',
    url: 'https://commerce.utah.gov/corporations/business-entities/dba/',
    estimatedCost: '$22 to register, $18 every three years',
  },
  {
    id: 'ut-sales-tax-licence',
    jurisdiction: 'state',
    title: 'Get a Utah sales tax licence',
    detail:
      'Storing card inventory at home is a physical presence in Utah, so the $100,000 economic nexus threshold ' +
      'does not shelter you — that test is for out-of-state sellers. You need a licence as soon as you make ' +
      'taxable retail sales in Utah outside a marketplace, which in practice means the first cash sale at a ' +
      'show. It is free, applied for online, and the licence is not transferable.',
    requirement: 'conditional',
    appliesWhen: 'You make any sale in Utah that a marketplace does not collect tax on — card shows, local sales.',
    formNumber: 'TC-69',
    agency: 'Utah State Tax Commission',
    url: 'https://tap.utah.gov',
    estimatedCost: 'Free',
  },
  {
    id: 'ut-trust-fund',
    jurisdiction: 'state',
    title: 'Keep collected sales tax separate from your own money',
    detail:
      'Sales tax you collect is a TRUST FUND tax: you hold it for the state until you remit it, and it may not ' +
      'be used for anything else in the meantime. Personal liability attaches to it, which means it does not ' +
      'go away if the business does. Move it out of the operating account the day you collect it.',
    requirement: 'required',
    appliesWhen: 'You collect any sales tax yourself.',
    formNumber: null,
    agency: 'Utah State Tax Commission',
    url: 'https://files.tax.utah.gov/tax/forms/pubs/pub-25.pdf',
    estimatedCost: 'Free',
  },
  {
    id: 'ut-resale-certificate',
    jurisdiction: 'state',
    title: 'Use a resale exemption certificate when buying inventory',
    detail:
      'Buying stock you intend to resell can be exempt from sales tax by giving the seller an exemption ' +
      'certificate. Worth real money on wholesale purchases. It covers genuine resale inventory only — not ' +
      'supplies you use up, and not a card you decide to keep. Misusing it is the kind of thing that gets ' +
      'noticed on audit.',
    requirement: 'recommended',
    appliesWhen: 'You buy inventory from distributors or dealers who charge Utah sales tax.',
    formNumber: 'TC-721',
    agency: 'Utah State Tax Commission',
    url: 'https://tax.utah.gov/forms',
    estimatedCost: 'Free',
  },
  {
    id: 'ut-sales-tax-return',
    jurisdiction: 'state',
    title: 'File Utah sales tax returns on your assigned schedule',
    detail:
      'Once you hold a licence you file on the schedule the Tax Commission assigns, and a period with no sales ' +
      'still needs a zero return. Missing them is what turns a small tax bill into penalties.',
    requirement: 'conditional',
    appliesWhen: 'You hold a Utah sales tax licence.',
    formNumber: 'TC-62S or TC-62M',
    agency: 'Utah State Tax Commission',
    url: 'https://tax.utah.gov/sales',
    estimatedCost: 'The tax you collected',
  },
  {
    id: 'ut-show-rate',
    jurisdiction: 'state',
    title: 'Charge the SHOW’s rate at a show, not your home rate',
    detail:
      'Utah sources a sale at a temporary event to where the event is. A Layton seller at a Sunset show charges ' +
      '7.15%, not Layton’s 7.25%. Rates across Davis County differ only by a 0.10% municipal tax, so the ' +
      'amounts are small — but collecting the wrong rate is still collecting the wrong amount. Rates change ' +
      'quarterly, so check the chart before each event.',
    requirement: 'required',
    appliesWhen: 'You sell in person at shows or other temporary events.',
    formNumber: null,
    agency: 'Utah State Tax Commission',
    url: 'https://tax.utah.gov/sales/rates',
    estimatedCost: 'Free',
  },
  {
    id: 'ut-income-tax',
    jurisdiction: 'state',
    title: 'File a Utah individual income tax return',
    detail:
      'Utah taxes individual income at a flat 4.45% for 2026, down from 4.50% for 2025. It starts from federal ' +
      'adjusted gross income, so Schedule C profit flows straight through with no separate state business ' +
      'return. The rate has been cut in most recent years, so it is worth re-checking annually.',
    requirement: 'required',
    appliesWhen: null,
    formNumber: 'TC-40',
    agency: 'Utah State Tax Commission',
    url: 'https://incometax.utah.gov/paying/tax-rates',
    estimatedCost: '4.45% of taxable income for 2026',
  },
  {
    id: 'ut-personal-property',
    jurisdiction: 'county',
    title: 'Check business personal property tax with Davis County',
    detail:
      'Utah counties assess tax on business equipment. There is generally a small-business exemption, but it ' +
      'usually has to be claimed rather than applying automatically. ' + UNCONFIRMED,
    requirement: 'conditional',
    appliesWhen: 'You own business equipment such as a printer, display cases or a computer used for the business.',
    formNumber: null,
    agency: 'Davis County Assessor',
    url: 'https://www.daviscountyutah.gov/assessor',
    estimatedCost: UNCONFIRMED,
  },
  {
    id: 'local-business-licence',
    jurisdiction: 'city',
    title: 'Get a city business licence',
    detail:
      'Most Utah cities license businesses, including home-based ones, and the fees and rules differ city by ' +
      'city. This is the requirement online sellers most often miss, because nothing about selling on eBay ' +
      'feels like it should involve city hall. Check with YOUR city — a neighbouring city’s rules do not ' +
      'apply to you. ' + UNCONFIRMED,
    requirement: 'conditional',
    appliesWhen: 'Your city requires a licence for home-based businesses. Most Utah cities do.',
    formNumber: null,
    agency: 'Your city',
    url: null,
    estimatedCost: UNCONFIRMED,
  },
  {
    id: 'local-home-occupation',
    jurisdiction: 'city',
    title: 'Check home occupation and zoning rules',
    detail:
      'Cities that allow home businesses attach conditions: no customer traffic, no signage, limits on the ' +
      'share of the home used, no outside employees, restrictions on deliveries and storage. A card business ' +
      'in a spare room usually fits comfortably, but the permit is often still required. ' + UNCONFIRMED,
    requirement: 'conditional',
    appliesWhen: 'You operate from home.',
    formNumber: null,
    agency: 'Your city planning or zoning department',
    url: null,
    estimatedCost: UNCONFIRMED,
  },
];

/**
 * The checklist for a given business.
 *
 * Filtered by state so the app does not present Utah rules to someone who has
 * changed the profile to another state and would then be reading requirements
 * that do not apply to them.
 */
export function complianceChecklist(profile: BusinessProfile): ComplianceTask[] {
  const tasks = [...FEDERAL];
  if (profile.state.toUpperCase() === 'UT') {
    tasks.push(...UTAH);
  } else {
    tasks.push({
      id: 'state-unknown',
      jurisdiction: 'state',
      title: `State and local requirements for ${profile.state} are not built in`,
      detail:
        'This app was built around Utah and Davis County. Registration, sales tax and licensing rules differ by ' +
        'state and by city, so check with your own state tax authority and city before trading.',
      requirement: 'required',
      appliesWhen: null,
      formNumber: null,
      agency: `${profile.state} tax authority`,
      url: null,
      estimatedCost: null,
    });
  }
  return tasks;
}

export function unconfirmedTasks(profile: BusinessProfile): ComplianceTask[] {
  return complianceChecklist(profile).filter(
    (t) => t.detail.includes(UNCONFIRMED) || t.estimatedCost === UNCONFIRMED,
  );
}
