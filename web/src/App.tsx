import { useState } from 'react';
import { Deals } from './pages/Deals';
import { Search } from './pages/Search';
import { Watches } from './pages/Watches';
import { Catalog } from './pages/Catalog';
import { Settings } from './pages/Settings';

type Tab = 'deals' | 'search' | 'watches' | 'catalog' | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'deals', label: 'Deals', icon: '🔥' },
  { id: 'search', label: 'Search', icon: '🔍' },
  { id: 'watches', label: 'Watches', icon: '\u{1F4E1}' },
  { id: 'catalog', label: 'MSRP', icon: '\u{1F3F7}\u{FE0F}' },
  { id: 'settings', label: 'Setup', icon: '⚙️' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('deals');
  const [search, setSearch] = useState('');

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <div className="brand">
            🦅 CardHawk <small>deals under MSRP</small>
          </div>
        </div>
        {tab === 'deals' && (
          <div className="search" style={{ marginTop: 10 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter the feed…"
              aria-label="Filter deals"
            />
          </div>
        )}
      </header>

      <main>
        {tab === 'deals' && <Deals search={search} />}
        {tab === 'search' && <Search />}
        {tab === 'watches' && <Watches />}
        {tab === 'catalog' && <Catalog />}
        {tab === 'settings' && <Settings />}
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <span className="ico">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
