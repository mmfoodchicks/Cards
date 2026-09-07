/** Typed client for the CardLedger API. */

export interface Profile {
  id: number;
  businessName: string;
  ownerName: string;
  entityType: string;
  ein: string | null;
  state: string;
  county: string;
  city: string;
  accountingMethod: 'cash' | 'accrual';
  inventoryMethod: 'inventory' | 'materials-and-supplies';
  startedOn: string | null;
  filingStatus: string;
  otherIncomeCents: number;
  otherWithholdingCents: number;
  priorYearTaxCents: number | null;
  priorYearAgiCents: number | null;
  homeOfficeSqFt: number | null;
  homeTotalSqFt: number | null;
}

export interface TaxFigure {
  key: string;
  label: string;
  value: number;
  year: number;
  kind: 'statutory' | 'indexed';
  authority: string;
  source: string;
  confidence: 'verified' | 'reported' | 'unverified';
  note?: string;
}

export interface Health {
  ok: boolean;
  taxYear: number;
  availableTaxYears: number[];
  figureHealth: { needsAttention: TaxFigure[]; reviewed: boolean } | null;
  counts: { onHand: number; purchases: number; sales: number; expenses: number; trips: number; atGrading: number };
  profile: Profile;
}

export interface Item {
  id: number;
  lotId: number | null;
  parentItemId: number | null;
  kind: string;
  holdingIntent: 'inventory' | 'investment';
  description: string;
  category: string | null;
  setName: string | null;
  year: number | null;
  quantity: number;
  acquiredOn: string;
  basisCents: number;
  estimatedValueCents: number | null;
  status: string;
  gradedBy: string | null;
  grade: string | null;
  certNumber: string | null;
  location: string | null;
  notes: string | null;
}

export interface Account {
  key: string;
  name: string;
  scheduleCLine: string;
  description: string;
  examples: string[];
  caution?: string;
}

export interface ExpenseLine {
  line: string;
  title: string;
  accountKey: string;
  accountName: string;
  grossCents: number;
  deductibleCents: number;
  limitNote: string | null;
}

export interface ProfitLoss {
  year: number;
  inventoryMethod: string;
  grossReceiptsCents: number;
  returnsAndAllowancesCents: number;
  netReceiptsCents: number;
  cogsCents: number;
  grossProfitCents: number;
  grossIncomeCents: number;
  expenseLines: ExpenseLine[];
  totalExpensesCents: number;
  tentativeProfitCents: number;
  homeOfficeCents: number;
  netProfitCents: number;
  cogs: {
    beginningInventoryCents: number;
    purchasesCents: number;
    personalWithdrawalsCents: number;
    otherCostsCents: number;
    goodsAvailableCents: number;
    endingInventoryCents: number;
    cogsCents: number;
    cogsFromSalesCents: number;
    differenceCents: number;
    warning: string | null;
  };
  mileage: {
    totalMiles: number;
    deductionCents: number;
    unratedMiles: number;
    bands: Array<{ from: string; to: string; centsPerMile: number; miles: number; deductionCents: number; authority: string; source: string }>;
    notes: string[];
  };
  salesTaxCollectedCents: number;
  warnings: string[];
}

export interface SelfEmployment {
  netEarningsCents: number;
  socialSecurityCents: number;
  medicareCents: number;
  additionalMedicareCents: number;
  totalCents: number;
  deductionCents: number;
  explanation: string[];
  unverified: string[];
}

export interface EstimatedTax {
  year: number;
  safeHarbor: {
    requiredCents: number;
    basis: string;
    currentYearTestCents: number;
    priorYearTestCents: number | null;
    netRequiredCents: number;
    explanation: string[];
  };
  quarters: Array<{
    period: { quarter: number; periodStart: string; periodEnd: string; dueOn: string };
    instalmentCents: number;
    expectedCumulativeCents: number;
    paidCents: number;
    shortfallCents: number;
    status: string;
    daysUntilDue: number;
  }>;
  remainingCents: number;
  warnings: string[];
  projectionBasis: string;
  selfEmployment: SelfEmployment | null;
  setAside: { seOnlyRate: number; suggestedRate: number | null; explanation: string };
  figuresNeedingCheck: Array<{ key: string; label: string; source: string; note: string | null }>;
}

export interface Guidance {
  id: string;
  severity: 'opportunity' | 'caution' | 'information';
  title: string;
  because: string;
  body: string[];
  worthCents?: number;
  steps?: string[];
}

export interface ComplianceTask {
  id: string;
  jurisdiction: string;
  title: string;
  detail: string;
  requirement: 'required' | 'conditional' | 'recommended';
  appliesWhen: string | null;
  formNumber: string | null;
  agency: string;
  url: string | null;
  estimatedCost: string | null;
  completed: boolean;
  completedOn: string | null;
  notApplicable: boolean;
}

export interface DeadlineItem {
  id: string;
  jurisdiction: string;
  title: string;
  detail: string;
  formNumber: string | null;
  dueOn: string;
  daysAway: number;
  urgency: 'overdue' | 'imminent' | 'soon' | 'later';
  url: string | null;
}

export interface CapitalGains {
  year: number;
  dispositions: Array<{
    itemId: number; description: string; acquiredOn: string; soldOn: string;
    proceedsCents: number; basisCents: number; gainCents: number;
    term: string; daysHeld: number; collectiblesRate: boolean;
  }>;
  shortTermGainCents: number;
  longTermGainCents: number;
  collectiblesGainCents: number;
  totalGainCents: number;
  notes: string[];
}

export interface ScheduleC {
  year: number;
  generatedAt: string;
  profitLoss: ProfitLoss;
  selfEmployment: SelfEmployment | null;
  capitalGains: CapitalGains;
  homeOffice: { deductionCents: number; qualifyingSqFt: number; requirements: string[] } | null;
  beginningInventory: { inventoryBasisCents: number; inventoryCount: number };
  endingInventory: { inventoryBasisCents: number; inventoryCount: number; investmentBasisCents: number; zeroBasisCount: number };
  vehicle: { totalBusinessMiles: number; tripCount: number };
  figuresNeedingCheck: Array<{ key: string; label: string; source: string; note: string | null }>;
  warnings: string[];
  disclaimer: string;
}

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* not JSON; the status is the best we have */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

const post = <T,>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  health: () => request<Health>('/health'),
  profile: () => request<Profile>('/profile'),
  saveProfile: (patch: Partial<Profile>) => request<Profile>('/profile', { method: 'PUT', body: JSON.stringify(patch) }),

  accounts: () => request<{ accounts: Account[] }>('/accounts'),
  figures: (year: number) => request<{ figures: TaxFigure[] }>(`/tax/figures/${year}`),

  items: (params: Record<string, string | number | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
    return request<{ items: Item[]; total: number }>(`/items?${q.toString()}`);
  },
  updateItem: (id: number, patch: Record<string, unknown>) =>
    request<Item>(`/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  openItem: (id: number, body: unknown) => post<unknown>(`/items/${id}/open`, body),
  withdrawItem: (id: number, reason: string) => post<Item>(`/items/${id}/withdraw`, { reason }),

  purchases: () => request<{ purchases: unknown[] }>('/purchases'),
  recordPurchase: (body: unknown) => post<{ lotId: number; items: Item[] }>('/purchases', body),

  sales: (year?: number) =>
    request<{ sales: unknown[] }>(year ? `/sales?from=${year}-01-01&to=${year}-12-31` : '/sales'),
  recordSale: (body: unknown) => post<unknown>('/sales', body),

  expenses: (year?: number) =>
    request<{ expenses: Array<{ id: number; incurredOn: string; accountKey: string; vendor: string | null; description: string; amountCents: number; businessUsePercent: number }> }>(
      year ? `/expenses?from=${year}-01-01&to=${year}-12-31` : '/expenses',
    ),
  recordExpense: (body: unknown) => post<unknown>('/expenses', body),
  deleteExpense: (id: number) => request<unknown>(`/expenses/${id}`, { method: 'DELETE' }),

  mileage: (year?: number) =>
    request<{ trips: Array<{ id: number; drivenOn: string; purpose: string; fromLocation: string | null; toLocation: string | null; miles: number; roundTrip: boolean }> }>(
      year ? `/mileage?from=${year}-01-01&to=${year}-12-31` : '/mileage',
    ),
  recordTrip: (body: unknown) => post<unknown>('/mileage', body),
  deleteTrip: (id: number) => request<unknown>(`/mileage/${id}`, { method: 'DELETE' }),

  grading: () => request<{ submissions: unknown[] }>('/grading'),
  recordSubmission: (body: unknown) => post<unknown>('/grading', body),
  receiveGraded: (id: number, body: unknown) => post<unknown>(`/grading/${id}/receive`, body),

  scheduleC: (year: number) => request<ScheduleC>(`/reports/schedule-c?year=${year}`),
  estimatedTax: (year: number) => request<EstimatedTax>(`/reports/estimated-tax?year=${year}`),
  capitalGains: (year: number) => request<CapitalGains>(`/reports/capital-gains?year=${year}`),
  investmentSchedule: () =>
    request<{ generatedAt: string; entries: Array<Record<string, unknown>>; totalBasisCents: number; totalValueCents: number; guidance: string[] }>(
      '/reports/investment-schedule',
    ),

  guidance: () => request<{ guidance: Guidance[] }>('/guidance'),
  compliance: () => request<{ tasks: ComplianceTask[]; deadlines: DeadlineItem[] }>('/compliance'),
  setCompliance: (taskId: string, patch: Record<string, unknown>) =>
    request<unknown>(`/compliance/${taskId}`, { method: 'PUT', body: JSON.stringify(patch) }),
};

// --- formatting -------------------------------------------------------------

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  const negative = cents < 0;
  const body = (Math.abs(cents) / 100).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return negative ? `-${body}` : body;
}

/** Parse what a person types into cents, tolerating "$", commas and blanks. */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '-') return 0;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(`${iso}T00:00:00`);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
