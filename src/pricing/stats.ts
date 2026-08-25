/**
 * Robust statistics for noisy marketplace prices.
 *
 * Card prices are not normally distributed. The distribution of asking prices
 * for one product has a hard floor (nobody lists at $0) and a very long right
 * tail (hopeful sellers asking 5x market, plus mis-parsed lots). Mean and
 * standard deviation are useless here; everything below is median-based and
 * works in log space where the tail is symmetric.
 */

/** Consistency constant making MAD a drop-in estimator of sigma for normal data. */
export const MAD_SIGMA = 1.4826;

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Linear-interpolated quantile, q in [0,1]. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return Number.NaN;
  if (xs.length === 1) return xs[0]!;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/**
 * Weighted quantile. Weights let recent observations count for more than stale
 * ones without discarding history outright.
 */
export function weightedQuantile(
  points: readonly { value: number; weight: number }[],
  q: number,
): number {
  const usable = points.filter((p) => Number.isFinite(p.value) && p.weight > 0);
  if (usable.length === 0) return Number.NaN;
  if (usable.length === 1) return usable[0]!.value;

  const sorted = [...usable].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, p) => sum + p.weight, 0);
  const target = total * Math.min(1, Math.max(0, q));

  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!;
    const next = cumulative + p.weight;
    if (next >= target) {
      // Interpolate inside the straddling weight bucket.
      const prev = sorted[i - 1];
      if (!prev || p.weight === 0) return p.value;
      const frac = (target - cumulative) / p.weight;
      return prev.value + (p.value - prev.value) * Math.min(1, Math.max(0, frac));
    }
    cumulative = next;
  }
  return sorted[sorted.length - 1]!.value;
}

/** Median absolute deviation, scaled to be comparable with a standard deviation. */
export function mad(xs: readonly number[], center?: number): number {
  if (xs.length === 0) return Number.NaN;
  const c = center ?? median(xs);
  return MAD_SIGMA * median(xs.map((x) => Math.abs(x - c)));
}

/**
 * Reject outliers using a modified z-score in log space.
 *
 * Log space matters: on a $100 card, an ask of $400 and an ask of $25 are both
 * 4x away from market, but in linear space only the $400 looks extreme. Working
 * on log(price) treats over- and under-priced listings even-handedly, which is
 * important because the under-priced tail is exactly what we are hunting and we
 * must not silently discard it.
 *
 * `k` is the modified-z cutoff. 3.5 is the conventional Iglewicz-Hoaglin value;
 * we default slightly tighter because marketplace junk is common.
 */
export function rejectOutliers<T>(
  items: readonly T[],
  valueOf: (item: T) => number,
  k = 3.0,
): { kept: T[]; rejected: T[] } {
  const values = items.map(valueOf).filter((v) => Number.isFinite(v) && v > 0);
  if (values.length < 4) return { kept: [...items], rejected: [] };

  const logs = values.map(Math.log);
  const center = median(logs);
  const spread = mad(logs, center);

  // All observations identical: nothing to reject, and dividing by zero would
  // mark every point an outlier.
  if (!Number.isFinite(spread) || spread === 0) return { kept: [...items], rejected: [] };

  const kept: T[] = [];
  const rejected: T[] = [];
  for (const item of items) {
    const v = valueOf(item);
    if (!Number.isFinite(v) || v <= 0) {
      rejected.push(item);
      continue;
    }
    const z = Math.abs(Math.log(v) - center) / spread;
    (z <= k ? kept : rejected).push(item);
  }
  return { kept, rejected };
}

/** Robust relative dispersion: MAD divided by the median. Scale-free, so it is
 *  comparable across a $3 pack and a $3,000 slab. */
export function relativeDispersion(xs: readonly number[]): number {
  const m = median(xs);
  if (!Number.isFinite(m) || m === 0) return Number.NaN;
  return mad(xs, m) / m;
}

/** Exponential time decay. `halfLifeDays` is when an observation counts half. */
export function timeDecayWeight(ageDays: number, halfLifeDays: number): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  if (halfLifeDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
