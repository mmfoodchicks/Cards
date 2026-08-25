/**
 * PriceCharting — paid, but the widest single-vendor coverage available:
 * sports cards, every major TCG, graded slabs and sealed product in one API.
 *
 * Two properties shape this adapter. Prices come back as INTEGER PENNIES
 * already, so no float conversion is needed. And the API is rate-limited to
 * roughly one call per second, so lookups are spaced out and cached rather
 * than issued per listing.
 */

import { config } from '../../config.js';
import type { ParsedListing } from '../../types.js';
import { logger } from '../../util/logger.js';
import type { CompProvider, CompQuote } from './types.js';

const log = logger('pricecharting');
const BASE = 'https://www.pricecharting.com/api';

/**
 * PriceCharting reports several prices per product, keyed by condition. For
 * cards the graded tiers matter most, and picking the wrong tier is the
 * difference between a $40 card and a $400 one.
 */
interface PriceChartingProduct {
  id?: string;
  'product-name'?: string;
  'console-name'?: string;
  /** Ungraded, in pennies. */
  'loose-price'?: number;
  /** Grade 7-8. */
  'cib-price'?: number;
  /** Grade 9. */
  'new-price'?: number;
  /** PSA 10. */
  'manual-only-price'?: number;
  /** BGS 9.5. */
  'box-only-price'?: number;
  /** Grade 10 (non-PSA). */
  'graded-price'?: number;
}

export class PriceChartingProvider implements CompProvider {
  readonly id = 'pricecharting';
  readonly displayName = 'PriceCharting';

  isConfigured(): boolean {
    return config.priceChartingToken !== '';
  }

  unavailableReason(): string | null {
    return this.isConfigured()
      ? null
      : 'Set PRICECHARTING_TOKEN in .env. Their API is on the paid "Legendary" tier — see docs/DATA_SOURCES.md.';
  }

  supports(parsed: ParsedListing): boolean {
    if (!this.isConfigured()) return false;
    // Covers sealed product and singles across every category it knows.
    return parsed.productKey !== null;
  }

  async quote(parsed: ParsedListing): Promise<CompQuote | null> {
    if (!this.supports(parsed)) return null;

    const query = buildQuery(parsed);
    if (!query) return null;

    try {
      const params = new URLSearchParams({ t: config.priceChartingToken, q: query });
      const res = await fetch(`${BASE}/product?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        log.warn(`PriceCharting returned HTTP ${res.status}`);
        return null;
      }
      const product = (await res.json()) as PriceChartingProduct & { status?: string };
      if (product.status && product.status !== 'success') return null;

      const picked = pickGradeTier(product, parsed);
      if (picked === null) return null;

      return {
        valueCents: picked.cents,
        basis: `PriceCharting ${picked.tier}`,
        sampleSize: null,
        provider: this.id,
        detail: { productId: product.id, productName: product['product-name'], set: product['console-name'] },
      };
    } catch (err) {
      log.warn('PriceCharting lookup failed', err instanceof Error ? err.message : String(err));
      return null;
    }
  }
}

function buildQuery(parsed: ParsedListing): string | null {
  const bits = [
    parsed.year ? String(parsed.year) : '',
    parsed.setName ?? '',
    parsed.subject ?? '',
    parsed.cardNumber ? `#${parsed.cardNumber}` : '',
    parsed.sealed ? parsed.productType.replace(/-/g, ' ') : '',
  ].filter((b) => b.length > 0);
  return bits.length > 0 ? bits.join(' ').slice(0, 120) : null;
}

/**
 * Map the listing's grade onto PriceCharting's condition tiers.
 *
 * A raw copy must never be priced off the PSA 10 figure, and vice versa, so an
 * unmatched grade returns nothing rather than falling back to a nearby tier.
 */
function pickGradeTier(
  product: PriceChartingProduct,
  parsed: ParsedListing,
): { cents: number; tier: string } | null {
  const pick = (value: number | undefined, tier: string): { cents: number; tier: string } | null =>
    typeof value === 'number' && value > 0 ? { cents: value, tier } : null;

  if (!parsed.graded) return pick(product['loose-price'], 'ungraded');

  const grade = parsed.grade;
  if (grade === null) return null;
  if (parsed.grader === 'PSA' && grade >= 10) return pick(product['manual-only-price'], 'PSA 10');
  if (parsed.grader === 'BGS' && grade >= 9.5) return pick(product['box-only-price'], 'BGS 9.5');
  if (grade >= 10) return pick(product['graded-price'], 'grade 10');
  if (grade >= 9) return pick(product['new-price'], 'grade 9');
  if (grade >= 7) return pick(product['cib-price'], 'grade 7-8');
  return pick(product['loose-price'], 'ungraded');
}
