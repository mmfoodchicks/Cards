import { useCallback, useEffect, useState } from 'react';
import { api, type Health } from './lib/api';
import { Dashboard } from './pages/Dashboard';
import { RecordPurchase } from './pages/RecordPurchase';
import { Inventory } from './pages/Inventory';
import { MoneyPage } from './pages/Money';
import { Reports } from './pages/Reports';
import { Compliance } from './pages/Compliance';
import { Settings } from './pages/Settings';

type Tab = 'dashboard' | 'buy' | 'inventory' | 'record' | 'reports' | 'compliance' | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Home', icon: '📊' },
  { id: 'buy', label: 'Buy', icon: '🛒' },
  { id: 'inventory', label: 'Stock', icon: '📦' },
  { id: 'record', label: 'Record', icon: '💵' },
  { id: 'reports', label: 'Taxes', icon: '🧾' },
  { id: 'compliance', label: 'Setup', icon: '✅' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [health, setHealth] = useState<Health | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [refresh, setRefresh] = useState(0);

  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    api.health().then((h) => {
      setHealth(h);
      setYear(h.taxYear);
    }).catch(() => undefined);
  }, [refresh]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          📒 CardLedger
          <span>{health?.profile.businessName || 'bookkeeping and tax'}</span>
        </div>
        <select className="year-pick" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Tax year">
          {(health?.availableTaxYears ?? [year]).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </header>

      <main key={`${tab}-${year}-${refresh}`}>
        {tab === 'dashboard' && <Dashboard year={year} onNavigate={(t) => setTab(t as Tab)} />}
        {tab === 'buy' && <RecordPurchase onSaved={reload} />}
        {tab === 'inventory' && <Inventory />}
        {tab === 'record' && <MoneyPage year={year} onChanged={reload} />}
        {tab === 'reports' && <Reports year={year} />}
        {tab === 'compliance' && <Compliance />}
        {tab === 'settings' && <Settings year={year} onSaved={reload} />}
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <span className="ico">{t.icon}</span>
            {t.label}
          </button>
        ))}
        <button aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}>
          <span className="ico">⚙️</span>
          You
        </button>
      </nav>
    </div>
  );
}
