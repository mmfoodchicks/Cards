import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, money, parseMoney, today, type Item } from '../lib/api';
import { Banner, Empty, Field, Spinner } from '../components/ui';

/** What is on hand, what it cost, and what can be done with it. */
export function Inventory() {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('on-hand,listed,at-grading');
  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<Item | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.items({ status, search, holdingIntent: intent, limit: 200 });
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load inventory');
    } finally {
      setLoading(false);
    }
  }, [status, search, intent]);

  useEffect(() => {
    const handle = setTimeout(() => void load(), 200);
    return () => clearTimeout(handle);
  }, [load]);

  if (opening) {
    return <OpenPack item={opening} onDone={async () => { setOpening(null); await load(); }} onCancel={() => setOpening(null)} />;
  }

  return (
    <>
      <div className="section">
        <h2>Inventory</h2>
        <p className="sub">{total} item{total === 1 ? '' : 's'} matching.</p>
      </div>

      <div className="panel">
        <Field label="Search"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Card, set, cert number…" /></Field>
        <div className="row">
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="on-hand,listed,at-grading">Available</option>
              <option value="on-hand">On hand</option>
              <option value="at-grading">At the grader</option>
              <option value="sold">Sold</option>
              <option value="opened">Opened packs</option>
              <option value="personal-use">Taken personally</option>
            </select>
          </Field>
          <Field label="Held as">
            <select value={intent} onChange={(e) => setIntent(e.target.value)}>
              <option value="">Everything</option>
              <option value="inventory">Inventory</option>
              <option value="investment">Personal collection</option>
            </select>
          </Field>
        </div>
      </div>

      {error && <Banner kind="bad">{error}</Banner>}

      {loading && items.length === 0 ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty icon="📦" title="Nothing here">
          Record a purchase and the items will show up here with their cost basis worked out.
        </Empty>
      ) : (
        <div className="panel" style={{ marginTop: 12 }}>
          {items.map((item) => (
            <div className="list-item" key={item.id}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>
                  {item.description}
                  {item.holdingIntent === 'investment' && <span className="pill investment" style={{ marginLeft: 8 }}>Collection</span>}
                  {item.status !== 'on-hand' && <span className="pill" style={{ marginLeft: 6 }}>{item.status.replace('-', ' ')}</span>}
                </div>
                <div className="faint" style={{ marginTop: 3 }}>
                  Bought {formatDate(item.acquiredOn)}
                  {item.gradedBy && ` · ${item.gradedBy} ${item.grade ?? ''}`}
                  {item.quantity > 1 && ` · qty ${item.quantity}`}
                  {item.estimatedValueCents ? ` · worth about ${money(item.estimatedValueCents)}` : ''}
                </div>
                {(item.kind === 'sealed-to-open' || item.kind === 'sealed') && item.status === 'on-hand' && (
                  <button className="btn secondary small" style={{ marginTop: 8 }} onClick={() => setOpening(item)}>
                    Open this
                  </button>
                )}
              </div>
              <div className="amount">{money(item.basisCents)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

interface Pull {
  description: string;
  quantity: string;
  estimatedValue: string;
}

/**
 * Opening a pack.
 *
 * The whole cost of the box moves to what came out of it — nothing is created
 * or destroyed. Recording the pulls with rough values is what puts most of the
 * cost onto the card that is actually worth something, which is what keeps the
 * eventual sale from looking like almost pure profit.
 */
function OpenPack({ item, onDone, onCancel }: { item: Item; onDone: () => void; onCancel: () => void }) {
  const [openedOn, setOpenedOn] = useState(today());
  const [pulls, setPulls] = useState<Pull[]>([{ description: '', quantity: '1', estimatedValue: '' }]);
  const [method, setMethod] = useState<'relative-fmv' | 'equal'>('relative-fmv');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weights = pulls.map((p) =>
    method === 'relative-fmv' ? parseMoney(p.estimatedValue) * (Number(p.quantity) || 1) : Number(p.quantity) || 1,
  );
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  const preview = pulls.map((_, i) =>
    weightTotal === 0 ? Math.round(item.basisCents / pulls.length) : Math.round((item.basisCents * weights[i]!) / weightTotal),
  );

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.openItem(item.id, {
        openedOn,
        allocationMethod: method,
        contents: pulls
          .filter((p) => p.description.trim())
          .map((p) => ({
            description: p.description.trim(),
            kind: 'single',
            quantity: Number(p.quantity) || 1,
            estimatedValueCents: p.estimatedValue ? parseMoney(p.estimatedValue) : null,
          })),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="section">
        <h2>Open: {item.description}</h2>
        <p className="sub">
          Its {money(item.basisCents)} of cost moves to whatever came out of it. Add a line for the hits and one
          catch-all line for the bulk — the bulk still needs to be there, or the cost has nowhere to go.
        </p>
      </div>

      <div className="panel">
        <Field label="Opened on"><input type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} /></Field>
        <Field
          label="Split the cost"
          hint="By value puts the cost on the card that carries the value, which is the general rule. Value is per card and is multiplied by the quantity."
        >
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="relative-fmv">By each card's value (recommended)</option>
            <option value="equal">Evenly</option>
          </select>
        </Field>
      </div>

      <div className="panel">
        <h3>What came out</h3>
        {pulls.map((pull, index) => (
          <div key={index} style={{ borderTop: index ? '1px solid var(--border)' : 0, paddingTop: index ? 12 : 0, marginTop: index ? 12 : 0 }}>
            <Field label={`Card ${index + 1}`}>
              <input
                value={pull.description}
                onChange={(e) => setPulls((p) => p.map((x, i) => (i === index ? { ...x, description: e.target.value } : x)))}
                placeholder={index === 0 ? 'e.g. Charizard ex SIR 199/165' : 'e.g. bulk commons and uncommons'}
              />
            </Field>
            <div className="row">
              <Field label="How many">
                <input inputMode="numeric" value={pull.quantity}
                  onChange={(e) => setPulls((p) => p.map((x, i) => (i === index ? { ...x, quantity: e.target.value } : x)))} />
              </Field>
              <Field label="Worth each">
                <input inputMode="decimal" value={pull.estimatedValue} placeholder="0.00"
                  onChange={(e) => setPulls((p) => p.map((x, i) => (i === index ? { ...x, estimatedValue: e.target.value } : x)))} />
              </Field>
            </div>
            <div className="faint">Cost basis: <strong style={{ color: 'var(--text)' }}>{money(preview[index] ?? 0)}</strong></div>
            {pulls.length > 1 && (
              <button type="button" className="btn danger small" style={{ marginTop: 8 }}
                onClick={() => setPulls((p) => p.filter((_, i) => i !== index))}>Remove</button>
            )}
          </div>
        ))}
        <button type="button" className="btn secondary small" style={{ marginTop: 12 }}
          onClick={() => setPulls((p) => [...p, { description: '', quantity: '1', estimatedValue: '' }])}>
          + Add another
        </button>
      </div>

      {weightTotal === 0 && (
        <Banner kind="warn">
          No values entered yet, so the cost will be split evenly. That is usually wrong for a pack — one card is
          normally most of the value. Rough numbers are fine, and you can correct them later.
        </Banner>
      )}

      {error && <Banner kind="bad">{error}</Banner>}

      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn" type="submit" disabled={saving || !pulls.some((p) => p.description.trim())}>
          {saving ? 'Saving…' : 'Record the opening'}
        </button>
        <button className="btn secondary" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
