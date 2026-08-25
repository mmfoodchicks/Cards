import { useEffect, useState } from 'react';
import { api, type CatalogEntry } from '../lib/api';

/**
 * The MSRP catalog, editable in place.
 *
 * Card MSRPs are messy: Pokémon publishes none directly, Panini and Topps put
 * an SRP on hobby-shop sell sheets that consumers never see, and most retail
 * SKUs have no published figure at all. Every row therefore carries a
 * confidence rating, and anything the user knows better than we do can be
 * corrected here — corrections are stored separately so a catalog update never
 * overwrites them.
 */
export function Catalog() {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .catalog(search || undefined)
        .then((res) => {
          if (!cancelled) setEntries(res.entries);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search]);

  async function save(entry: CatalogEntry, dollars: string) {
    const value = Number(dollars);
    if (!Number.isFinite(value) || value <= 0) return;
    setSavingId(entry.id);
    try {
      await api.saveCatalogEntry(entry.id, {
        msrpCents: Math.round(value * 100),
        // A figure the user typed in themselves is the most trustworthy one
        // available, so it is recorded as high confidence.
        confidence: 'high',
        note: 'Edited by you',
        deleted: false,
      });
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, msrpCents: Math.round(value * 100), confidence: 'high', edited: true } : e)),
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <div className="section">
        <h2>MSRP catalog</h2>
        <p className="muted" style={{ marginTop: -4 }}>
          What each sealed product is supposed to cost. Correct anything that looks wrong — your edits are kept
          separately and survive catalog updates.
        </p>
      </div>

      <div className="field">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by set, product or year…" />
      </div>

      <div className="banner info">
        <strong>How to read confidence.</strong> <em>High</em> is a published manufacturer or distributor price.{' '}
        <em>Medium</em> is a sell-sheet SRP that hobby shops see, not consumers. <em>Low</em> is a typical shelf price
        where no MSRP was ever published — treat it as a guide, not a rule.
      </div>

      {loading ? (
        <div className="empty">
          <span className="spinner" />
        </div>
      ) : (
        <div className="panel table-wrap" style={{ marginTop: 12 }}>
          <table className="catalog">
            <thead>
              <tr>
                <th>Product</th>
                <th>MSRP</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>
                      {entry.year} {entry.setName}
                    </div>
                    <div className="faint">
                      {entry.productType.replace(/-/g, ' ')}
                      {entry.variant ? ` · ${entry.variant.replace(/-/g, ' ')}` : ''} · {entry.category}
                    </div>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={(entry.msrpCents / 100).toFixed(2)}
                      disabled={savingId === entry.id}
                      onBlur={(e) => {
                        if (e.target.value !== (entry.msrpCents / 100).toFixed(2)) void save(entry, e.target.value);
                      }}
                      aria-label={`MSRP for ${entry.setName} ${entry.productType}`}
                    />
                  </td>
                  <td>
                    <span className={`conf-pill ${entry.confidence}`}>{entry.confidence}</span>
                    {entry.edited && (
                      <div className="faint" style={{ marginTop: 4 }}>
                        edited
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <p className="faint">Nothing matches that filter.</p>}
        </div>
      )}
    </>
  );
}
