import { useState } from 'react';
import { api, type Listing } from '../lib/api';
import { DealCard } from '../components/DealCard';

/**
 * One-off lookup.
 *
 * Results are scored but deliberately not saved: browsing around should not
 * quietly reshape the price history that saved watches build up over time.
 */
export function Search() {
  const [q, setQ] = useState('');
  const [sealedOnly, setSealedOnly] = useState(false);
  const [gradedOnly, setGradedOnly] = useState(false);
  const [includeAuctions, setIncludeAuctions] = useState(true);
  const [maxPrice, setMaxPrice] = useState('');
  const [listings, setListings] = useState<Listing[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setErrors([]);
    try {
      const res = await api.search({
        q: q.trim(),
        sealedOnly,
        gradedOnly,
        includeAuctions,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        limit: 100,
      });
      setListings(res.listings);
      setWarnings(res.warnings);
      setErrors(res.errors);
      setRan(true);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Search failed']);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form className="panel section" onSubmit={run}>
        <div className="field">
          <label htmlFor="search-q">What are you looking for?</label>
          <input
            id="search-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="prismatic evolutions elite trainer box"
            maxLength={100}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="search-max">Max price ($)</label>
            <input
              id="search-max"
              type="number"
              inputMode="decimal"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="any"
            />
          </div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={sealedOnly} onChange={(e) => setSealedOnly(e.target.checked)} />
          Sealed product only
        </label>
        <label className="switch">
          <input type="checkbox" checked={gradedOnly} onChange={(e) => setGradedOnly(e.target.checked)} />
          Graded slabs only
        </label>
        <label className="switch">
          <input type="checkbox" checked={includeAuctions} onChange={(e) => setIncludeAuctions(e.target.checked)} />
          Include auctions
        </label>
        <button className="btn" type="submit" disabled={loading || !q.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {warnings.map((w) => (
        <div className="banner info" key={w}>
          {w}
        </div>
      ))}
      {errors.map((e) => (
        <div className="banner error" key={e}>
          {e}
        </div>
      ))}

      {ran && listings.length === 0 && !loading && (
        <div className="empty">
          <div className="big">🔍</div>
          <p>No listings matched.</p>
        </div>
      )}

      <div className="grid">
        {listings.map((listing) => (
          <DealCard key={listing.id} listing={listing} />
        ))}
      </div>
    </>
  );
}
