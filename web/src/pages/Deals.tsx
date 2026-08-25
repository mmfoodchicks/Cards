import { useEffect, useMemo, useState } from 'react';
import { api, type DealQuery, type Listing } from '../lib/api';
import { DealCard } from '../components/DealCard';

/**
 * Filter presets.
 *
 * "Under MSRP" is first and styled as the headline filter because that is the
 * question the app exists to answer. The rest narrow by how good the deal is,
 * what kind of item it is, and how soon it disappears.
 */
const PRESETS: Array<{ id: string; label: string; hot?: boolean; query: DealQuery }> = [
  { id: 'under-msrp', label: 'Under MSRP', hot: true, query: { underMsrpOnly: true, sort: 'discount' } },
  { id: 'best', label: 'Best deals', query: { labels: ['steal', 'great-deal'], sort: 'score' } },
  { id: 'all-deals', label: 'All deals', query: { labels: ['steal', 'great-deal', 'good-deal'], sort: 'score' } },
  { id: 'sealed', label: 'Sealed', query: { sealedOnly: true, sort: 'score' } },
  { id: 'graded', label: 'Graded slabs', query: { gradedOnly: true, sort: 'score' } },
  { id: 'ending', label: 'Auctions ending', query: { endingWithinHours: 6, sort: 'ending' } },
  { id: 'newest', label: 'Newest', query: { sort: 'newest' } },
];

const CATEGORIES = [
  { id: '', label: 'All' },
  { id: 'pokemon', label: 'Pokémon' },
  { id: 'baseball', label: 'Baseball' },
  { id: 'football', label: 'Football' },
  { id: 'basketball', label: 'Basketball' },
  { id: 'magic', label: 'Magic' },
  { id: 'onepiece', label: 'One Piece' },
  { id: 'yugioh', label: 'Yu-Gi-Oh!' },
];

export function Deals({ search }: { search: string }) {
  const [preset, setPreset] = useState('under-msrp');
  const [category, setCategory] = useState('');
  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo<DealQuery>(() => {
    const base = PRESETS.find((p) => p.id === preset)?.query ?? {};
    return { ...base, category: category || undefined, search: search || undefined, limit: 60 };
  }, [preset, category, search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .deals(query)
      .then((res) => {
        if (cancelled) return;
        setListings(res.listings);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load deals');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <>
      <div className="chips">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={`chip${p.hot ? ' hot' : ''}`}
            aria-pressed={preset === p.id}
            onClick={() => setPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="chips">
        {CATEGORIES.map((c) => (
          <button key={c.id} className="chip" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      {error && <div className="banner error">{error}</div>}

      {loading && listings.length === 0 ? (
        <div className="empty">
          <span className="spinner" />
        </div>
      ) : listings.length === 0 ? (
        <EmptyState preset={preset} />
      ) : (
        <>
          <p className="faint" style={{ marginTop: 12 }}>
            {total} listing{total === 1 ? '' : 's'}
            {total > listings.length ? ` · showing ${listings.length}` : ''}
          </p>
          <div className="grid">
            {listings.map((listing) => (
              <DealCard key={listing.id} listing={listing} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function EmptyState({ preset }: { preset: string }) {
  return (
    <div className="empty">
      <div className="big">🦅</div>
      <p>Nothing here yet.</p>
      <p className="faint" style={{ maxWidth: 380, margin: '8px auto 0' }}>
        {preset === 'under-msrp'
          ? 'Nothing is currently listed below MSRP. That is normal for hot sets — retailers themselves often price above MSRP. Run a watch from the Watches tab, or widen the filter to "All deals".'
          : 'Run a watch from the Watches tab to pull in listings, or use Search to look something up right now.'}
      </p>
    </div>
  );
}
