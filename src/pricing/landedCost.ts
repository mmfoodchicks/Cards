/**
 * Landed cost normalisation.
 *
 * A $40 booster box with $18 shipping is not cheaper than a $52 box shipped
 * free, and a "lot of 6" at $180 is not more expensive than a single at $34.
 * Everything downstream compares LANDED PER-UNIT cost so those cases sort
 * correctly.
 */

export interface LandedCostInput {
  priceCents: number;
  /** null means the source did not disclose shipping (calculated, freight, pickup). */
  shippingCents: number | null;
  /** Comparable units in the listing. */
  quantity: number;
  /** Estimated sales tax as a fraction, e.g. 0.07. Applied to price + shipping. */
  taxRate: number;
  /** Stand-in shipping used when the source discloses none. */
  assumedShippingCents: number;
}

export interface LandedCost {
  landedCents: number;
  unitCents: number;
  shippingKnown: boolean;
  notes: string[];
}

export function computeLandedCost(input: LandedCostInput): LandedCost {
  const notes: string[] = [];
  const quantity = Number.isFinite(input.quantity) && input.quantity > 0 ? Math.floor(input.quantity) : 1;

  const shippingKnown = input.shippingCents !== null && Number.isFinite(input.shippingCents);
  const shipping = shippingKnown ? Math.max(0, input.shippingCents!) : Math.max(0, input.assumedShippingCents);
  if (!shippingKnown) {
    notes.push(
      input.assumedShippingCents > 0
        ? `Shipping not disclosed; assumed ${formatCents(input.assumedShippingCents)}.`
        : 'Shipping not disclosed; landed cost is a floor, not the final price.',
    );
  }

  const taxRate = Number.isFinite(input.taxRate) && input.taxRate > 0 ? input.taxRate : 0;
  const preTax = Math.max(0, input.priceCents) + shipping;
  const landedCents = Math.round(preTax * (1 + taxRate));

  return {
    landedCents,
    unitCents: Math.round(landedCents / quantity),
    shippingKnown,
    notes,
  };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
