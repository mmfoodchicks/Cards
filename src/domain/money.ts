/**
 * Money arithmetic.
 *
 * Everything is integer cents. Floating point dollars accumulate rounding drift
 * — 0.1 + 0.2 is famously not 0.3 — and in a ledger that drift eventually shows
 * up as a cost of goods sold figure that does not tie to the purchases that
 * produced it. A tax return that does not foot is a tax return that gets looked
 * at.
 */

/** A whole number of cents. Negative values are allowed (refunds, losses). */
export type Cents = number;

/**
 * Parse a dollar amount into whole cents.
 *
 * Deliberately does NOT multiply a float by 100. The literal `1.005` is stored
 * as 1.00499999999999989, so `Math.round(1.005 * 100)` gives 100 — the app
 * would quietly disagree with the receipt the user is copying from. Instead the
 * amount is reduced to a decimal string and the digits are read directly, which
 * is exact for every amount a person can type.
 *
 * Rounds half away from zero, which is what someone doing this by hand does and
 * what avoids biasing refunds against gains.
 */
export function dollarsToCents(dollars: number | string): Cents {
  const text =
    typeof dollars === 'string'
      ? dollars.replace(/[$,\s]/g, '')
      : // Six decimal places is far more than any money amount needs and is
        // within the range where a double's decimal rendering is faithful.
        (Number.isFinite(dollars) ? dollars.toFixed(6) : String(dollars));

  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new TypeError(`Not a dollar amount: ${String(dollars)}`);
  }

  const sign = match[1] === '-' ? -1 : 1;
  const whole = match[2] === '' ? 0n : BigInt(match[2]!);
  const fraction = (match[3] ?? '').padEnd(3, '0');

  let cents = whole * 100n + BigInt(fraction.slice(0, 2));
  // Half away from zero: anything from .005 up rounds the cent away from zero,
  // and the sign is applied afterwards so refunds round the same way as gains.
  if (Number(fraction[2]) >= 5) cents += 1n;

  const value = Number(cents) * sign;
  if (!Number.isSafeInteger(value)) throw new RangeError(`Amount out of range: ${String(dollars)}`);
  return value;
}

export function centsToDollars(cents: Cents): number {
  return cents / 100;
}

export function formatMoney(cents: Cents | null | undefined, options: { sign?: boolean } = {}): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  const negative = cents < 0;
  const body = (Math.abs(cents) / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (negative) return `-${body}`;
  return options.sign ? `+${body}` : body;
}

export function sum(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/**
 * Multiply cents by a rate and round to whole cents.
 * Used for tax rates, fee percentages and mileage.
 */
export function applyRate(cents: Cents, rate: number): Cents {
  const product = cents * rate;
  return product < 0 ? -Math.round(-product) : Math.round(product);
}

/**
 * Split a total across weighted parts so the parts sum EXACTLY to the total.
 *
 * This is the heart of cost basis allocation: a $161.64 booster box opened into
 * 360 cards has to produce 360 basis figures that add back up to $161.64 to the
 * cent. Naive per-item rounding loses or invents money, and the difference lands
 * in cost of goods sold where it does not belong.
 *
 * Uses the largest-remainder method: floor every share, then hand the leftover
 * cents out one at a time to whichever parts were rounded down hardest. Ties go
 * to the earlier index so the result is deterministic.
 *
 * Weights of zero receive zero. If every weight is zero the total is spread
 * evenly instead, because the alternative is silently dropping the money.
 */
export function allocate(total: Cents, weights: readonly number[]): Cents[] {
  if (weights.length === 0) return [];
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new RangeError('Allocation weights must be finite and non-negative');
  }

  const weightTotal = weights.reduce((a, b) => a + b, 0);
  if (weightTotal === 0) return allocate(total, weights.map(() => 1));

  const negative = total < 0;
  const magnitude = Math.abs(total);

  const exact = weights.map((w) => (magnitude * w) / weightTotal);
  const floors = exact.map(Math.floor);
  let remainder = magnitude - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...floors];
  for (let i = 0; i < order.length && remainder > 0; i++) {
    result[order[i]!.index]! += 1;
    remainder -= 1;
  }

  return negative ? result.map((c) => -c) : result;
}

/**
 * Allocate evenly, which is `allocate` with equal weights but reads better at
 * the call site and makes the intent obvious in a diff.
 */
export function allocateEvenly(total: Cents, parts: number): Cents[] {
  return allocate(total, new Array(Math.max(0, Math.floor(parts))).fill(1));
}

/** Percentage of `part` relative to `whole`, guarding division by zero. */
export function percentOf(part: Cents, whole: Cents): number | null {
  if (whole === 0) return null;
  return part / whole;
}

export function formatPercent(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}
