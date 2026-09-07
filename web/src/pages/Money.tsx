import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, money, parseMoney, today, type Account, type Item } from '../lib/api';
import { Banner, Empty, Field, MoneyInput, Spinner } from '../components/ui';

type Mode = 'sale' | 'expense' | 'mileage';

/** Sales, expenses and mileage — the three things recorded most often. */
export function MoneyPage({ year, onChanged }: { year: number; onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>('sale');

  return (
    <>
      <div className="section">
        <h2>Record</h2>
        <div className="btn-row" style={{ marginTop: 8 }}>
          {(['sale', 'expense', 'mileage'] as Mode[]).map((m) => (
            <button
              key={m}
              className={`btn ${mode === m ? '' : 'secondary'} small`}
              onClick={() => setMode(m)}
            >
              {m === 'sale' ? 'Sale' : m === 'expense' ? 'Expense' : 'Mileage'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'sale' && <SaleForm year={year} onChanged={onChanged} />}
      {mode === 'expense' && <ExpenseForm year={year} onChanged={onChanged} />}
      {mode === 'mileage' && <MileageForm year={year} onChanged={onChanged} />}
    </>
  );
}

function SaleForm({ year, onChanged }: { year: number; onChanged: () => void }) {
  const [available, setAvailable] = useState<Item[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [soldOn, setSoldOn] = useState(today());
  const [channel, setChannel] = useState('ebay');
  const [gross, setGross] = useState('');
  const [shippingCharged, setShippingCharged] = useState('');
  const [platformFee, setPlatformFee] = useState('');
  const [processingFee, setProcessingFee] = useState('');
  const [shippingCost, setShippingCost] = useState('');
  const [salesTax, setSalesTax] = useState('');
  const [platformRemits, setPlatformRemits] = useState(true);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.items({ status: 'on-hand,listed', search, limit: 60 });
    setAvailable(res.items);
  }, [search]);

  useEffect(() => {
    const handle = setTimeout(() => void load(), 200);
    return () => clearTimeout(handle);
  }, [load]);

  const chosen = available.filter((i) => selected.includes(i.id));
  const basis = chosen.reduce((sum, i) => sum + i.basisCents, 0);
  const receipts = parseMoney(gross) + parseMoney(shippingCharged);
  const costs = parseMoney(platformFee) + parseMoney(processingFee) + parseMoney(shippingCost);
  const profit = receipts - basis - costs;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      await api.recordSale({
        soldOn,
        channel,
        grossCents: parseMoney(gross),
        shippingChargedCents: parseMoney(shippingCharged),
        salesTaxCollectedCents: parseMoney(salesTax),
        salesTaxRemittedByPlatform: platformRemits,
        platformFeeCents: parseMoney(platformFee),
        paymentProcessingFeeCents: parseMoney(processingFee),
        shippingCostCents: parseMoney(shippingCost),
        lines: selected.map((itemId) => ({ itemId, quantity: 1 })),
      });
      setSaved('Sale recorded, and the items are out of inventory.');
      setSelected([]); setGross(''); setShippingCharged(''); setPlatformFee('');
      setProcessingFee(''); setShippingCost(''); setSalesTax('');
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const investmentSelected = chosen.some((i) => i.holdingIntent === 'investment');

  return (
    <form onSubmit={submit}>
      <div className="panel">
        <h3>What sold</h3>
        <Field label="Find the item"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search inventory…" /></Field>
        {available.length === 0 ? (
          <p className="faint">Nothing available. Record a purchase first.</p>
        ) : (
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {available.map((item) => (
              <label className="switch" key={item.id} style={{ alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={(e) =>
                    setSelected((prev) => (e.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)))
                  }
                />
                <span>
                  {item.description}
                  {item.holdingIntent === 'investment' && <span className="pill investment" style={{ marginLeft: 6 }}>Collection</span>}
                  <span className="faint" style={{ display: 'block' }}>cost {money(item.basisCents)}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {investmentSelected && (
        <Banner kind="warn">
          <strong>That is a personal collection item.</strong> Selling it is a capital gain reported on Form 8949,
          not business income — no self-employment tax on it. It will be kept out of the Schedule C figures and
          shown under Capital gains instead. If you meant to sell it as inventory, change how it is held first,
          and be aware that converting a collection piece to inventory means the entire gain becomes ordinary
          income subject to self-employment tax.
        </Banner>
      )}

      <div className="panel">
        <h3>The money</h3>
        <div className="row">
          <Field label="Date"><input type="date" value={soldOn} onChange={(e) => setSoldOn(e.target.value)} /></Field>
          <Field label="Where">
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="ebay">eBay</option>
              <option value="whatnot">Whatnot</option>
              <option value="tcgplayer">TCGplayer</option>
              <option value="comc">COMC</option>
              <option value="mercari">Mercari</option>
              <option value="card-show">Card show</option>
              <option value="local-in-person">Local / in person</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>
        <div className="row">
          <MoneyInput label="Sale price" value={gross} onChange={setGross} />
          <MoneyInput label="Shipping the buyer paid" value={shippingCharged} onChange={setShippingCharged} hint="This is income; the label below is the expense" />
        </div>
        <div className="row">
          <MoneyInput label="Platform fee" value={platformFee} onChange={setPlatformFee} />
          <MoneyInput label="Payment processing" value={processingFee} onChange={setProcessingFee} />
        </div>
        <div className="row">
          <MoneyInput label="Postage you paid" value={shippingCost} onChange={setShippingCost} />
          <MoneyInput label="Sales tax collected" value={salesTax} onChange={setSalesTax} hint="Not income — it belongs to the state" />
        </div>
        <label className="switch">
          <input type="checkbox" checked={platformRemits} onChange={(e) => setPlatformRemits(e.target.checked)} />
          The platform collected and remitted the sales tax
        </label>
      </div>

      {chosen.length > 0 && parseMoney(gross) > 0 && (
        <div className="panel">
          <h3>What you actually made</h3>
          <table>
            <tbody>
              <tr><td>Receipts</td><td className="num">{money(receipts)}</td></tr>
              <tr><td>Cost of the items</td><td className="num">-{money(basis)}</td></tr>
              <tr><td>Fees and postage</td><td className="num">-{money(costs)}</td></tr>
              <tr className="total"><td>Profit before tax</td><td className="num">{money(profit)}</td></tr>
            </tbody>
          </table>
          <p className="faint" style={{ marginTop: 8 }}>
            Roughly {money(Math.max(0, Math.round(profit * 0.1413)))} of that goes to self-employment tax alone,
            before income tax.
          </p>
        </div>
      )}

      {error && <Banner kind="bad">{error}</Banner>}
      {saved && <Banner kind="good">{saved}</Banner>}

      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn" type="submit" disabled={saving || selected.length === 0 || parseMoney(gross) <= 0}>
          {saving ? 'Saving…' : 'Record sale'}
        </button>
      </div>
    </form>
  );
}

function ExpenseForm({ year, onChanged }: { year: number; onChanged: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [recent, setRecent] = useState<Array<{ id: number; incurredOn: string; accountKey: string; vendor: string | null; description: string; amountCents: number }>>([]);
  const [incurredOn, setIncurredOn] = useState(today());
  const [accountKey, setAccountKey] = useState('shipping-supplies');
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [businessUse, setBusinessUse] = useState('100');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, e] = await Promise.all([api.accounts(), api.expenses(year)]);
    setAccounts(a.accounts);
    setRecent(e.expenses.slice(0, 12));
  }, [year]);

  useEffect(() => { void load(); }, [load]);

  const account = accounts.find((a) => a.key === accountKey);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.recordExpense({
        incurredOn, accountKey, vendor: vendor || null, description,
        amountCents: parseMoney(amount),
        businessUsePercent: Number(businessUse) || 100,
      });
      setAmount(''); setDescription(''); setVendor('');
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form onSubmit={submit}>
        <div className="panel">
          <div className="row">
            <Field label="Date"><input type="date" value={incurredOn} onChange={(e) => setIncurredOn(e.target.value)} /></Field>
            <MoneyInput label="Amount" value={amount} onChange={setAmount} />
          </div>
          <Field label="Category" hint={account ? `Schedule C line ${account.scheduleCLine} — ${account.description}` : undefined}>
            <select value={accountKey} onChange={(e) => setAccountKey(e.target.value)}>
              {accounts.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
            </select>
          </Field>
          {account?.caution && <Banner kind="warn">{account.caution}</Banner>}
          {account && account.examples.length > 0 && (
            <p className="faint" style={{ marginTop: -4, marginBottom: 12 }}>For example: {account.examples.join(', ')}.</p>
          )}
          <div className="row">
            <Field label="Paid to"><input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="USPS, eBay, Amazon…" /></Field>
            <Field label="Business use %" hint="Below 100 for anything you also use personally">
              <input inputMode="numeric" value={businessUse} onChange={(e) => setBusinessUse(e.target.value)} />
            </Field>
          </div>
          <Field label="What was it"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 500 toploaders" /></Field>
        </div>

        {error && <Banner kind="bad">{error}</Banner>}
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn" type="submit" disabled={saving || parseMoney(amount) === 0}>
            {saving ? 'Saving…' : 'Record expense'}
          </button>
        </div>
      </form>

      {recent.length > 0 && (
        <div className="section">
          <h2>Recent expenses</h2>
          <div className="panel">
            {recent.map((e) => (
              <div className="list-item" key={e.id}>
                <div className="grow">
                  <div>{e.description || accounts.find((a) => a.key === e.accountKey)?.name}</div>
                  <div className="faint">{formatDate(e.incurredOn)}{e.vendor ? ` · ${e.vendor}` : ''}</div>
                </div>
                <div className="amount">{money(e.amountCents)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function MileageForm({ year, onChanged }: { year: number; onChanged: () => void }) {
  const [trips, setTrips] = useState<Array<{ id: number; drivenOn: string; purpose: string; fromLocation: string | null; toLocation: string | null; miles: number; roundTrip: boolean }>>([]);
  const [drivenOn, setDrivenOn] = useState(today());
  const [purpose, setPurpose] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [miles, setMiles] = useState('');
  const [roundTrip, setRoundTrip] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.mileage(year);
    setTrips(res.trips.slice(0, 15));
  }, [year]);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.recordTrip({
        drivenOn, purpose,
        fromLocation: from || null, toLocation: to || null,
        miles: Number(miles) || 0, roundTrip,
      });
      setPurpose(''); setMiles(''); setFrom(''); setTo('');
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const totalMiles = trips.reduce((sum, t) => sum + (t.roundTrip ? t.miles * 2 : t.miles), 0);

  return (
    <>
      <form onSubmit={submit}>
        <div className="panel">
          <div className="row">
            <Field label="Date"><input type="date" value={drivenOn} onChange={(e) => setDrivenOn(e.target.value)} /></Field>
            <Field label="Miles one way"><input inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value)} /></Field>
          </div>
          <Field label="Why" hint="The business purpose has to be recorded — that is what the substantiation rules ask for.">
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Layton card show, buying inventory" />
          </Field>
          <div className="row">
            <Field label="From"><input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Home" /></Field>
            <Field label="To"><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Davis Conference Center" /></Field>
          </div>
          <label className="switch">
            <input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} />
            Round trip (doubles the miles)
          </label>
        </div>

        <Banner>
          Driving from home to a regular workplace is commuting and does not count. Driving to a show, to the post
          office, or to meet a seller does. Parking and tolls are deductible on top of the mileage rate.
        </Banner>

        {error && <Banner kind="bad">{error}</Banner>}
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn" type="submit" disabled={saving || !purpose.trim() || !miles}>
            {saving ? 'Saving…' : 'Log the trip'}
          </button>
        </div>
      </form>

      {trips.length > 0 && (
        <div className="section">
          <h2>{totalMiles.toFixed(1)} business miles logged</h2>
          <div className="panel">
            {trips.map((t) => (
              <div className="list-item" key={t.id}>
                <div className="grow">
                  <div>{t.purpose}</div>
                  <div className="faint">
                    {formatDate(t.drivenOn)}
                    {t.fromLocation && t.toLocation ? ` · ${t.fromLocation} → ${t.toLocation}` : ''}
                    {t.roundTrip ? ' · round trip' : ''}
                  </div>
                </div>
                <div className="amount">{(t.roundTrip ? t.miles * 2 : t.miles).toFixed(1)} mi</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
