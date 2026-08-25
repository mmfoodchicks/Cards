/**
 * Turns a parsed listing plus a benchmark into a deal label.
 *
 * Two benchmark families, two ladders:
 *
 *  - MSRP.  Only sealed product has one. Sealed product routinely sells AT or
 *    ABOVE MSRP for hot sets, so being under MSRP at all is meaningful and the
 *    thresholds are tight.
 *  - Market value.  Derived from comps or from the low end of live asks. Spreads
 *    are much wider here, so the thresholds are correspondingly looser.
 *
 * Both ladders top out in a `suspicious` band. A sealed booster box at 80% off
 * is not a deal you found before anyone else; it is an empty box, a pre-order
 * scam, a mis-parse, or a listing for the wrapper.
 */

import type { BenchmarkKind, DealLabel, ListingType, ParsedListing } from '../types.js';
import { clamp } from './stats.js';

export interface LabelThresholds {
  /** At or beyond this discount the listing is more likely fraud than a find. */
  suspicious: number;
  steal: number;
  greatDeal: number;
  goodDeal: number;
  /** Down to this (negative = above benchmark) still counts as a fair price. */
  fair: number;
}

/** Sealed product benchmarked against a real manufacturer price. */
export const MSRP_THRESHOLDS: LabelThresholds = {
  suspicious: 0.6,
  steal: 0.25,
  greatDeal: 0.12,
  goodDeal: 0.04,
  fair: -0.05,
};

/** Anything benchmarked against comps or observed asks. */
export const MARKET_THRESHOLDS: LabelThresholds = {
  suspicious: 0.7,
  steal: 0.35,
  greatDeal: 0.2,
  goodDeal: 0.1,
  fair: -0.1,
};

/**
 * Title phrases meaning the item is worthless or is not the product it appears
 * to be. These force `suspicious` no matter how good the arithmetic looks —
 * an empty Elite Trainer Box really is listed at 90% under MSRP.
 */
export const DISQUALIFYING_FLAGS = new Set([
  'empty box', 'empty pack', 'box only', 'wrapper only', 'no cards',
  'proxy', 'custom card', 'custom made', 'reprint', 'rp', 'fake', 'replica',
  'digital card', 'digital code', 'code card', 'online code', 'ptcgl', 'ptcgo',
  'art card', 'aceo', 'fan art', 'not authentic', 'unofficial',
  'photo only', 'picture only', 'display only', 'case only', 'sticker only',
  'toploader only',
]);

/** Phrases that do not disqualify a listing but should shrink confidence. */
export const CAUTION_FLAGS = new Set([
  'repack', 're-pack', 'mystery box', 'mystery pack', 'grab bag', 'blind bag',
  'hot pack', 'searched', 'weighed', 'random card', 'random pack', 'break spot',
  'razz', 'raffle', 'group break', 'pick your', 'you pick', 'choose your card',
  'random hit', 'resealed', 'damaged box', 'read description', 'novelty',
]);

/** An auction further out than this has a price nobody has competed for yet. */
export const AUCTION_INFORMATIVE_HOURS = 6;
/** ...unless it already has this many bids, which means the market is engaged. */
export const AUCTION_INFORMATIVE_BIDS = 5;

/** Below this parse confidence we do not trust the product identity at all. */
export const MIN_PARSE_CONFIDENCE = 0.4;
/** Below this benchmark confidence we refuse to shout about a find. */
export const LOW_CONFIDENCE_CAP = 0.3;

export interface ScoreInput {
  parsed: ParsedListing;
  /** Landed cost of one unit, in cents. */
  unitCents: number;
  benchmark: { kind: BenchmarkKind; valueCents: number; confidence: number } | null;
  listingType: ListingType;
  bidCount: number | null;
  /** ISO timestamp when an auction closes. */
  endsAt: string | null;
  shippingKnown: boolean;
  /** Seller feedback percentage, 0-100. */
  sellerFeedbackPct?: number | null;
  sellerFeedbackCount?: number | null;
  now?: Date;
}

export interface ScoreResult {
  label: DealLabel;
  /** Positive means under the benchmark. 0.25 = 25% under. */
  discountPct: number | null;
  confidence: number;
  /** Ranking value. Higher is a better opportunity. */
  score: number;
  underMsrp: boolean;
  notes: string[];
}

export function scoreListing(input: ScoreInput): ScoreResult {
  const notes: string[] = [];
  const { parsed } = input;
  const now = input.now ?? new Date();

  const disqualifying = parsed.redFlags.filter((f) => DISQUALIFYING_FLAGS.has(f));
  const cautions = parsed.redFlags.filter((f) => CAUTION_FLAGS.has(f));

  if (disqualifying.length > 0) {
    return {
      label: 'suspicious',
      discountPct: null,
      confidence: 0,
      score: 0,
      underMsrp: false,
      notes: [`Listing text suggests this is not the product itself: ${disqualifying.join(', ')}.`],
    };
  }

  if (parsed.parseConfidence < MIN_PARSE_CONFIDENCE) {
    return unscored(`Could not identify the product with enough confidence (${parsed.parseConfidence.toFixed(2)}).`);
  }
  if (parsed.mixedLot) {
    return unscored('Multi-item lot with no stated count, so there is no per-unit price to compare.');
  }
  if (!input.benchmark || input.benchmark.kind === 'none' || input.benchmark.valueCents <= 0) {
    return unscored('No MSRP or market comps available for this product yet.');
  }

  // An auction that has not been bid up yet is priced by nobody.
  const auction = input.listingType === 'auction' || input.listingType === 'auction-with-bin';
  if (auction) {
    const hoursLeft = input.endsAt ? (Date.parse(input.endsAt) - now.getTime()) / 3_600_000 : Number.POSITIVE_INFINITY;
    const bids = input.bidCount ?? 0;
    if (hoursLeft > AUCTION_INFORMATIVE_HOURS && bids < AUCTION_INFORMATIVE_BIDS) {
      return unscored(
        Number.isFinite(hoursLeft)
          ? `Auction with ${formatHours(hoursLeft)} left and ${bids} bid${bids === 1 ? '' : 's'}: the price will move before it closes.`
          : 'Auction with no end time reported, so the current bid is not a price.',
      );
    }
    notes.push(
      Number.isFinite(hoursLeft)
        ? `Auction closing in ${formatHours(hoursLeft)} with ${bids} bid${bids === 1 ? '' : 's'}.`
        : `Auction with ${bids} bids.`,
    );
  }

  const benchmark = input.benchmark;
  const discountPct = (benchmark.valueCents - input.unitCents) / benchmark.valueCents;
  const thresholds = benchmark.kind === 'msrp' ? MSRP_THRESHOLDS : MARKET_THRESHOLDS;

  let confidence = benchmark.confidence * parsed.parseConfidence;
  if (!input.shippingKnown) {
    // The landed-cost step already explains this to the user; here it only
    // costs confidence.
    confidence *= 0.9;
  }
  if (cautions.length > 0) {
    confidence *= 0.6;
    notes.push(`Repack or gambling-style listing (${cautions.join(', ')}); the contents are not the product.`);
  }
  if (typeof input.sellerFeedbackPct === 'number' && input.sellerFeedbackPct < 95) {
    confidence *= 0.85;
    notes.push(`Seller feedback is ${input.sellerFeedbackPct.toFixed(1)}%.`);
  }
  if (typeof input.sellerFeedbackCount === 'number' && input.sellerFeedbackCount < 10) {
    confidence *= 0.85;
    notes.push(`Seller has only ${input.sellerFeedbackCount} feedback ratings.`);
  }
  confidence = clamp(confidence, 0, 1);

  let label = labelFor(discountPct, thresholds);

  if (label === 'suspicious') {
    notes.push(
      `Priced ${(discountPct * 100).toFixed(0)}% below ${benchmark.kind === 'msrp' ? 'MSRP' : 'market'}. ` +
        'Discounts this deep are usually an empty box, a pre-order, a counterfeit, or a mis-read title.',
    );
  } else if (confidence < LOW_CONFIDENCE_CAP && (label === 'steal' || label === 'great-deal')) {
    // Do not shout when we are not sure. Demote rather than hide, and say why.
    label = 'good-deal';
    notes.push('Confidence is low, so this is flagged conservatively. Check the comps yourself.');
  }

  if (benchmark.kind === 'ask-derived') {
    notes.push('Market value estimated from current asking prices, not completed sales.');
  }

  const underMsrp = benchmark.kind === 'msrp' && discountPct > 0 && label !== 'suspicious';

  return {
    label,
    discountPct: Number(discountPct.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    score: rankingScore(discountPct, confidence, benchmark.valueCents - input.unitCents, parsed.quantity, label),
    underMsrp,
    notes,
  };

  function unscored(reason: string): ScoreResult {
    return { label: 'unscored', discountPct: null, confidence: 0, score: 0, underMsrp: false, notes: [reason, ...notes] };
  }
}

export function labelFor(discountPct: number, t: LabelThresholds): DealLabel {
  if (discountPct >= t.suspicious) return 'suspicious';
  if (discountPct >= t.steal) return 'steal';
  if (discountPct >= t.greatDeal) return 'great-deal';
  if (discountPct >= t.goodDeal) return 'good-deal';
  if (discountPct >= t.fair) return 'fair';
  return 'above-market';
}

/**
 * Ranking score.
 *
 * Percentage alone puts a $1.20 saving on a $4 pack above a $90 saving on a
 * $600 case, so the absolute saving is folded in logarithmically: it breaks
 * ties in favour of real money without letting expensive items monopolise the
 * feed.
 */
export function rankingScore(
  discountPct: number,
  confidence: number,
  perUnitSavingCents: number,
  quantity: number,
  label: DealLabel,
): number {
  if (label === 'suspicious' || label === 'unscored') return 0;
  if (discountPct <= 0 || perUnitSavingCents <= 0) return 0;
  const totalSavingDollars = (perUnitSavingCents * Math.max(1, quantity)) / 100;
  return Number((discountPct * confidence * Math.log10(1 + totalSavingDollars)).toFixed(6));
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Display metadata for each label, shared by the API and the UI. */
export const LABEL_META: Record<DealLabel, { title: string; blurb: string; tone: 'hot' | 'good' | 'neutral' | 'warn' }> = {
  steal: { title: 'Steal', blurb: 'Far below what this normally goes for.', tone: 'hot' },
  'great-deal': { title: 'Great deal', blurb: 'Clearly below market.', tone: 'hot' },
  'good-deal': { title: 'Good deal', blurb: 'A little below market.', tone: 'good' },
  fair: { title: 'Fair price', blurb: 'About what it is worth.', tone: 'neutral' },
  'above-market': { title: 'Overpriced', blurb: 'Above what it is worth.', tone: 'neutral' },
  suspicious: { title: 'Too good to be true', blurb: 'Discount this deep usually means something is wrong.', tone: 'warn' },
  unscored: { title: 'Not scored', blurb: 'Not enough information to judge this one.', tone: 'neutral' },
};
