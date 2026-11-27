import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import SaleSnapshotCards from './SaleSnapshotCards.jsx';

function actionLabel(action) {
  if (action === 'cambio') return 'Cambio';
  if (action === 'edit') return 'Edición';
  if (action === 'create') return 'Alta';
  if (action === 'estado') return 'Estado';
  return action || '—';
}

export default function ChangeHistoryMailbox({ catalog, onOpenSaleHistory }) {
  const [garments, setGarments] = useState([]);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [onlyWithChanges, setOnlyWithChanges] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.cambios();
      setGarments(data.garments || []);
      setSource(data.source || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    const q = filter.trim().toUpperCase();
    return (garments || []).filter((g) => {
      if (onlyWithChanges && !(g.changes || []).length) return false;
      if (!q) return true;
      const hay = `${g.referencia} ${g.referencia_ag || ''} ${g.descripcion || ''}`.toUpperCase();
      return hay.includes(q);
    });
  }, [garments, filter, onlyWithChanges]);

  const withChanges = garments.filter((g) => (g.changes || []).length > 0).length;

  return (
    <section className="panel history-page module-panel">
      <div className="module-hero">
        <div>
          <p className="module-kicker">Control de prendas</p>
          <h2>Historial de cambios</h2>
          <p className="panel-sub">
            Intercambios y ediciones por referencia. El día a día está en <strong>Ventas</strong>.
            Fuente: {source || '—'}
            {catalog?.length ? ` · catálogo ${catalog.length} refs` : ''}
            {withChanges ? ` · ${withChanges} con movimientos` : ''}
          </p>
        </div>
      </div>

      <div className="module-toolbar">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Buscar referencia o prenda…"
          aria-label="Buscar prenda"
          style={{ minWidth: '14rem' }}
        />
        <label className="check-inline">
          <input
            type="checkbox"
            checked={onlyWithChanges}
            onChange={(e) => setOnlyWithChanges(e.target.checked)}
          />
          Solo con cambios
        </label>
        <button type="button" className="btn secondary" onClick={load} disabled={loading}>
          {loading ? 'Cargando…' : 'Refrescar'}
        </button>
      </div>

      {error ? <p className="login-error">{error}</p> : null}
      {loading ? <p className="muted">Cargando historial…</p> : null}

      <div className="garment-history-list">
        {!loading && !visible.length ? (
          <p className="empty">No hay prendas que coincidan con el filtro.</p>
        ) : null}

        {visible.map((g) => (
          <article className="garment-history-section" key={g.referencia} id={`ref-${g.referencia}`}>
            <header className="garment-history-head">
              <div>
                <h3>
                  {g.referencia}
                  {g.referencia_ag && g.referencia_ag !== g.referencia ? (
                    <span className="muted"> · {g.referencia_ag}</span>
                  ) : null}
                </h3>
                {g.descripcion ? <p className="muted">{g.descripcion}</p> : null}
              </div>
              <span className={`pill-count ${(g.changes || []).length ? 'has-changes' : ''}`}>
                {(g.changes || []).length
                  ? `${g.changes.length} cambio(s)`
                  : 'Sin cambios'}
              </span>
            </header>

            {!(g.changes || []).length ? (
              <p className="muted garment-empty">Sin cambios registrados</p>
            ) : (
              <ul className="garment-change-list">
                {g.changes.map((h) => (
                  <li className="history-item history-item-full" key={`${g.referencia}-${h.id}`}>
                    <header>
                      <strong className="action-badge">{actionLabel(h.action)}</strong>
                      <span className="history-meta">
                        Venta #{h.sale_id} · {h.changed_by || '—'} ·{' '}
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
                    {onOpenSaleHistory ? (
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenSaleHistory(h.sale_id)}
                      >
                        Ver historial completo de la venta #{h.sale_id}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
