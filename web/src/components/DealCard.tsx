import { money, percent, timeUntil, type Listing } from '../lib/api';

/**
 * One listing.
 *
 * The card leads with the two things that decide whether to click: what it
 * costs landed, and how that compares to the benchmark. Everything that could
 * make the comparison wrong — unknown shipping, a thin benchmark, a seller with
 * three ratings — is stated on the card rather than buried, because a deal
 * finder that hides its caveats is just a way to lose money faster.
 */
export function DealCard({ listing }: { listing: Listing }) {
  const ending = timeUntil(listing.endsAt);
  const isAuction = listing.listingType.startsWith('auction');
  const discount = listing.discountPct;

  return (
    <article className="card">
      <div className="card-head">
        <span className={`badge ${listing.labelTone}`}>{listing.labelTitle}</span>
        {listing.underMsrp && <span className="badge msrp">Under MSRP</span>}
        {isAuction && ending && (
          <span className="badge neutral">
            {ending === 'ended' ? 'Ended' : `Ends in ${ending}`}
            {listing.bidCount != null ? ` · ${listing.bidCount} bid${listing.bidCount === 1 ? '' : 's'}` : ''}
          </span>
        )}
        {listing.quantity > 1 && <span className="badge neutral">{listing.quantity}× lot</span>}
      </div>

      <h3 className="card-title">
        <a href={listing.url} target="_blank" rel="noreferrer noopener">
          {listing.title}
        </a>
      </h3>

      <div className="price-row">
        <span className="price">{money(listing.unitCents)}</span>
        {listing.quantity > 1 && <span className="price-vs">each</span>}
        {listing.benchmarkCents != null && (
          <span className="price-vs">
            vs <s>{money(listing.benchmarkCents)}</s> {listing.benchmarkKind === 'msrp' ? 'MSRP' : 'market'}
          </span>
        )}
        {discount != null && discount !== 0 && (
          <span className={`discount${discount < 0 ? ' negative' : ''}`}>
            {discount > 0 ? `${percent(discount)} off` : `${percent(-discount)} over`}
          </span>
        )}
      </div>

      <div className="meta">
        <span>
          {money(listing.priceCents)}
          {listing.shippingUnknown
            ? ' + shipping unknown'
            : listing.shippingCents === 0
              ? ' + free ship'
              : ` + ${money(listing.shippingCents)} ship`}
        </span>
        {listing.setName && (
          <span>
            <b>{listing.year ?? ''} {listing.setName}</b>
          </span>
        )}
        {listing.graded && listing.grader && (
          <span>
            <b>
              {listing.grader}
              {listing.grade != null ? ` ${listing.grade}` : ''}
            </b>
          </span>
        )}
        {listing.sellerName && (
          <span>
            {listing.sellerName}
            {listing.sellerFeedbackPct != null ? ` (${listing.sellerFeedbackPct}%)` : ''}
          </span>
        )}
        <span className="faint">{listing.source}</span>
      </div>

      {listing.benchmarkLabel && (
        <div className="confidence">
          <span>{listing.benchmarkLabel}</span>
          <span className="confidence-bar">
            <i style={{ width: `${Math.round(listing.confidence * 100)}%` }} />
          </span>
          <span>{Math.round(listing.confidence * 100)}% confident</span>
        </div>
      )}

      {listing.notes.length > 0 && (
        <ul className="notes">
          {listing.notes.slice(0, 3).map((note) => (
            <li key={note} className={isWarning(note) ? 'warn' : undefined}>
              {note}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** Notes that describe a risk get visual weight; explanatory ones do not. */
function isWarning(note: string): boolean {
  return /scam|counterfeit|empty|not the product|too good|repack|gambling|feedback|cheapest variation/i.test(note);
}
