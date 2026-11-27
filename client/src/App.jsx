import { useCallback, useEffect, useState } from 'react';
import CatalogBuilder from './CatalogBuilder.jsx';
import LoginGate from './components/LoginGate.jsx';
import SaleHistoryView from './components/SaleHistoryView.jsx';
import SalesSheet from './components/SalesSheet.jsx';
import SellersPanel from './components/SellersPanel.jsx';
import { api } from './lib/api.js';

export default function App() {
  const [tab, setTab] = useState('catalog');
  const [items, setItems] = useState([]);
  const [catalogSource, setCatalogSource] = useState('');
  const [sellers, setSellers] = useState([]);
  const [mode, setMode] = useState('local');
  const [syncing, setSyncing] = useState(false);
  const [bootError, setBootError] = useState('');
  const [auth, setAuth] = useState(null);
  const [historySaleId, setHistorySaleId] = useState(null);

  const loadCatalog = useCallback(async () => {
    const data = await api.catalog();
    setItems(data.items || []);
    setCatalogSource(data.source);
    return data;
  }, []);

  const loadSellers = useCallback(async () => {
    const data = await api.sellers(true);
    setSellers(data.sellers || []);
    return data;
  }, []);

  const refreshAuth = useCallback(async () => {
    const status = await api.authStatus();
    setAuth(status);
    return status;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [health, status] = await Promise.all([api.health(), refreshAuth()]);
        setMode(health.mode);
        if (status.authenticated) {
          await Promise.all([loadCatalog(), loadSellers()]);
        }
      } catch (err) {
        setBootError(err.message);
      }
    })();
  }, [loadCatalog, loadSellers, refreshAuth]);

  async function handleLoginSuccess() {
    setBootError('');
    await refreshAuth();
    await Promise.all([loadCatalog(), loadSellers()]);
  }

  async function handleLogout() {
    await api.logout();
    setAuth((a) => ({ ...a, authenticated: false, user: null }));
    setItems([]);
    setSellers([]);
    setHistorySaleId(null);
    setTab('catalog');
  }

  async function syncCatalog() {
    setSyncing(true);
    try {
      const result = await api.seedCatalog();
      await loadCatalog();
      return result;
    } finally {
      setSyncing(false);
    }
  }

  async function moveGenero(item, genero) {
    if (!item?.id) throw new Error('ítem sin id');
    const result = await api.moveGenero(item.id, genero);
    await loadCatalog();
    return result;
  }

  if (!auth) {
    return (
      <div className="app-shell">
        <p className="muted">{bootError || 'Cargando…'}</p>
      </div>
    );
  }

  if (!auth.authenticated) {
    return (
      <LoginGate
        userRequired={auth.userRequired}
        softLock={auth.softLock}
        onSuccess={handleLoginSuccess}
      />
    );
  }

  const activeSellers = sellers.filter((s) => s.active !== false);

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="brand">American Grace</p>
        <p className="hero-lead">
          Inventario y ventas de ropa infantil — catálogo local-first, sync a la nube cuando quieras.
        </p>
      </header>

      <nav className="nav-tabs" aria-label="Secciones">
        <button
          type="button"
          className={tab === 'catalog' && !historySaleId ? 'active' : ''}
          onClick={() => {
            setHistorySaleId(null);
            setTab('catalog');
          }}
        >
          Catálogo
        </button>
        <button
          type="button"
          className={tab === 'sales' || historySaleId ? 'active' : ''}
          onClick={() => {
            setHistorySaleId(null);
            setTab('sales');
          }}
        >
          Ventas
        </button>
        <button
          type="button"
          className={tab === 'sellers' && !historySaleId ? 'active' : ''}
          onClick={() => {
            setHistorySaleId(null);
            setTab('sellers');
          }}
        >
          Vendedores
        </button>
        <span className="muted" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: '0.85rem' }}>
          <span className={`status-dot ${mode === 'supabase' ? '' : 'off'}`} />
          Modo {mode}
          {auth.user ? ` · ${auth.user}` : ''}
        </span>
        <button type="button" className="btn ghost" onClick={handleLogout}>
          Salir
        </button>
      </nav>

      {bootError ? (
        <div className="panel">
          <p>No se pudo conectar a la API: {bootError}</p>
        </div>
      ) : null}

      {historySaleId ? (
        <SaleHistoryView
          saleId={historySaleId}
          onBack={() => {
            setHistorySaleId(null);
            setTab('sales');
          }}
        />
      ) : null}

      {!historySaleId && tab === 'catalog' ? (
        <CatalogBuilder
          items={items}
          source={catalogSource}
          onSync={syncCatalog}
          onMoveGenero={moveGenero}
          onCatalogChanged={loadCatalog}
          syncing={syncing}
        />
      ) : null}

      {!historySaleId && tab === 'sales' ? (
        <SalesSheet
          sellers={activeSellers}
          catalog={items}
          onOpenHistory={(id) => setHistorySaleId(id)}
        />
      ) : null}

      {!historySaleId && tab === 'sellers' ? (
        <SellersPanel sellers={sellers} onChanged={loadSellers} />
      ) : null}
    </div>
  );
}
