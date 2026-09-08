/**
 * The business domain.
 *
 * Modelled around how a card reseller actually operates rather than around
 * accounting abstractions: you buy a lot at a show, you open a box and it
 * becomes forty cards, you send one to PSA and it comes back a different (more
 * valuable) thing, you sell it on eBay and the platform hands you a payout that
 * is net of fees you still have to deduct somewhere.
 *
 * Every money field is integer cents. See domain/money.ts for why.
 */

import type { Cents } from './money.js';

/** ISO date, YYYY-MM-DD. Dates matter for tax years; times almost never do. */
export type IsoDate = string;

// ---------------------------------------------------------------------------
// Business profile
// ---------------------------------------------------------------------------

export type EntityType =
  | 'sole-proprietor'
  | 'single-member-llc'
  | 'multi-member-llc'
  | 's-corp'
  | 'c-corp';

/**
 * How the business treats inventory for tax.
 *
 * A small taxpayer under IRC 471(c) may skip formal inventory accounting and
 * treat inventory as non-incidental materials and supplies, which changes WHEN
 * a purchase becomes deductible. The choice materially changes taxable income,
 * so it is a stored setting rather than a hidden assumption.
 */
export type InventoryMethod =
  /** Track inventory; deduct cost only when the item sells. Schedule C Part III. */
  | 'inventory'
  /** IRC 471(c): deduct when the item is sold or otherwise disposed of. */
  | 'materials-and-supplies';

export type AccountingMethod = 'cash' | 'accrual';

export interface BusinessProfile {
  id: number;
  businessName: string;
  ownerName: string;
  entityType: EntityType;
  ein: string | null;
  /** Two-letter state. Drives which state tax rules apply. */
  state: string;
  county: string;
  city: string;
  accountingMethod: AccountingMethod;
  inventoryMethod: InventoryMethod;
  /** The date the business began, which starts the clock on startup costs. */
  startedOn: IsoDate | null;
  /** Filing status drives federal bracket and additional Medicare thresholds. */
  filingStatus: FilingStatus;
  /** Wage income from a day job, needed to compute SE tax and withholding. */
  otherIncomeCents: Cents;
  /** Federal income tax already withheld elsewhere, for estimated tax safe harbour. */
  otherWithholdingCents: Cents;
  /** Prior-year total tax, used for the 100%/110% estimated tax safe harbour. */
  priorYearTaxCents: Cents | null;
  priorYearAgiCents: Cents | null;
  /** Home office square footage, if claiming the simplified method. */
  homeOfficeSqFt: number | null;
  homeTotalSqFt: number | null;
  updatedAt: string;
}

export type FilingStatus =
  | 'single'
  | 'married-joint'
  | 'married-separate'
  | 'head-of-household'
  | 'qualifying-surviving-spouse';

// ---------------------------------------------------------------------------
// Purchases and inventory
// ---------------------------------------------------------------------------

export type AcquisitionChannel =
  | 'card-show'
  | 'online-marketplace'
  | 'retail-store'
  | 'distributor'
  | 'private-sale'
  | 'trade'
  | 'personal-collection'
  | 'other';

/**
 * One buying event.
 *
 * A lot is the unit the money was actually spent in — a $400 payment at a show
 * for a stack of cards, or a $161.64 booster box. Its total cost (including
 * shipping and non-recoverable tax) is what gets allocated across whatever
 * items came out of it.
 */
export interface PurchaseLot {
  id: number;
  purchasedOn: IsoDate;
  vendor: string;
  channel: AcquisitionChannel;
  description: string;
  /** Price of the goods themselves. */
  subtotalCents: Cents;
  /** Inbound shipping, which is part of the cost of the goods. */
  shippingCents: Cents;
  /**
   * Sales tax paid on the purchase. Part of basis when you paid it; zero when
   * you bought exempt for resale with a TC-721.
   */
  taxCents: Cents;
  /** Buyer's premium, auction fees, anything else that came with the goods. */
  feesCents: Cents;
  paymentMethod: string | null;
  /** Whether the purchase was made exempt from sales tax for resale. */
  resaleExemptionUsed: boolean;
  notes: string | null;
  receiptPath: string | null;
  createdAt: string;
}

export type ItemKind =
  /** A single card. */
  | 'single'
  /** Sealed product intended to be resold sealed. */
  | 'sealed'
  /** Sealed product intended to be opened. */
  | 'sealed-to-open'
  /** Supplies consumed by the business: sleeves, toploaders, boxes. */
  | 'supply'
  /** Equipment: a printer, a scale, a display case. */
  | 'equipment';

export type ItemStatus =
  | 'on-hand'
  | 'listed'
  | 'at-grading'
  | 'sold'
  /** A sealed item that was opened; its basis moved to its children. */
  | 'opened'
  /** Withdrawn to the owner's personal collection. */
  | 'personal-use'
  | 'lost'
  | 'donated';

/**
 * Why the business holds this item.
 *
 * This is the dealer-versus-investor question, recorded per item because the
 * answer genuinely differs across a single person's holdings. Inventory held
 * for resale produces ordinary income on Schedule C; a long-held personal
 * collection piece is a capital asset whose gain may be taxed at the
 * collectibles rate. Guessing costs real money in either direction.
 */
export type HoldingIntent = 'inventory' | 'investment';

export interface InventoryItem {
  id: number;
  lotId: number | null;
  /** Set when this item came out of an opened box or a split lot. */
  parentItemId: number | null;
  kind: ItemKind;
  holdingIntent: HoldingIntent;
  description: string;
  /** Category, set, year — enough to identify it on an inventory report. */
  category: string | null;
  setName: string | null;
  year: number | null;
  quantity: number;
  acquiredOn: IsoDate;
  /**
   * Cost basis in cents, allocated from the lot plus any capitalised costs
   * (grading fees, inbound shipping). This is what becomes COGS on sale.
   */
  basisCents: Cents;
  /** Fair market value, used to allocate lot cost and to value inventory. */
  estimatedValueCents: Cents | null;
  status: ItemStatus;
  gradedBy: string | null;
  grade: string | null;
  certNumber: string | null;
  location: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Record of a sealed item being opened into its contents. */
export interface OpeningEvent {
  id: number;
  itemId: number;
  openedOn: IsoDate;
  /** How the box's basis was spread across what came out of it. */
  allocationMethod: BasisAllocationMethod;
  notes: string | null;
  createdAt: string;
}

/**
 * How a lot's cost is spread across the items in it.
 *
 * Relative fair market value is the general rule for allocating the cost of
 * property bought in a lot; it is what an accountant will expect to see. Equal
 * split is a pragmatic fallback for genuinely homogeneous product, and is
 * clearly wrong for an opened box where one card is 90% of the value.
 */
export type BasisAllocationMethod = 'relative-fmv' | 'equal' | 'manual';

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export interface GradingSubmission {
  id: number;
  grader: string;
  serviceLevel: string | null;
  submittedOn: IsoDate;
  returnedOn: IsoDate | null;
  submissionNumber: string | null;
  /** Grading fees for the whole submission, allocated across its cards. */
  feeCents: Cents;
  shippingToCents: Cents;
  shippingBackCents: Cents;
  insuranceCents: Cents;
  notes: string | null;
  createdAt: string;
}

export interface GradingSubmissionItem {
  submissionId: number;
  itemId: number;
  /** Grade assigned on return, once known. */
  resultGrade: string | null;
  certNumber: string | null;
  /** Share of the submission's costs added to this card's basis. */
  allocatedCostCents: Cents;
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export type SalesChannel =
  | 'ebay'
  | 'whatnot'
  | 'tcgplayer'
  | 'comc'
  | 'mercari'
  | 'fanatics-collect'
  | 'card-show'
  | 'local-in-person'
  | 'website'
  // A trade is a disposition like any other: what you received is the proceeds.
  | 'trade'
  | 'other';

export interface Sale {
  id: number;
  soldOn: IsoDate;
  channel: SalesChannel;
  orderRef: string | null;
  buyerState: string | null;
  /**
   * What the buyer paid for the goods, before shipping and sales tax.
   * This is the figure that rolls up into Schedule C gross receipts.
   */
  grossCents: Cents;
  /** Shipping the buyer paid. Income to the business; the label is an expense. */
  shippingChargedCents: Cents;
  /**
   * Sales tax collected from the buyer. NOT income — it is money held for the
   * state. Marketplaces normally collect and remit this themselves.
   */
  salesTaxCollectedCents: Cents;
  /** True when the platform collected and remitted the tax as a facilitator. */
  salesTaxRemittedByPlatform: boolean;
  platformFeeCents: Cents;
  paymentProcessingFeeCents: Cents;
  /** What the business paid to ship it. */
  shippingCostCents: Cents;
  otherFeeCents: Cents;
  refundedCents: Cents;
  notes: string | null;
  createdAt: string;
}

export interface SaleLine {
  saleId: number;
  itemId: number;
  quantity: number;
  /** Portion of the sale's gross attributable to this item. */
  allocatedGrossCents: Cents;
  /** Basis relieved from inventory, which becomes cost of goods sold. */
  cogsCents: Cents;
}

// ---------------------------------------------------------------------------
// Expenses, mileage, payouts
// ---------------------------------------------------------------------------

export interface Expense {
  id: number;
  incurredOn: IsoDate;
  /** Chart-of-accounts key; maps to a Schedule C line. */
  accountKey: string;
  vendor: string | null;
  description: string;
  amountCents: Cents;
  /**
   * Business-use percentage for mixed-use costs like a phone or internet.
   * Only this share is deductible.
   */
  businessUsePercent: number;
  paymentMethod: string | null;
  receiptPath: string | null;
  notes: string | null;
  createdAt: string;
}

export interface MileageTrip {
  id: number;
  drivenOn: IsoDate;
  purpose: string;
  fromLocation: string | null;
  toLocation: string | null;
  miles: number;
  roundTrip: boolean;
  /** Odometer readings, which is what substantiation under IRC 274(d) wants. */
  odometerStart: number | null;
  odometerEnd: number | null;
  notes: string | null;
  createdAt: string;
}

/**
 * A platform payout.
 *
 * Tracked separately from sales because the two do not line up: a payout covers
 * many sales, arrives days later, and is already net of fees. Reconciling the
 * two is where resellers most often misstate gross receipts.
 */
export interface Payout {
  id: number;
  channel: SalesChannel;
  receivedOn: IsoDate;
  periodStart: IsoDate | null;
  periodEnd: IsoDate | null;
  grossCents: Cents;
  feesCents: Cents;
  refundsCents: Cents;
  shippingLabelsCents: Cents;
  salesTaxCents: Cents;
  netCents: Cents;
  reference: string | null;
  notes: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

export type Jurisdiction = 'federal' | 'state' | 'county' | 'city';
export type Requirement = 'required' | 'conditional' | 'recommended';

export interface ComplianceTask {
  id: string;
  jurisdiction: Jurisdiction;
  title: string;
  detail: string;
  requirement: Requirement;
  /** What makes this apply, when it is conditional. */
  appliesWhen: string | null;
  formNumber: string | null;
  agency: string;
  url: string | null;
  estimatedCost: string | null;
}

export interface ComplianceStatus {
  taskId: string;
  completed: boolean;
  completedOn: IsoDate | null;
  reference: string | null;
  notes: string | null;
  notApplicable: boolean;
  updatedAt: string;
}

export interface Deadline {
  id: string;
  jurisdiction: Jurisdiction;
  title: string;
  detail: string;
  formNumber: string | null;
  /** ISO date this instance is due. */
  dueOn: IsoDate;
  appliesWhen: string | null;
  url: string | null;
}
