import type { ReactNode } from 'react';
import { money } from '../lib/api';

export function Stat({
  label, value, note, tone,
}: { label: string; value: ReactNode; note?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value${tone ? ` ${tone}` : ''}`}>{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

export function MoneyStat(props: { label: string; cents: number; note?: ReactNode; signed?: boolean }) {
  const tone = props.signed ? (props.cents >= 0 ? 'good' : 'bad') : undefined;
  return <Stat label={props.label} value={money(props.cents)} note={props.note} tone={tone} />;
}

export function Banner({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode }) {
  return <div className={`banner${kind === 'info' ? '' : ` ${kind}`}`}>{children}</div>;
}

export function Spinner() {
  return (
    <div className="empty">
      <span className="spinner" />
    </div>
  );
}

export function Empty({ icon = '📭', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-dim)' }}>{title}</p>
      {children && <p className="faint" style={{ maxWidth: 420, margin: '8px auto 0' }}>{children}</p>}
    </div>
  );
}

export function Field({
  label, hint, children,
}: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function MoneyInput({
  label, hint, value, onChange, placeholder,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '0.00'}
      />
    </Field>
  );
}

/**
 * Shows where a tax figure came from.
 *
 * Every number this app produces should be checkable. Putting the authority and
 * a link next to the figure is the difference between software you can verify
 * and software you have to trust.
 */
export function SourceNote({ authority, source, confidence }: { authority: string; source: string; confidence?: string }) {
  return (
    <div className="source-link">
      {authority}
      {' · '}
      <a href={source} target="_blank" rel="noreferrer noopener">check the source</a>
      {confidence && confidence !== 'verified' && (
        <> · <strong style={{ color: 'var(--warn)' }}>{confidence}</strong></>
      )}
    </div>
  );
}
