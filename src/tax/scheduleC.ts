/**
 * Schedule C (Form 1040), Profit or Loss From Business.
 *
 * This is the form a sole proprietor's card business lands on, and the app's
 * chart of accounts exists to fill it in. Every expense the user records is
 * tagged with an account, and every account names the Schedule C line it feeds,
 * so the year-end report is a line-by-line worksheet rather than a pile of
 * receipts someone still has to sort.
 *
 * Line numbers and titles are from the Schedule C form itself and have been
 * stable for years. They are still worth re-checking against the current year's
 * form before filing, which is why `SCHEDULE_C_FORM_YEAR` is recorded.
 */

export const SCHEDULE_C_FORM_YEAR = 2025;
export const SCHEDULE_C_SOURCE = 'https://www.irs.gov/forms-pubs/about-schedule-c-form-1040';

export type SchedulePart = 'income' | 'expenses' | 'cogs' | 'vehicle' | 'other';

export interface ScheduleCLine {
  line: string;
  title: string;
  part: SchedulePart;
}

/** The lines this application actually reports into. */
export const SCHEDULE_C_LINES: Record<string, ScheduleCLine> = {
  '1': { line: '1', title: 'Gross receipts or sales', part: 'income' },
  '2': { line: '2', title: 'Returns and allowances', part: 'income' },
  '4': { line: '4', title: 'Cost of goods sold (from line 42)', part: 'income' },
  '6': { line: '6', title: 'Other income', part: 'income' },

  '8': { line: '8', title: 'Advertising', part: 'expenses' },
  '9': { line: '9', title: 'Car and truck expenses', part: 'expenses' },
  '10': { line: '10', title: 'Commissions and fees', part: 'expenses' },
  '11': { line: '11', title: 'Contract labor', part: 'expenses' },
  '13': { line: '13', title: 'Depreciation and section 179 expense deduction', part: 'expenses' },
  '15': { line: '15', title: 'Insurance (other than health)', part: 'expenses' },
  '16b': { line: '16b', title: 'Interest — other', part: 'expenses' },
  '17': { line: '17', title: 'Legal and professional services', part: 'expenses' },
  '18': { line: '18', title: 'Office expense', part: 'expenses' },
  '20a': { line: '20a', title: 'Rent or lease — vehicles, machinery, and equipment', part: 'expenses' },
  '20b': { line: '20b', title: 'Rent or lease — other business property', part: 'expenses' },
  '21': { line: '21', title: 'Repairs and maintenance', part: 'expenses' },
  '22': { line: '22', title: 'Supplies', part: 'expenses' },
  '23': { line: '23', title: 'Taxes and licenses', part: 'expenses' },
  '24a': { line: '24a', title: 'Travel', part: 'expenses' },
  '24b': { line: '24b', title: 'Deductible meals', part: 'expenses' },
  '25': { line: '25', title: 'Utilities', part: 'expenses' },
  '27a': { line: '27a', title: 'Other expenses', part: 'expenses' },
  '30': { line: '30', title: 'Expenses for business use of your home', part: 'expenses' },

  '35': { line: '35', title: 'Inventory at beginning of year', part: 'cogs' },
  '36': { line: '36', title: 'Purchases less cost of items withdrawn for personal use', part: 'cogs' },
  '38': { line: '38', title: 'Materials and supplies', part: 'cogs' },
  '39': { line: '39', title: 'Other costs', part: 'cogs' },
  '41': { line: '41', title: 'Inventory at end of year', part: 'cogs' },
};

export interface Account {
  /** Stable key stored on every expense row. Never renamed. */
  key: string;
  name: string;
  scheduleCLine: string;
  /** What belongs here, in the user's own terms. */
  description: string;
  /** Concrete examples from a card business. */
  examples: string[];
  /** Substantiation rules, caps, or traps specific to this account. */
  caution?: string;
  /** True when the account feeds cost of goods sold rather than expenses. */
  isCogs?: boolean;
  /** True when the amount is computed by the app, not entered by hand. */
  computed?: boolean;
}

/**
 * The chart of accounts.
 *
 * Deliberately built around what a card reseller actually spends money on. A
 * generic accounting package offers "Office Supplies" and leaves the user to
 * guess where a $40 box of toploaders goes; this names it.
 */
export const ACCOUNTS: Account[] = [
  // --- Cost of goods sold -------------------------------------------------
  {
    key: 'inventory-purchases',
    name: 'Inventory purchases',
    scheduleCLine: '36',
    description: 'Cards and sealed product bought to resell, including what you paid to have it shipped to you.',
    examples: ['A stack of singles bought at a show', 'A sealed booster box', 'A collection bought from a private seller'],
    caution:
      'Recorded through Purchases, not here — the app tracks these as inventory so the cost is deducted when the item sells rather than when you bought it.',
    isCogs: true,
    computed: true,
  },
  {
    key: 'grading-fees',
    name: 'Grading fees',
    scheduleCLine: '39',
    description: 'PSA, BGS, SGC and CGC fees, plus shipping and insurance both ways.',
    examples: ['PSA submission fee', 'Insured shipping to the grader', 'Return shipping'],
    caution:
      'The app adds these to the cost basis of the specific cards graded, so they reduce the gain when a card sells rather than being deducted in the year you paid them.',
    isCogs: true,
    computed: true,
  },

  // --- Selling costs ------------------------------------------------------
  {
    key: 'platform-fees',
    name: 'Platform and seller fees',
    scheduleCLine: '10',
    description: 'What the selling platform keeps out of each sale.',
    examples: ['eBay final value fees', 'Whatnot commission', 'TCGplayer commission', 'COMC fees'],
    caution:
      'These are deductible even though you never see the money — the 1099-K reports the GROSS amount, so the fees must be deducted here or income is overstated.',
  },
  {
    key: 'payment-processing',
    name: 'Payment processing fees',
    scheduleCLine: '10',
    description: 'Card processing and payout fees.',
    examples: ['PayPal fees', 'Stripe fees', 'eBay payment processing', 'Instant payout fees'],
  },
  {
    key: 'shipping-out',
    name: 'Shipping and postage (outbound)',
    scheduleCLine: '27a',
    description: 'What it costs you to send a sold card to the buyer.',
    examples: ['USPS Ground Advantage label', 'eBay Standard Envelope', 'Insurance on a shipment', 'Signature confirmation'],
    caution: 'Shipping the buyer paid you is income; the label you bought is this expense. Record both.',
  },
  {
    key: 'shipping-supplies',
    name: 'Shipping and storage supplies',
    scheduleCLine: '22',
    description: 'Consumables used to protect and send cards.',
    examples: ['Penny sleeves', 'Toploaders', 'Card savers', 'Team bags', 'Bubble mailers', 'Painter’s tape', 'Boxes'],
  },
  {
    key: 'storage-display',
    name: 'Storage and display',
    scheduleCLine: '22',
    description: 'Binders, boxes, cases and organisers for holding inventory.',
    examples: ['Binders and pages', 'Cardboard storage boxes', 'Display case for shows', 'Slab cases'],
    caution: 'A single item costing more than the de minimis safe harbour amount may need to be depreciated instead.',
  },

  // --- Shows and travel ---------------------------------------------------
  {
    key: 'show-fees',
    name: 'Card show table and admission fees',
    scheduleCLine: '27a',
    description: 'What it costs to get in the door or set up a table.',
    examples: ['Vendor table fee', 'Dealer badge', 'Early admission', 'Booth electricity'],
  },
  {
    key: 'travel',
    name: 'Travel',
    scheduleCLine: '24a',
    description: 'Lodging and transport for business trips away from home overnight.',
    examples: ['Hotel at an out-of-state show', 'Flight to a national convention', 'Parking and tolls'],
    caution:
      'Only trips primarily for business qualify, and you must keep records of the date, place and business purpose.',
  },
  {
    key: 'meals',
    name: 'Business meals',
    scheduleCLine: '24b',
    description: 'Meals with a business purpose, and meals while travelling overnight for business.',
    examples: ['Meal while at an out-of-town show', 'Meal with a consignor or supplier'],
    caution:
      'Generally only 50% is deductible, and you must record who you were with and the business purpose. Enter the full amount; the app applies the limit.',
  },
  {
    key: 'vehicle',
    name: 'Vehicle',
    scheduleCLine: '9',
    description: 'Driving for the business.',
    examples: ['Driving to a card show', 'Trip to the post office', 'Driving to meet a seller'],
    caution:
      'Tracked through the Mileage log, which applies the standard mileage rate. Commuting from home to a regular workplace does not count.',
    computed: true,
  },

  // --- Overheads ----------------------------------------------------------
  {
    key: 'software',
    name: 'Software and subscriptions',
    scheduleCLine: '18',
    description: 'Tools and data the business runs on.',
    examples: ['Price guide subscription', 'Accounting software', 'Listing tools', 'Cloud storage'],
  },
  {
    key: 'office',
    name: 'Office expense',
    scheduleCLine: '18',
    description: 'General office costs.',
    examples: ['Printer paper and labels', 'Ink', 'Pens and folders', 'Postage for non-sales mail'],
  },
  {
    key: 'equipment',
    name: 'Equipment',
    scheduleCLine: '13',
    description: 'Durable items used in the business.',
    examples: ['Label printer', 'Digital scale', 'Camera or lighting for listings', 'Computer'],
    caution:
      'Items under the de minimis safe harbour amount can be expensed immediately if you elect it; larger items are depreciated or expensed under section 179.',
  },
  {
    key: 'internet-phone',
    name: 'Internet and phone',
    scheduleCLine: '25',
    description: 'Connectivity used for the business.',
    examples: ['Home internet', 'Mobile phone plan'],
    caution:
      'Only the business-use share is deductible. Enter the full bill and set the business-use percentage; the app applies it.',
  },
  {
    key: 'insurance',
    name: 'Business insurance',
    scheduleCLine: '15',
    description: 'Insurance protecting the business or its inventory.',
    examples: ['Collectibles or inventory rider', 'General liability for shows'],
  },
  {
    key: 'professional-fees',
    name: 'Legal and professional services',
    scheduleCLine: '17',
    description: 'Advisers you pay to keep the business right.',
    examples: ['CPA or tax preparer', 'Bookkeeper', 'Attorney for entity formation'],
    caution: 'The portion of a tax preparation fee attributable to Schedule C is a business deduction.',
  },
  {
    key: 'licenses-taxes',
    name: 'Taxes and licenses',
    scheduleCLine: '23',
    description: 'Business licence and registration fees, and business taxes other than income tax.',
    examples: ['City business licence', 'DBA registration', 'LLC annual renewal', 'Business personal property tax'],
    caution: 'Federal income tax and self-employment tax are NOT deductible here.',
  },
  {
    key: 'bank-fees',
    name: 'Bank and financing fees',
    scheduleCLine: '27a',
    description: 'Costs of the business bank account and any business borrowing.',
    examples: ['Business account monthly fee', 'Wire fees'],
  },
  {
    key: 'interest',
    name: 'Business loan interest',
    scheduleCLine: '16b',
    description: 'Interest on money borrowed for the business.',
    examples: ['Interest on a business credit card balance used only for inventory'],
  },
  {
    key: 'advertising',
    name: 'Advertising and promotion',
    scheduleCLine: '8',
    description: 'Getting the business in front of buyers.',
    examples: ['Promoted listings', 'Business cards', 'Social media ads', 'Show banner'],
    caution: 'eBay Promoted Listings fees belong here rather than with ordinary selling fees.',
  },
  {
    key: 'education',
    name: 'Education and reference',
    scheduleCLine: '27a',
    description: 'Materials that maintain or improve skills used in the business.',
    examples: ['Price guides', 'Grading reference books', 'Industry publications'],
  },
  {
    key: 'rent',
    name: 'Rent — business property',
    scheduleCLine: '20b',
    description: 'Rent for space used by the business.',
    examples: ['Storage unit for inventory', 'Booth rent at a mall or shop'],
  },
  {
    key: 'repairs',
    name: 'Repairs and maintenance',
    scheduleCLine: '21',
    description: 'Keeping business equipment working.',
    examples: ['Printer repair', 'Display case repair'],
  },
  {
    key: 'home-office',
    name: 'Business use of your home',
    scheduleCLine: '30',
    description: 'A portion of home costs, where a space is used regularly and exclusively for the business.',
    examples: ['Simplified method based on square footage'],
    caution:
      'The space must be used REGULARLY and EXCLUSIVELY for business. A desk in a room also used for other things does not qualify. Computed from your settings, not entered here.',
    computed: true,
  },
  {
    key: 'startup',
    name: 'Startup costs',
    scheduleCLine: '27a',
    description: 'Costs incurred investigating and setting up the business, before it opened.',
    examples: ['Research and travel before starting', 'Entity formation costs', 'Pre-opening advertising'],
    caution:
      'These are treated differently from ordinary expenses: a limited amount can be deducted in the first year and the rest is amortised. Flag these rather than mixing them in.',
  },
  {
    key: 'other',
    name: 'Other business expense',
    scheduleCLine: '27a',
    description: 'Anything ordinary and necessary for the business that does not fit above.',
    examples: [],
    caution: 'Describe it clearly — line 27a items are itemised on Part V of the form.',
  },
];

export const ACCOUNTS_BY_KEY: Record<string, Account> = Object.fromEntries(
  ACCOUNTS.map((a) => [a.key, a]),
);

export function accountFor(key: string): Account | null {
  return ACCOUNTS_BY_KEY[key] ?? null;
}

/** Accounts a user can pick when entering an expense by hand. */
export function selectableAccounts(): Account[] {
  return ACCOUNTS.filter((a) => !a.computed);
}
