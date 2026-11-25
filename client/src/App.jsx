import { useCallback, useEffect, useState } from 'react';
import CatalogBuilder from './CatalogBuilder.jsx';
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

  const loadCatalog = useCallback(async () => {
    const data = await api.catalog();
    setItems(data.items || []);
    setCatalogSource(data.source);
    return data;
  }, []);

  const loadSellers = useCallback(async () => {
    const data = await api.sellers();
    setSellers(data.sellers || []);
    return data;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const health = await api.health();
        setMode(health.mode);
        await Promise.all([loadCatalog(), loadSellers()]);
      } catch (err) {
        setBootError(err.message);
      }
    })();
  }, [loadCatalog, loadSellers]);

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
          className={tab === 'catalog' ? 'active' : ''}
          onClick={() => setTab('catalog')}
        >
          Catálogo
        </button>
        <button
          type="button"
          className={tab === 'sales' ? 'active' : ''}
          onClick={() => setTab('sales')}
        >
          Ventas
        </button>
        <button
          type="button"
          className={tab === 'sellers' ? 'active' : ''}
          onClick={() => setTab('sellers')}
        >
          Vendedores
        </button>
        <span className="muted" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: '0.85rem' }}>
          <span className={`status-dot ${mode === 'supabase' ? '' : 'off'}`} />
          Modo {mode}
        </span>
      </nav>

      {bootError ? (
        <div className="panel">
          <p>No se pudo conectar a la API: {bootError}</p>
        </div>
      ) : null}

      {tab === 'catalog' ? (
        <CatalogBuilder
          items={items}
          source={catalogSource}
          onSync={syncCatalog}
          onMoveGenero={moveGenero}
          syncing={syncing}
        />
      ) : null}

      {tab === 'sales' ? <SalesSheet sellers={sellers} catalog={items} /> : null}

      {tab === 'sellers' ? (
        <SellersPanel sellers={sellers} onChanged={loadSellers} />
      ) : null}
    </div>
  );
}
