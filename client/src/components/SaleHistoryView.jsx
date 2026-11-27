import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import SaleSnapshotCards from './SaleSnapshotCards.jsx';

function actionLabel(action) {
  if (action === 'cambio') return 'Cambio';
  if (action === 'edit') return 'Edición';
  if (action === 'create') return 'Alta';
  if (action === 'estado') return 'Estado';
  return action || '—';
}

export default function SaleHistoryView({ saleId, onBack, backLabel = '← Volver a ventas' }) {
  const [sale, setSale] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [detail, hist] = await Promise.all([
          api.sale(saleId),
          api.saleHistory(saleId),
        ]);
        if (cancelled) return;
        setSale(detail.sale || null);
        setHistory(hist.history || detail.sale?.history || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [saleId]);

  return (
    <section className="panel history-page module-panel">
      <div className="history-page-head">
        <button type="button" className="btn ghost" onClick={onBack}>
          {backLabel}
        </button>
        <div>
          <p className="module-kicker">Detalle</p>
          <h2>Venta #{saleId}</h2>
          <p className="panel-sub">
            Antes / después de cada cambio. Los cambios de prenda también aparecen en{' '}
            <strong>Historial de cambios</strong>, agrupados por referencia.
          </p>
        </div>
      </div>

      {loading ? <p className="muted">Cargando…</p> : null}
      {error ? <p className="login-error">{error}</p> : null}

      {sale ? (
        <div className="history-summary">
          <SaleSnapshotCards data={sale} title="Estado actual" tone="current" />
        </div>
      ) : null}

      <div className="history-list">
        {!loading && !history.length ? (
          <p className="muted">Sin registros de cambio para esta venta.</p>
        ) : null}
        {history.map((h) => (
          <article className="history-item history-item-full" key={h.id}>
            <header>
              <strong className="action-badge">{actionLabel(h.action)}</strong>
              <span className="history-meta">
                {h.changed_by || '—'} ·{' '}
                {h.created_at
                  ? new Date(h.created_at).toLocaleString('es-CO', {
                      timeZone: 'America/Bogota',
                    })
                  : ''}
              </span>
            </header>
            {h.context ? <p className="muted history-context">{h.context}</p> : null}
            <div className="before-after">
              <SaleSnapshotCards data={h.before_data} title="Antes" tone="before" />
              <SaleSnapshotCards data={h.after_data} title="Después" tone="after" />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
