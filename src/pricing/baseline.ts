/**
 * Turns a stream of observed prices into a fair-market baseline for one product.
 *
 * The hard constraint this module is built around: eBay's completed-sale data is
 * behind a restricted API, and scraping it is against their terms. So most of
 * the time all we have is ASKING prices, which are systematically above what
 * items actually sell for. Treating the median ask as "market value" would make
 * every listing look like a fair price and hide the real bargains.
 *
 * The fix is to estimate market value from the LOW end of the ask distribution.
 * Buyers work the cheapest listings first, so the bottom quartile of live asks
 * tracks achievable price far better than the middle does. When true sold comps
 * are available (PriceCharting, or eBay Marketplace Insights if you are granted
 * access) they replace the ask-derived estimate entirely.
 */

import type { Baseline, BenchmarkKind, PriceObservation } from '../types.js';
import {
  clamp,
  median,
  rejectOutliers,
  relativeDispersion,
  timeDecayWeight,
  weightedQuantile,
} from './stats.js';

export interface BaselineOptions {
  /** Quantile of the ask distribution treated as fair market value. */
  askQuantile: number;
  /** Quantile of the sold distribution treated as fair market value. */
  soldQuantile: number;
  /** Minimum sold comps before a sold-derived baseline is trusted. */
  minSold: number;
  /** Minimum inferred sales before that weaker signal is trusted. */
  minSoldInferred: number;
  /** Minimum active asks before an ask-derived baseline is trusted. */
  minAsk: number;
  /** Observations older than this are dropped entirely. */
  windowDays: number;
  /** Age at which an observation's weight halves. */
  halfLifeDays: number;
  /** Modified-z cutoff for outlier rejection. */
  outlierK: number;
}

export const DEFAULT_BASELINE_OPTIONS: BaselineOptions = {
  // The 25th percentile of live asks approximates what the item actually
  // trades for. Raising this makes the app stingier with "deal" labels;
  // lowering it makes it more generous (and more wrong).
  askQuantile: 0.25,
  // Real sales need no such correction, so use the middle of the distribution.
  soldQuantile: 0.5,
  minSold: 3,
  // Inferred sales are noisier than reported ones, so demand more of them.
  minSoldInferred: 5,
  // Asks are a weaker signal, so demand a bigger sample before trusting them.
  minAsk: 6,
  windowDays: 45,
  halfLifeDays: 14,
  outlierK: 3.0,
};

export interface BaselineInput {
  productKey: string;
  observations: readonly PriceObservation[];
  /** Evaluation time; injected so results are reproducible in tests. */
  now?: Date;
  options?: Partial<BaselineOptions>;
}

/**
 * Compute a baseline, or null when the evidence is too thin to price against.
 * Returning null is a feature: a wrong baseline invents bargains that cost the
 * user real money.
 */
export function computeBaseline(input: BaselineInput): Baseline | null {
  const opts = { ...DEFAULT_BASELINE_OPTIONS, ...input.options };
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  const fresh = input.observations.filter((o) => {
    const ageDays = (nowMs - Date.parse(o.observedAt)) / 86_400_000;
    return Number.isFinite(ageDays) && ageDays >= -1 && ageDays <= opts.windowDays && o.unitCents > 0;
  });
  if (fresh.length === 0) return null;

  const sold = fresh.filter((o) => o.kind === 'sold');
  const inferred = fresh.filter((o) => o.kind === 'sold-inferred');
  const asks = fresh.filter((o) => o.kind === 'ask');

  // Evidence ladder: reported sales beat inferred sales beat asking prices.
  let pool: PriceObservation[];
  let minN: number;
  let kind: BenchmarkKind;
  let quantileToUse: number;
  if (sold.length >= opts.minSold) {
    pool = sold;
    minN = opts.minSold;
    kind = 'sold-comp';
    quantileToUse = opts.soldQuantile;
  } else if (inferred.length >= opts.minSoldInferred) {
    pool = inferred;
    minN = opts.minSoldInferred;
    kind = 'sold-inferred';
    // An inferred sale price is the last ASK we saw before the listing went
    // away, so it sits at or just above the true sale price. Shade downward.
    quantileToUse = 0.45;
  } else {
    pool = asks;
    minN = opts.minAsk;
    kind = 'ask-derived';
    quantileToUse = opts.askQuantile;
  }
  if (pool.length < minN) return null;

  const { kept } = rejectOutliers(pool, (o) => o.unitCents, opts.outlierK);
  if (kept.length < minN) return null;

  const weighted = kept.map((o) => ({
    value: o.unitCents,
    weight: timeDecayWeight((nowMs - Date.parse(o.observedAt)) / 86_400_000, opts.halfLifeDays),
  }));

  const valueCents = Math.round(weightedQuantile(weighted, quantileToUse));
  if (!Number.isFinite(valueCents) || valueCents <= 0) return null;

  const values = kept.map((o) => o.unitCents);
  const dispersion = relativeDispersion(values);

  return {
    productKey: input.productKey,
    valueCents,
    kind,
    n: kept.length,
    dispersion: Number.isFinite(dispersion) ? Number(dispersion.toFixed(4)) : 0,
    confidence: baselineConfidence({
      kind,
      n: kept.length,
      dispersion,
      newestAgeDays: Math.min(...kept.map((o) => (nowMs - Date.parse(o.observedAt)) / 86_400_000)),
    }),
    computedAt: now.toISOString(),
  };
}

/** Weight each benchmark kind by how much it deserves to be believed. */
export const BENCHMARK_TRUST: Record<BenchmarkKind, number> = {
  msrp: 1.0,
  'sold-comp': 0.95,
  // A disappearance is good evidence of a sale, but not proof: sellers also
  // pull listings that did not sell.
  'sold-inferred': 0.8,
  // Derived from asking prices, which are a proxy and not a transaction.
  'ask-derived': 0.7,
  none: 0,
};

export interface ConfidenceInput {
  kind: BenchmarkKind;
  n: number;
  dispersion: number;
  newestAgeDays: number;
}

/**
 * Confidence in 0..1, as the product of four independent penalties:
 *
 *   trust        how good this kind of benchmark is at all
 *   sample       n / (n + 5), so 5 observations score 0.5 and 30 score 0.86
 *   agreement    1 / (1 + 2*dispersion): tight prices mean a real market price
 *   freshness    halves every 21 days since the most recent observation
 */
export function baselineConfidence(input: ConfidenceInput): number {
  const trust = BENCHMARK_TRUST[input.kind] ?? 0;
  const sample = input.n / (input.n + 5);
  const disp = Number.isFinite(input.dispersion) ? Math.max(0, input.dispersion) : 1;
  const agreement = 1 / (1 + 2 * disp);
  const freshness = timeDecayWeight(Math.max(0, input.newestAgeDays), 21);
  return Number(clamp(trust * sample * agreement * freshness, 0, 1).toFixed(4));
}

/** Confidence for a benchmark that comes straight from the MSRP catalog. */
export function msrpConfidence(entryConfidence: 'high' | 'medium' | 'low'): number {
  switch (entryConfidence) {
    case 'high':
      return 0.95;
    case 'medium':
      return 0.75;
    case 'low':
      // A "low" MSRP is usually a typical street price we could not source to
      // the manufacturer. Still useful, but the user should see the doubt.
      return 0.5;
  }
}

/** Convenience for callers holding raw cent values rather than observations. */
export function medianCents(values: readonly number[]): number {
  return Math.round(median(values));
}
