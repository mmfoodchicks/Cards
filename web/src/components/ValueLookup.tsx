import { useEffect, useState } from 'react';
import {
  api, money, type CoverageGap, type Item, type ValuationCandidate,
  type ValuationResult, type ValuationSourceInfo,
} from '../lib/api';
import { Banner, Field, MoneyInput, Spinner } from './ui';

/**
 * Look up what a card is worth.
 *
 * The design holds one line throughout: a value is not a cost. The panel says
 * so, the button says so, and the confirmation says so, because the single
 * likeliest way this feature does harm is by leaving someone with the
 * impression that a $750 card belongs in their books at $750. It does not — it
 * belongs there at what they paid.
 *
 * It also refuses to guess. You pick the game and the set, then search within
 * it. The previous version of this app tried to parse card identity out of
 * free-text titles and produced confident nonsense; making the set an explicit
 * choice removes that whole class of failure.
 */
export function ValueLookup({ item, onClose, onSaved }: {
  item: Item;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sources, setSources] = useState<ValuationSourceInfo[]>([]);
  const [gaps, setGaps] = useState<CoverageGap[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string; releasedOn: string | null }>>([]);
  const [category, setCategory] = useState('');
  const [group, setGroup] = useState('');
  const [query, setQuery] = useState(item.description);
  const [result, setResult] = useState<ValuationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  const source = sources[0]?.key ?? 'tcgcsv';
  const isGraded = Boolean(item.gradedBy);

  useEffect(() => {
    api.valuationSources()
      .then((r) => { setSources(r.sources); setGaps(r.gaps); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load sources'));
  }, []);

  useEffect(() => {
    if (!source) return;
    api.valuationCategories(source)
      .then((r) => setCategories(r.categories))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load games'));
  }, [source]);

  useEffect(() => {
    if (!category) { setGroups([]); return; }
    setGroups([]);
    api.valuationGroups(source, category)
      .then((r) => setGroups(r.groups))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load sets'));
  }, [source, category]);

  async function runSearch() {
    setBusy(true); setError(null); setResult(null);
    try {
      setResult(await api.valuationSearch(source, { query, category, group }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  async function applyDollars(dollars: string, provenance: string) {
    setBusy(true); setError(null);
    try {
      const r = await api.setItemValueDollars(item.id, dollars, provenance);
      setSaved(r.note);
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function apply(cents: number, provenance: string) {
    setBusy(true); setError(null);
    try {
      const r = await api.setItemValue(item.id, cents, provenance);
      setSaved(r.note);
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section">
      <h2>What is it worth?</h2>
      <p className="sub">{item.description}</p>

      <Banner>
        <strong>This does not change what the card cost.</strong> Your books carry it at{' '}
        {money(item.basisCents)} — what you paid — and that is the figure that reaches your tax return.
        A value is useful for deciding what to sell, for insurance, and for splitting the cost of a box
        across what came out of it. It is not inventory.
      </Banner>

      {isGraded && (
        <Banner kind="warn">
          <strong>This card is graded ({item.gradedBy} {item.grade}).</strong> The free source below carries
          RAW ungraded prices only, and a slab can be worth many times an ungraded copy. Look this one up
          yourself and enter it by hand.
        </Banner>
      )}

      {saved && <Banner kind="good">{saved}</Banner>}
      {error && <Banner kind="bad">{error}</Banner>}

      {!isGraded && (
        <div className="panel">
          <h3>Look it up</h3>
          <p className="faint" style={{ marginBottom: 10 }}>
            Pick the game and the set first. This deliberately does not guess a card from its name alone —
            that is how price tools return the wrong card with total confidence.
          </p>

          <div className="row">
            <Field label="Game">
              <select value={category} onChange={(e) => { setCategory(e.target.value); setGroup(''); }}>
                <option value="">Choose…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Set">
              <select value={group} onChange={(e) => setGroup(e.target.value)} disabled={!category}>
                <option value="">{category && groups.length === 0 ? 'Loading…' : 'Choose…'}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}{g.releasedOn ? ` (${g.releasedOn.slice(0, 4)})` : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Card name">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Charizard" />
          </Field>

          <button className="btn" disabled={!category || !group || !query || busy} onClick={runSearch}>
            {busy ? 'Searching…' : 'Search this set'}
          </button>

          {busy && <Spinner />}

          {result && result.candidates.length === 0 && (
            <Banner kind="warn" >
              Nothing in that set matched. That is a real answer — better than showing you the wrong card.
              Check the set, or try a different spelling.
            </Banner>
          )}

          {result && result.candidates.map((c) => <Candidate key={c.matchedId} c={c} onApply={apply} busy={busy} />)}

          {result && result.notes.length > 0 && (
            <ul className="faint" style={{ paddingLeft: 16, marginTop: 12 }}>
              {result.notes.map((n) => <li key={n} style={{ marginBottom: 4 }}>{n}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="panel">
        <h3>Or enter it yourself</h3>
        <p className="faint" style={{ marginBottom: 10 }}>
          Look the card up on eBay sold listings while signed in, or on 130point, and type what you found.
          The app records that you entered it and when.
        </p>
        <MoneyInput label="What it is worth" value={manual} onChange={setManual} />
        <button
          className="btn"
          disabled={!manual || busy}
          onClick={() => applyDollars(manual, `entered by hand on ${new Date().toISOString().slice(0, 10)}`)}
        >
          Save this value
        </button>
      </div>

      {gaps.length > 0 && (
        <div className="panel">
          <h3>What this cannot tell you</h3>
          {gaps.map((g) => (
            <div className="list-item" key={g.what}>
              <div className="grow">
                <strong>{g.what}</strong>
                <div className="faint" style={{ marginTop: 3 }}>{g.why}</div>
                <div className="faint" style={{ marginTop: 5 }}>{g.instead}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="btn secondary" onClick={onClose}>Done</button>
    </div>
  );
}

function Candidate({ c, onApply, busy }: {
  c: ValuationCandidate;
  onApply: (cents: number, provenance: string) => void;
  busy: boolean;
}) {
  return (
    <div className="list-item">
      <div className="grow">
        <strong>{c.matchedName}</strong>
        {c.variant && <span className="pill" style={{ marginLeft: 6 }}>{c.variant}</span>}
        {c.number && <span className="faint" style={{ marginLeft: 6 }}>#{c.number}</span>}
        {c.quotes.length === 0 && <div className="faint" style={{ marginTop: 4 }}>No price for this printing.</div>}
        {c.quotes.map((q) => (
          <div key={q.fieldName} style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="amount">{money(q.valueCents)}</span>
            <span className="faint" style={{ fontSize: 12 }}>
              {q.fieldName === 'marketPrice' ? 'market price' : 'lowest listing'}
            </span>
            <button
              className="btn secondary small"
              disabled={busy}
              onClick={() => onApply(
                q.valueCents,
                `${q.sourceName} ${q.fieldName} for ${q.matchedName}${q.variant ? ` (${q.variant})` : ''}, raw ungraded`,
              )}
            >
              Use this
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
