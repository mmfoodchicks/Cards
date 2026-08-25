/** Typed client for the CardHawk API. */

export interface Listing {
  id: string;
  source: string;
  title: string;
  url: string;
  imageUrl: string | null;
  priceCents: number;
  shippingCents: number | null;
  shippingUnknown: boolean;
  landedCents: number;
  unitCents: number;
  quantity: number;
  listingType: string;
  bidCount: number | null;
  endsAt: string | null;
  sellerName: string | null;
  sellerFeedbackPct: number | null;
  sellerFeedbackCount: number | null;
  category: string | null;
  productType: string | null;
  setName: string | null;
  year: number | null;
  sealed: boolean;
  graded: boolean;
  grader: string | null;
  grade: number | null;
  benchmarkKind: string;
  benchmarkCents: number | null;
  benchmarkLabel: string | null;
  benchmarkSource: string | null;
  discountPct: number | null;
  savingsCents: number | null;
  label: string;
  labelTitle: string;
  labelTone: 'hot' | 'good' | 'neutral' | 'warn';
  underMsrp: boolean;
  confidence: number;
  score: number;
  notes: string[];
  redFlags: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  goneAt: string | null;
}

export interface Watch {
  id: number;
  name: string;
  query: string;
  sources: string[];
  category: string | null;
  productType: string | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  minDiscountPct: number;
  sealedOnly: boolean;
  gradedOnly: boolean;
  excludeLots: boolean;
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface SourceStatus {
  id: string;
  name: string;
  configured: boolean;
  reason: string | null;
  capabilities?: { soldComps: boolean; auctions: boolean; gradedFilter: boolean; needsCredentials: boolean };
}

export interface Health {
  ok: boolean;
  counts: {
    listings: number;
    underMsrp: number;
    observations: number;
    baselines: number;
    activeWatches: number;
    alerts: number;
  };
  quota: { usedToday: number; dailyBudget: number; remaining: number };
  scheduler: { enabled: boolean; tickSeconds: number };
  notifications: { configured: boolean };
  sources: SourceStatus[];
  compProviders: SourceStatus[];
  defaultSources: string[];
}

export interface CatalogEntry {
  id: string;
  category: string;
  brand: string;
  year: number;
  setName: string;
  productType: string;
  variant: string | null;
  msrpCents: number;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  edited: boolean;
  note: string | null;
}

/**
 * In production the API is served from the same origin. In development Vite
 * proxies /api to the server, so a relative base works in both cases.
 */
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
      /* response was not JSON; the status line is the best we have */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export interface DealQuery {
  labels?: string[];
  underMsrpOnly?: boolean;
  category?: string;
  sealedOnly?: boolean;
  gradedOnly?: boolean;
  minDiscountPct?: number;
  maxPrice?: number;
  endingWithinHours?: number;
  search?: string;
  sort?: string;
  limit?: number;
}

export const api = {
  health: () => request<Health>('/health'),

  deals: (q: DealQuery = {}) => {
    const params = new URLSearchParams();
    if (q.labels?.length) params.set('labels', q.labels.join(','));
    if (q.underMsrpOnly) params.set('underMsrpOnly', 'true');
    if (q.category) params.set('category', q.category);
    if (q.sealedOnly) params.set('sealedOnly', 'true');
    if (q.gradedOnly) params.set('gradedOnly', 'true');
    if (q.minDiscountPct != null) params.set('minDiscountPct', String(q.minDiscountPct));
    if (q.maxPrice != null) params.set('maxPrice', String(q.maxPrice));
    if (q.endingWithinHours != null) params.set('endingWithinHours', String(q.endingWithinHours));
    if (q.search) params.set('search', q.search);
    if (q.sort) params.set('sort', q.sort);
    params.set('limit', String(q.limit ?? 60));
    return request<{ total: number; listings: Listing[] }>(`/deals?${params.toString()}`);
  },

  search: (body: Record<string, unknown>) =>
    request<{ warnings: string[]; errors: string[]; total: number; listings: Listing[] }>('/search', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  watches: () => request<{ watches: Watch[] }>('/watches'),
  createWatch: (body: Record<string, unknown>) =>
    request<Watch>('/watches', { method: 'POST', body: JSON.stringify(body) }),
  updateWatch: (id: number, body: Record<string, unknown>) =>
    request<Watch>(`/watches/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteWatch: (id: number) => request<{ deleted: boolean }>(`/watches/${id}`, { method: 'DELETE' }),
  runWatch: (id: number) =>
    request<{ seen: number; newListings: number; deals: number; callsUsed: number; warnings: string[]; errors: string[] }>(
      `/watches/${id}/run`,
      { method: 'POST' },
    ),

  catalog: (search?: string) =>
    request<{ entries: CatalogEntry[] }>(`/catalog${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  saveCatalogEntry: (entryId: string, body: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/catalog/${encodeURIComponent(entryId)}`, { method: 'PUT', body: JSON.stringify(body) }),

  rebuild: () => request<unknown>('/maintenance/rebuild-baselines', { method: 'POST' }),
};

// --- formatting -------------------------------------------------------------

export function money(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function percent(fraction: number | null | undefined): string {
  if (fraction == null) return '—';
  return `${fraction > 0 ? '' : ''}${Math.round(fraction * 100)}%`;
}

/** "3d 4h", "42m" — compact enough for a phone, precise enough to act on. */
export function timeUntil(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'ended';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
