import { useEffect, useState } from 'react';
import { api, type Watch } from '../lib/api';

/** Saved searches the scheduler re-runs on an interval. */
export function Watches() {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    try {
      const res = await api.watches();
      setWatches(res.watches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load watches');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function runNow(watch: Watch) {
    setBusy(watch.id);
    setMessage(null);
    setError(null);
    try {
      const res = await api.runWatch(watch.id);
      const parts = [`${res.seen} listings`, `${res.newListings} new`, `${res.deals} deals`];
      if (res.callsUsed > 0) parts.push(`${res.callsUsed} API calls`);
      setMessage(`${watch.name}: ${parts.join(', ')}.`);
      if (res.errors.length > 0) setError(res.errors.join(' '));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(watch: Watch) {
    await api.updateWatch(watch.id, { enabled: !watch.enabled });
    await refresh();
  }

  async function remove(watch: Watch) {
    await api.deleteWatch(watch.id);
    await refresh();
  }

  if (loading) {
    return (
      <div className="empty">
        <span className="spinner" />
      </div>
    );
  }

  return (
    <>
      {message && <div className="banner info">{message}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="section">
        <h2>Watches</h2>
        <p className="muted" style={{ marginTop: -4 }}>
          Each watch re-runs on its own interval and adds what it finds to the deals feed.
        </p>
      </div>

      {watches.map((watch) => (
        <div className="panel" key={watch.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <strong>{watch.name}</strong>
              <div className="faint" style={{ marginTop: 3, wordBreak: 'break-word' }}>
                “{watch.query}”
              </div>
            </div>
            <span className={`badge ${watch.enabled ? 'good' : 'neutral'}`}>{watch.enabled ? 'On' : 'Paused'}</span>
          </div>

          <div className="meta" style={{ marginTop: 10 }}>
            <span>every {watch.intervalMinutes}m</span>
            <span>{watch.sealedOnly ? 'sealed only' : watch.gradedOnly ? 'graded only' : 'anything'}</span>
            <span>≥{Math.round(watch.minDiscountPct * 100)}% off</span>
            <span>{watch.sources.join(', ')}</span>
            <span className="faint">
              {watch.lastRunAt ? `last run ${new Date(watch.lastRunAt).toLocaleString()}` : 'never run'}
            </span>
          </div>

          {watch.lastError && <div className="banner warn">{watch.lastError}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => void runNow(watch)} disabled={busy === watch.id}>
              {busy === watch.id ? 'Scanning…' : 'Run now'}
            </button>
            <button className="btn secondary" onClick={() => void toggle(watch)}>
              {watch.enabled ? 'Pause' : 'Resume'}
            </button>
            <button className="btn danger" onClick={() => void remove(watch)}>
              Delete
            </button>
          </div>
        </div>
      ))}

      {creating ? (
        <NewWatchForm
          onDone={async () => {
            setCreating(false);
            await refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button className="btn secondary" style={{ marginTop: 12 }} onClick={() => setCreating(true)}>
          + New watch
        </button>
      )}
    </>
  );
}

function NewWatchForm({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sealedOnly, setSealedOnly] = useState(true);
  const [minDiscount, setMinDiscount] = useState('10');
  const [interval, setInterval] = useState('30');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createWatch({
        name: name.trim() || query.trim(),
        query: query.trim(),
        category: category || null,
        sealedOnly,
        minDiscountPct: Math.max(0, Math.min(100, Number(minDiscount) || 0)) / 100,
        intervalMinutes: Math.max(5, Number(interval) || 30),
      });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit} style={{ marginTop: 12 }}>
      <h2 style={{ marginTop: 0, fontSize: 15 }}>New watch</h2>
      <div className="field">
        <label htmlFor="w-query">Search terms</label>
        <input
          id="w-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="pokemon prismatic evolutions etb"
          maxLength={100}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="w-name">Name (optional)</label>
        <input id="w-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Prismatic ETBs" />
      </div>
      <div className="field">
        <label htmlFor="w-cat">Category</label>
        <select id="w-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Any</option>
          <option value="pokemon">Pokémon</option>
          <option value="baseball">Baseball</option>
          <option value="football">Football</option>
          <option value="basketball">Basketball</option>
          <option value="magic">Magic</option>
          <option value="onepiece">One Piece</option>
          <option value="yugioh">Yu-Gi-Oh!</option>
        </select>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="w-disc">Alert at % off</label>
          <input id="w-disc" type="number" inputMode="numeric" value={minDiscount} onChange={(e) => setMinDiscount(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="w-int">Check every (min)</label>
          <input id="w-int" type="number" inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value)} />
        </div>
      </div>
      <label className="switch">
        <input type="checkbox" checked={sealedOnly} onChange={(e) => setSealedOnly(e.target.checked)} />
        Sealed product only (the only things with a real MSRP)
      </label>
      {error && <div className="banner error">{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="btn" type="submit" disabled={saving || !query.trim()}>
          {saving ? 'Saving…' : 'Create watch'}
        </button>
        <button className="btn secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
