/** Shapes database rows into the JSON the web UI consumes. */

import type { ListingRow } from '../db/repos.js';
import { LABEL_META } from '../pricing/score.js';
import type { DealLabel, ParsedListing, ScoredListing } from '../types.js';

export interface ListingDto {
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
  label: DealLabel;
  labelTitle: string;
  labelTone: string;
  underMsrp: boolean;
  confidence: number;
  score: number;
  notes: string[];
  redFlags: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  goneAt: string | null;
}

export function toListingDto(row: ListingRow): ListingDto {
  const parsed = JSON.parse(row.parse_json) as ParsedListing;
  const label = row.label as DealLabel;
  const meta = LABEL_META[label] ?? LABEL_META.unscored;

  return {
    id: row.id,
    source: row.source,
    title: row.title,
    url: row.url,
    imageUrl: row.image_url,
    priceCents: row.price_cents,
    shippingCents: row.shipping_cents,
    shippingUnknown: row.shipping_cents === null,
    landedCents: row.landed_cents,
    unitCents: row.unit_cents,
    quantity: row.quantity,
    listingType: row.listing_type,
    bidCount: row.bid_count,
    endsAt: row.ends_at,
    sellerName: row.seller_name,
    sellerFeedbackPct: row.seller_feedback_pct,
    sellerFeedbackCount: row.seller_feedback_count,
    category: row.category,
    productType: row.product_type,
    setName: row.set_name,
    year: row.year,
    sealed: row.sealed === 1,
    graded: row.graded === 1,
    grader: row.grader,
    grade: row.grade,
    benchmarkKind: row.benchmark_kind,
    benchmarkCents: row.benchmark_cents,
    benchmarkLabel: row.benchmark_label,
    benchmarkSource: row.benchmark_source,
    discountPct: row.discount_pct,
    savingsCents:
      row.benchmark_cents !== null ? Math.round((row.benchmark_cents - row.unit_cents) * row.quantity) : null,
    label,
    labelTitle: meta.title,
    labelTone: meta.tone,
    underMsrp: row.under_msrp === 1,
    confidence: row.confidence,
    score: row.score,
    notes: JSON.parse(row.notes_json) as string[],
    redFlags: parsed.redFlags,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    goneAt: row.gone_at,
  };
}

/**
 * Serialise a listing that was scored but never stored.
 *
 * Ad-hoc searches deliberately do not write to the database — an exploratory
 * query should not pollute the price history that saved watches accumulate —
 * so they need a path to the same DTO shape that does not go through a row.
 */
export function scoredToDto(listing: ScoredListing): ListingDto {
  const meta = LABEL_META[listing.label] ?? LABEL_META.unscored;
  return {
    id: listing.id,
    source: listing.source,
    title: listing.title,
    url: listing.url,
    imageUrl: listing.imageUrl,
    priceCents: listing.priceCents,
    shippingCents: listing.shippingCents,
    shippingUnknown: listing.shippingUnknown,
    landedCents: listing.landedCents,
    unitCents: listing.unitCents,
    quantity: listing.parsed.quantity,
    listingType: listing.listingType,
    bidCount: listing.bidCount,
    endsAt: listing.endsAt,
    sellerName: listing.sellerName,
    sellerFeedbackPct: listing.sellerFeedbackPct,
    sellerFeedbackCount: listing.sellerFeedbackCount,
    category: listing.parsed.category,
    productType: listing.parsed.productType,
    setName: listing.parsed.setName,
    year: listing.parsed.year,
    sealed: listing.parsed.sealed,
    graded: listing.parsed.graded,
    grader: listing.parsed.grader,
    grade: listing.parsed.grade,
    benchmarkKind: listing.benchmarkKind,
    benchmarkCents: listing.benchmarkCents,
    benchmarkLabel: listing.benchmarkLabel,
    benchmarkSource: listing.benchmarkSource,
    discountPct: listing.discountPct,
    savingsCents:
      listing.benchmarkCents !== null
        ? Math.round((listing.benchmarkCents - listing.unitCents) * listing.parsed.quantity)
        : null,
    label: listing.label,
    labelTitle: meta.title,
    labelTone: meta.tone,
    underMsrp: listing.underMsrp,
    confidence: listing.confidence,
    score: listing.score,
    notes: listing.notes,
    redFlags: listing.parsed.redFlags,
    firstSeenAt: listing.firstSeenAt,
    lastSeenAt: listing.lastSeenAt,
    goneAt: null,
  };
}
