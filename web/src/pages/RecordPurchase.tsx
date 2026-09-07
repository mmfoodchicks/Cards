import { useState } from 'react';
import { api, money, parseMoney, today } from '../lib/api';
import { Banner, Field, MoneyInput } from '../components/ui';

interface DraftItem {
  description: string;
  kind: string;
  holdingIntent: 'inventory' | 'investment';
  quantity: string;
  estimatedValue: string;
}

const emptyItem = (): DraftItem => ({
  description: '',
  kind: 'single',
  holdingIntent: 'inventory',
  quantity: '1',
  estimatedValue: '',
});

/**
 * Recording a purchase.
 *
 * Built to be usable one-handed at a show. The thing that makes it more than a
 * form is the allocation preview: it shows, before you save, how the money you
 * just spent will be spread across what you bought — which is the number that
 * decides your taxable profit when each piece eventually sells.
 */
export function RecordPurchase({ onSaved }: { onSaved: () => void }) {
  const [purchasedOn, setPurchasedOn] = useState(today());
  const [vendor, setVendor] = useState('');
  const [channel, setChannel] = useState('card-show');
  const [description, setDescription] = useState('');
  const [subtotal, setSubtotal] = useState('');
  const [shipping, setShipping] = useState('');
  const [tax, setTax] = useState('');
  const [fees, setFees] = useState('');
  const [resaleExempt, setResaleExempt] = useState(false);
  const [method, setMethod] = useState<'relative-fmv' | 'equal'>('relative-fmv');
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const totalCents =
    parseMoney(subtotal) + parseMoney(shipping) + parseMoney(tax) + parseMoney(fees);

  // Mirror of the server-side allocation, so the split is visible before saving.
  const weights = items.map((i) =>
    method === 'relative-fmv' ? parseMoney(i.estimatedValue) * (Number(i.quantity) || 1) : Number(i.quantity) || 1,
  );
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  const preview = items.map((_, index) =>
    weightTotal === 0 ? Math.round(totalCents / items.length) : Math.round((totalCents * weights[index]!) / weightTotal),
  );

  function update(index: number, patch: Partial<DraftItem>): void {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const result = await api.recordPurchase({
        lot: {
          purchasedOn,
          vendor,
          channel,
          description,
          subtotalCents: parseMoney(subtotal),
          shippingCents: parseMoney(shipping),
          taxCents: parseMoney(tax),
          feesCents: parseMoney(fees),
          resaleExemptionUsed: resaleExempt,
        },
        allocationMethod: method,
        items: items
          .filter((i) => i.description.trim())
          .map((i) => ({
            description: i.description.trim(),
            kind: i.kind,
            holdingIntent: i.holdingIntent,
            quantity: Number(i.quantity) || 1,
            estimatedValueCents: i.estimatedValue ? parseMoney(i.estimatedValue) : null,
          })),
      });
      setSaved(`Saved ${result.items.length} item${result.items.length === 1 ? '' : 's'}.`);
      setItems([emptyItem()]);
      setSubtotal(''); setShipping(''); setTax(''); setFees(''); setDescription('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const hasInvestment = items.some((i) => i.holdingIntent === 'investment');

  return (
    <form onSubmit={submit}>
      <div className="section">
        <h2>Record a purchase</h2>
        <p className="sub">What you paid, and what you got for it.</p>
      </div>

      <div className="panel">
        <div className="row">
          <Field label="Date"><input type="date" value={purchasedOn} onChange={(e) => setPurchasedOn(e.target.value)} /></Field>
          <Field label="Where">
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="card-show">Card show</option>
              <option value="online-marketplace">Online marketplace</option>
              <option value="retail-store">Retail store</option>
              <option value="distributor">Distributor</option>
              <option value="private-sale">Private sale</option>
              <option value="trade">Trade</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>
        <Field label="Seller"><input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Who you bought from" /></Field>
        <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. stack of Prizm rookies" /></Field>
      </div>

      <div className="panel">
        <h3>What it cost</h3>
        <div className="row">
          <MoneyInput label="Price of the goods" value={subtotal} onChange={setSubtotal} />
          <MoneyInput label="Shipping to you" value={shipping} onChange={setShipping} hint="Part of what the goods cost, not a separate expense" />
        </div>
        <div className="row">
          <MoneyInput label="Sales tax paid" value={tax} onChange={setTax} />
          <MoneyInput label="Other fees" value={fees} onChange={setFees} hint="Buyer's premium, auction fees" />
        </div>
        <label className="switch">
          <input type="checkbox" checked={resaleExempt} onChange={(e) => setResaleExempt(e.target.checked)} />
          Bought tax-exempt for resale
        </label>
        <div className="stat" style={{ marginTop: 4 }}>
          <div className="label">Total cost to allocate</div>
          <div className="value">{money(totalCents)}</div>
        </div>
      </div>

      <div className="panel">
        <h3>What you got</h3>
        <Field
          label="How should the cost be split?"
          hint={
            method === 'relative-fmv'
              ? 'By what each item is worth. This is the general rule for property bought in a lot, and it puts the cost where the value is.'
              : 'Evenly. Reasonable for identical items; wrong for a lot where one card is most of the value.'
          }
        >
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="relative-fmv">By each item's value (recommended)</option>
            <option value="equal">Evenly</option>
          </select>
        </Field>

        {items.map((item, index) => (
          <div key={index} style={{ borderTop: index ? '1px solid var(--border)' : 0, paddingTop: index ? 12 : 0, marginTop: index ? 12 : 0 }}>
            <Field label={`Item ${index + 1}`}>
              <input
                value={item.description}
                onChange={(e) => update(index, { description: e.target.value })}
                placeholder="e.g. 2026 Prizm Caleb Williams RC"
              />
            </Field>
            <div className="row three">
              <Field label="Type">
                <select value={item.kind} onChange={(e) => update(index, { kind: e.target.value })}>
                  <option value="single">Single card</option>
                  <option value="sealed-to-open">Sealed (to open)</option>
                  <option value="sealed">Sealed (to resell)</option>
                  <option value="supply">Supplies</option>
                  <option value="equipment">Equipment</option>
                </select>
              </Field>
              <Field label="Quantity">
                <input inputMode="numeric" value={item.quantity} onChange={(e) => update(index, { quantity: e.target.value })} />
              </Field>
              <Field label="Worth each">
                <input inputMode="decimal" value={item.estimatedValue} onChange={(e) => update(index, { estimatedValue: e.target.value })} placeholder="0.00" />
              </Field>
            </div>
            <Field
              label="Holding it as"
              hint={
                item.holdingIntent === 'investment'
                  ? 'Kept out of the business entirely: not inventory, not a business cost, and taxed as a capital gain when sold.'
                  : 'Stock in trade. Its cost becomes cost of goods sold when it sells.'
              }
            >
              <select value={item.holdingIntent} onChange={(e) => update(index, { holdingIntent: e.target.value as DraftItem['holdingIntent'] })}>
                <option value="inventory">Inventory — buying it to resell</option>
                <option value="investment">Personal collection / investment</option>
              </select>
            </Field>
            <div className="faint">
              Cost basis: <strong style={{ color: 'var(--text)' }}>{money(preview[index] ?? 0)}</strong>
              {weightTotal > 0 && totalCents > 0 && ` (${Math.round(((preview[index] ?? 0) / totalCents) * 100)}% of the purchase)`}
            </div>
            {items.length > 1 && (
              <button type="button" className="btn danger small" style={{ marginTop: 8 }}
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}>
                Remove
              </button>
            )}
          </div>
        ))}

        <button type="button" className="btn secondary small" style={{ marginTop: 12 }}
          onClick={() => setItems((prev) => [...prev, emptyItem()])}>
          + Add another item
        </button>
      </div>

      {hasInvestment && (
        <Banner kind="warn">
          <strong>One of these is marked personal collection.</strong> Keep it physically separate from inventory,
          buy and sell it outside the business account, and never list it for sale. Those three things are what
          make the distinction hold up, and the Reports tab produces a dated schedule you can print and sign.
        </Banner>
      )}

      {error && <Banner kind="bad">{error}</Banner>}
      {saved && <Banner kind="good">{saved}</Banner>}

      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn" type="submit" disabled={saving || totalCents <= 0 || !items.some((i) => i.description.trim())}>
          {saving ? 'Saving…' : 'Save purchase'}
        </button>
      </div>
    </form>
  );
}
