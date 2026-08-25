import { useEffect, useState } from 'react';
import { api, type Health } from '../lib/api';

/** Status, connected data sources, and what to set up next. */
export function Settings() {
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setHealth(await api.health());
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (!health) {
    return (
      <div className="empty">
        <span className="spinner" />
      </div>
    );
  }

  const liveSource = health.sources.find((s) => s.configured && s.id !== 'demo');
  const quotaPct = health.quota.dailyBudget > 0 ? health.quota.usedToday / health.quota.dailyBudget : 0;

  return (
    <>
      <div className="section">
        <h2>Status</h2>
      </div>

      {!liveSource && (
        <div className="banner warn">
          <strong>You are on demo data.</strong> The listings in the feed are generated, not real. Add free eBay
          developer credentials to <code>.env</code> to search the live market — see <code>docs/EBAY_SETUP.md</code> in
          the project folder.
        </div>
      )}

      <div className="panel">
        <div className="meta" style={{ gap: '10px 18px' }}>
          <span>
            <b>{health.counts.listings}</b> listings tracked
          </span>
          <span>
            <b>{health.counts.underMsrp}</b> under MSRP
          </span>
          <span>
            <b>{health.counts.observations}</b> price observations
          </span>
          <span>
            <b>{health.counts.baselines}</b> market baselines
          </span>
          <span>
            <b>{health.counts.activeWatches}</b> active watches
          </span>
        </div>
        <p className="faint" style={{ marginTop: 10 }}>
          Price observations accumulate every scan. Market baselines — how singles get priced when no MSRP exists —
          get more accurate the longer the app runs.
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Marketplaces</h2>
        {health.sources.map((source) => (
          <div key={source.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className={`badge ${source.configured ? 'good' : 'neutral'}`}>
                {source.configured ? 'Ready' : 'Not set up'}
              </span>
              <strong>{source.name}</strong>
            </div>
            {source.reason && (
              <p className="faint" style={{ margin: '4px 0 0' }}>
                {source.reason}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Price data (for singles)</h2>
        <p className="faint" style={{ marginTop: 0 }}>
          Individual cards have no MSRP, so they are compared against market value instead. These providers supply it.
        </p>
        {health.compProviders.map((provider) => (
          <div key={provider.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className={`badge ${provider.configured ? 'good' : 'neutral'}`}>
                {provider.configured ? 'Ready' : 'Not set up'}
              </span>
              <strong>{provider.name}</strong>
            </div>
            {provider.reason && (
              <p className="faint" style={{ margin: '4px 0 0' }}>
                {provider.reason}
              </p>
            )}
          </div>
        ))}
      </div>

      {liveSource && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>eBay API quota today</h2>
          <div className="confidence">
            <span className="confidence-bar" style={{ maxWidth: 'none' }}>
              <i
                style={{
                  width: `${Math.min(100, Math.round(quotaPct * 100))}%`,
                  background: quotaPct > 0.8 ? 'var(--hot)' : 'var(--accent)',
                }}
              />
            </span>
          </div>
          <p className="faint" style={{ marginTop: 8 }}>
            {health.quota.usedToday} of {health.quota.dailyBudget} calls used. eBay allows 5,000 per day on a free
            account, shared across everything this app does. It resets at midnight UTC.
          </p>
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Alerts</h2>
        <p className="faint" style={{ marginTop: 0 }}>
          {health.notifications.configured
            ? 'Push notifications are configured. New deals that clear your threshold are sent automatically.'
            : 'Not configured. Set NTFY_TOPIC in .env and subscribe to the same topic in the ntfy app to get deals pushed to your phone — no account needed.'}
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Maintenance</h2>
        <p className="faint" style={{ marginTop: 0 }}>
          Recompute market baselines and check which tracked listings have disappeared. This normally runs hourly on
          its own.
        </p>
        <button
          className="btn secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.rebuild();
              await refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Working…' : 'Rebuild baselines now'}
        </button>
      </div>
    </>
  );
}
