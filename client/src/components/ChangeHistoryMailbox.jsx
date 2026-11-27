import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { formatCOP, tariffLabel } from '../lib/format.js';
import SaleSnapshotCards from './SaleSnapshotCards.jsx';

function actionLabel(action, role) {
  if (action === 'cambio') {
    if (role === 'salió') return 'Cambio · salió';
    if (role === 'entró') return 'Cambio · entró';
    if (role === 'permaneció') return 'Cambio · misma ref';
    return 'Cambio';
  }
  if (action === 'edit') return 'Edición';
  if (action === 'create') return 'Alta';
  if (action === 'estado') return 'Estado';
  return action || '—';
}

function formatTalla(talla) {
  const t = String(talla || '').trim();
  return t || '—';
}

function LineTallas({ before, after }) {
  if (!before && !after) return null;
  return (
    <p className="mailbox-talla-pair">
      <span>
        Talla original: <strong>{formatTalla(before?.talla)}</strong>
        {before?.referencia ? ` (${before.referencia})` : ''}
      </span>
      <span aria-hidden="true">→</span>
      <span>
        Talla reemplazo: <strong>{formatTalla(after?.talla)}</strong>
        {after?.referencia ? ` (${after.referencia})` : ''}
      </span>
    </p>
  );
}

/**
 * Historial = buzón por prenda.
 * Each garment module lists associated sales (pick which sale to apply a cambio),
 * then the registered change history for that ref.
 */
export default function ChangeHistoryMailbox({
  catalog,
  onOpenSaleHistory,
  onStartCambio,
  focusRef,
  focusSaleId,
}) {
  const [garments, setGarments] = useState([]);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState(focusRef || '');
  const [onlyWithSales, setOnlyWithSales] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set(focusRef ? [String(focusRef).toUpperCase()] : []));
  const [selectedSaleByRef, setSelectedSaleByRef] = useState(() => {
    if (focusRef && focusSaleId) {
      return { [String(focusRef).toUpperCase()]: Number(focusSaleId) };
    }
    return {};
  });

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

  useEffect(() => {
    if (!focusRef) return;
    const ref = String(focusRef).toUpperCase();
    setFilter(ref);
    setExpanded((prev) => new Set([...prev, ref]));
    if (focusSaleId) {
      setSelectedSaleByRef((prev) => ({ ...prev, [ref]: Number(focusSaleId) }));
    }
  }, [focusRef, focusSaleId]);

  const visible = useMemo(() => {
    const q = filter.trim().toUpperCase();
    return (garments || []).filter((g) => {
      if (onlyWithSales && !(g.sales || []).length && !(g.changes || []).length) return false;
      if (!q) return true;
      const hay = `${g.referencia} ${g.referencia_ag || ''} ${g.descripcion || ''}`.toUpperCase();
      return hay.includes(q);
    });
  }, [garments, filter, onlyWithSales]);

  const withSales = garments.filter((g) => (g.sales || []).length > 0).length;
  const withChanges = garments.filter((g) => (g.changes || []).length > 0).length;

  function toggleExpand(ref) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }

  function selectSale(ref, saleId) {
    setSelectedSaleByRef((prev) => ({ ...prev, [ref]: saleId }));
  }

  function startCambioFor(g, sale) {
    if (!onStartCambio || !sale) return;
    onStartCambio({
      saleId: sale.id,
      referencia: g.referencia,
      sale: {
        id: sale.id,
        fecha_venta: sale.fecha_venta,
        seller_id: sale.seller_id,
        vendedor_nombre: sale.vendedor_nombre,
        cliente: sale.cliente,
        estado_pago: sale.estado_pago,
        fecha_pago: sale.fecha_pago,
        notas: sale.notas,
        total: sale.total,
        items: sale.items || [],
      },
    });
  }

  return (
    <section className="panel history-page module-panel">
      <div className="module-hero">
        <div>
          <p className="module-kicker">Buzón por prenda</p>
          <h2>Historial de cambios</h2>
          <p className="panel-sub">
            Cada prenda es un módulo: elige la <strong>venta asociada</strong> para aplicar un
            cambio, y revisa el <strong>historial registrado</strong> de esa ref. Para crear el
            cambio desde el día a día usa <strong>Ventas → Cambio</strong>. Fuente: {source || '—'}
            {catalog?.length ? ` · catálogo ${catalog.length} refs` : ''}
            {withSales ? ` · ${withSales} con ventas` : ''}
            {withChanges ? ` · ${withChanges} con historial` : ''}
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
            checked={onlyWithSales}
            onChange={(e) => setOnlyWithSales(e.target.checked)}
          />
          Solo con ventas o historial
        </label>
        <button type="button" className="btn secondary" onClick={load} disabled={loading}>
          {loading ? 'Cargando…' : 'Refrescar'}
        </button>
      </div>

      {error ? <p className="login-error">{error}</p> : null}
      {loading ? <p className="muted">Cargando buzón…</p> : null}

      <div className="garment-history-list">
        {!loading && !visible.length ? (
          <p className="empty">No hay prendas que coincidan con el filtro.</p>
        ) : null}

        {visible.map((g) => {
          const open = expanded.has(g.referencia);
          const selectedId = selectedSaleByRef[g.referencia];
          const selectedSale =
            (g.sales || []).find((s) => s.id === selectedId) || (g.sales || [])[0] || null;

          return (
            <article
              className={`garment-history-section${focusRef && String(focusRef).toUpperCase() === g.referencia ? ' garment-focus' : ''}`}
              key={g.referencia}
              id={`ref-${g.referencia}`}
            >
              <header className="garment-history-head">
                <div>
                  <h3>
                    <button
                      type="button"
                      className="garment-expand"
                      onClick={() => toggleExpand(g.referencia)}
                      aria-expanded={open}
                    >
                      <span className="garment-expand-icon" aria-hidden="true">
                        {open ? '▾' : '▸'}
                      </span>
                      {g.referencia}
                      {g.referencia_ag && g.referencia_ag !== g.referencia ? (
                        <span className="muted"> · {g.referencia_ag}</span>
                      ) : null}
                    </button>
                  </h3>
                  {g.descripcion ? <p className="muted">{g.descripcion}</p> : null}
                  {g.tallas ? (
                    <p className="muted garment-tallas-avail">Tallas catálogo: {g.tallas}</p>
                  ) : null}
                </div>
                <div className="garment-pills">
                  <span className={`pill-count ${(g.sales || []).length ? 'has-sales' : ''}`}>
                    {(g.sales || []).length
                      ? `${g.sales.length} venta(s)`
                      : 'Sin ventas'}
                  </span>
                  <span className={`pill-count ${(g.changes || []).length ? 'has-changes' : ''}`}>
                    {(g.changes || []).length
                      ? `${g.changes.length} registrado(s)`
                      : 'Sin historial'}
                  </span>
                </div>
              </header>

              {open ? (
                <div className="garment-mailbox-body">
                  <section className="mailbox-block">
                    <h4>Ventas asociadas</h4>
                    <p className="muted mailbox-hint">
                      Elige la venta a la que aplicarás el cambio de esta prenda.
                    </p>
                    {!(g.sales || []).length ? (
                      <p className="muted garment-empty">Ninguna venta incluye esta referencia.</p>
                    ) : (
                      <div className="table-wrap">
                        <table className="data mailbox-sales">
                          <thead>
                            <tr>
                              <th></th>
                              <th>Venta</th>
                              <th>Fecha</th>
                              <th>Cliente</th>
                              <th>Talla</th>
                              <th>Cant</th>
                              <th>Precio</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {(g.sales || []).map((s) => {
                              const checked = selectedSale?.id === s.id;
                              return (
                                <tr key={s.id} className={checked ? 'row-selected' : ''}>
                                  <td>
                                    <input
                                      type="radio"
                                      name={`sale-${g.referencia}`}
                                      checked={checked}
                                      onChange={() => selectSale(g.referencia, s.id)}
                                      aria-label={`Elegir venta #${s.id}`}
                                    />
                                  </td>
                                  <td>#{s.id}</td>
                                  <td>{s.fecha_venta}</td>
                                  <td>{s.cliente || '—'}</td>
                                  <td>
                                    <strong>{formatTalla(s.line?.talla)}</strong>
                                  </td>
                                  <td>×{s.line?.cantidad || 1}</td>
                                  <td>
                                    {formatCOP(s.line?.precio_unitario)}
                                    {s.line?.tariff && s.line.tariff !== 'tienda' ? (
                                      <span className="line-tariff-tag">
                                        {' '}
                                        · {tariffLabel(s.line.tariff)}
                                      </span>
                                    ) : null}
                                  </td>
                                  <td className="row-actions">
                                    <button
                                      type="button"
                                      className="btn secondary"
                                      onClick={() => startCambioFor(g, s)}
                                      disabled={!onStartCambio}
                                    >
                                      Aplicar cambio
                                    </button>
                                    {onOpenSaleHistory ? (
                                      <button
                                        type="button"
                                        className="linkish"
                                        onClick={() => onOpenSaleHistory(s.id)}
                                      >
                                        Detalle
                                      </button>
                                    ) : null}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {selectedSale && onStartCambio ? (
                      <div className="mailbox-selected-bar">
                        <span>
                          Venta seleccionada <strong>#{selectedSale.id}</strong> · talla{' '}
                          <strong>{formatTalla(selectedSale.line?.talla)}</strong>
                        </span>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => startCambioFor(g, selectedSale)}
                        >
                          Registrar cambio en venta #{selectedSale.id}
                        </button>
                      </div>
                    ) : null}
                  </section>

                  <section className="mailbox-block">
                    <h4>Historial registrado</h4>
                    <p className="muted mailbox-hint">
                      Cambios ya guardados para esta prenda (no son pendientes).
                    </p>
                    {!(g.changes || []).length ? (
                      <p className="muted garment-empty">Sin cambios registrados</p>
                    ) : (
                      <ul className="garment-change-list">
                        {g.changes.map((h) => (
                          <li className="history-item history-item-full" key={`${g.referencia}-${h.id}`}>
                            <header>
                              <strong
                                className={`action-badge role-${
                                  h.role === 'salió'
                                    ? 'salio'
                                    : h.role === 'entró'
                                      ? 'entro'
                                      : h.role || 'edit'
                                }`}
                              >
                                {actionLabel(h.action, h.role)}
                              </strong>
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
                            <LineTallas before={h.before_line} after={h.after_line} />
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
                  </section>
                </div>
              ) : (
                <p className="muted garment-collapsed-hint">
                  {(g.sales || []).length
                    ? `${g.sales.length} venta(s) asociada(s)`
                    : 'Sin ventas'}
                  {' · '}
                  {(g.changes || []).length
                    ? `${g.changes.length} cambio(s) registrado(s)`
                    : 'Sin historial'}
                  {' — '}
                  <button type="button" className="linkish" onClick={() => toggleExpand(g.referencia)}>
                    Abrir módulo
                  </button>
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
