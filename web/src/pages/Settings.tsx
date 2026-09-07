import { useEffect, useState } from 'react';
import { api, money, type Profile, type TaxFigure } from '../lib/api';
import { Banner, Field, Spinner } from '../components/ui';

/** Who the business is, plus every tax figure the app uses and where it came from. */
export function Settings({ year, onSaved }: { year: number; onSaved: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [figures, setFigures] = useState<TaxFigure[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.profile(), api.figures(year).catch(() => ({ figures: [] }))])
      .then(([p, f]) => { setProfile(p); setFigures(f.figures); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load'));
  }, [year]);

  if (error) return <Banner kind="bad">{error}</Banner>;
  if (!profile) return <Spinner />;

  const set = <K extends keyof Profile>(key: K, value: Profile[K]): void =>
    setProfile((p) => (p ? { ...p, [key]: value } : p));

  async function save(): Promise<void> {
    if (!profile) return;
    setSaving(true);
    setSaved(false);
    try {
      await api.saveProfile(profile);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const shaky = figures.filter((f) => f.confidence !== 'verified');

  return (
    <>
      <div className="section">
        <h2>Your business</h2>
        <p className="sub">These drive the tax calculations, so they are worth getting right.</p>
      </div>

      <div className="panel">
        <div className="row">
          <Field label="Business name"><input value={profile.businessName} onChange={(e) => set('businessName', e.target.value)} /></Field>
          <Field label="Your name"><input value={profile.ownerName} onChange={(e) => set('ownerName', e.target.value)} /></Field>
        </div>
        <div className="row">
          <Field label="Structure">
            <select value={profile.entityType} onChange={(e) => set('entityType', e.target.value)}>
              <option value="sole-proprietor">Sole proprietor</option>
              <option value="single-member-llc">Single-member LLC</option>
              <option value="multi-member-llc">Multi-member LLC</option>
              <option value="s-corp">S corporation</option>
            </select>
          </Field>
          <Field label="Started trading"><input type="date" value={profile.startedOn ?? ''} onChange={(e) => set('startedOn', e.target.value || null)} /></Field>
        </div>
        <div className="row three">
          <Field label="City"><input value={profile.city} onChange={(e) => set('city', e.target.value)} /></Field>
          <Field label="County"><input value={profile.county} onChange={(e) => set('county', e.target.value)} /></Field>
          <Field label="State"><input value={profile.state} maxLength={2} onChange={(e) => set('state', e.target.value.toUpperCase())} /></Field>
        </div>
      </div>

      <div className="panel">
        <h3>Tax situation</h3>
        <Field label="Filing status">
          <select value={profile.filingStatus} onChange={(e) => set('filingStatus', e.target.value)}>
            <option value="single">Single</option>
            <option value="married-joint">Married filing jointly</option>
            <option value="married-separate">Married filing separately</option>
            <option value="head-of-household">Head of household</option>
          </select>
        </Field>
        <div className="row">
          <Field label="Wages from a day job" hint="Used to work out how much Social Security wage base is left">
            <input inputMode="decimal" value={(profile.otherIncomeCents / 100) || ''} onChange={(e) => set('otherIncomeCents', Math.round((Number(e.target.value) || 0) * 100))} />
          </Field>
          <Field label="Tax already withheld" hint="Counts toward the estimated tax requirement">
            <input inputMode="decimal" value={(profile.otherWithholdingCents / 100) || ''} onChange={(e) => set('otherWithholdingCents', Math.round((Number(e.target.value) || 0) * 100))} />
          </Field>
        </div>
        <div className="row">
          <Field label="Last year's total tax" hint="Leave blank in your first year. Paying 100% of this protects you from penalties.">
            <input inputMode="decimal" value={profile.priorYearTaxCents === null ? '' : profile.priorYearTaxCents / 100}
              onChange={(e) => set('priorYearTaxCents', e.target.value === '' ? null : Math.round((Number(e.target.value) || 0) * 100))} />
          </Field>
          <Field label="Last year's AGI" hint="Above $150,000 the prior-year safe harbour becomes 110%.">
            <input inputMode="decimal" value={profile.priorYearAgiCents === null ? '' : profile.priorYearAgiCents / 100}
              onChange={(e) => set('priorYearAgiCents', e.target.value === '' ? null : Math.round((Number(e.target.value) || 0) * 100))} />
          </Field>
        </div>
      </div>

      <div className="panel">
        <h3>Inventory method</h3>
        <Field
          label="How inventory is deducted"
          hint={
            profile.inventoryMethod === 'inventory'
              ? 'Full inventory accounting: cost is deducted when an item sells, and unsold stock is reported at year end.'
              : 'Small-business simplification: cost is deducted when an item sells, with far less year-end paperwork. Available because your receipts are nowhere near the threshold.'
          }
        >
          <select value={profile.inventoryMethod} onChange={(e) => set('inventoryMethod', e.target.value as Profile['inventoryMethod'])}>
            <option value="inventory">Track inventory (Schedule C Part III)</option>
            <option value="materials-and-supplies">Treat as materials and supplies</option>
          </select>
        </Field>
        <p className="faint">
          Either way, buying inventory in December is not deductible until it sells. That is the single most common
          misunderstanding about year-end buying.
        </p>
      </div>

      <div className="panel">
        <h3>Home office</h3>
        <div className="row">
          <Field label="Office square feet" hint="Must be used regularly AND exclusively for the business">
            <input inputMode="decimal" value={profile.homeOfficeSqFt ?? ''} onChange={(e) => set('homeOfficeSqFt', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
          <Field label="Whole home square feet">
            <input inputMode="decimal" value={profile.homeTotalSqFt ?? ''} onChange={(e) => set('homeTotalSqFt', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
        </div>
        <p className="faint">
          Exclusively means no other use at all. A desk in a room that is also a bedroom does not qualify, and that
          is where most of these claims fall apart.
        </p>
      </div>

      {saved && <Banner kind="good">Saved.</Banner>}
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>

      <div className="section">
        <h2>Tax figures for {year}</h2>
        <p className="sub">
          Every rate and threshold this app uses, with where it came from. Check any of them yourself.
        </p>
      </div>

      {shaky.length > 0 && (
        <Banner kind="warn">
          <strong>{shaky.length} figure{shaky.length === 1 ? '' : 's'} not fully confirmed.</strong> Indexed
          figures change annually, and the app will not compute from one it could not verify — it says so instead.
        </Banner>
      )}

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Figure</th><th className="num">Value</th><th>Source</th></tr></thead>
            <tbody>
              {figures.map((f) => (
                <tr key={f.key}>
                  <td>
                    {f.label}
                    <div className="faint">
                      {f.kind === 'indexed' ? 'Changes every year' : 'Set by statute'}
                      {f.confidence !== 'verified' && ` · ${f.confidence}`}
                    </div>
                    {f.note && <div className="faint">{f.note}</div>}
                  </td>
                  <td className="num">{formatFigure(f)}</td>
                  <td className="faint">
                    {f.authority}
                    <div><a href={f.source} target="_blank" rel="noreferrer noopener">Check</a></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** Rates render as percentages, thresholds as money, counts as numbers. */
function formatFigure(f: TaxFigure): string {
  if (f.value > 0 && f.value < 1) return `${(f.value * 100).toFixed(2)}%`;
  if (f.key.includes('SqFt') || f.key.includes('maxSquareFeet')) return `${f.value}`;
  if (f.key.includes('RatePerSqFt')) return money(f.value);
  return money(f.value);
}
