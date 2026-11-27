import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatCOP } from '../lib/format.js';

function summarizeSale(data) {
  if (!data) return '—';
  const items = data.items || data.sale_items || [];
  const lines = items
    .map(
      (it) =>
        `${it.referencia || '?'} · ${it.talla || '—'} ×${it.cantidad || 1} @ ${formatCOP(
          it.precio_unitario
        )}`
    )
    .join('\n');
  return [
    `Fecha: ${data.fecha_venta || '—'}`,
    `Vendedor: ${data.vendedor_nombre || '—'}`,
    `Cliente: ${data.cliente || '—'}`,
    `Estado: ${data.estado_pago || '—'}`,
    `Total: ${formatCOP(data.total)}`,
    data.notas ? `Notas: ${data.notas}` : null,
    lines ? `Prendas:\n${lines}` : 'Sin prendas',
  ]
    .filter(Boolean)
    .join('\n');
}

export default function SaleHistoryView({ saleId, onBack }) {
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
    <section className="panel history-page">
      <div className="history-page-head">
        <button type="button" className="btn ghost" onClick={onBack}>
          ← Volver a ventas
        </button>
        <div>
          <h2>Historial de venta #{saleId}</h2>
          <p className="panel-sub">
            Vista dedicada con detalle completo antes / después de cada cambio.
            El botón <strong>Cambio</strong> sigue en la hoja de ventas.
          </p>
        </div>
      </div>

      {loading ? <p className="muted">Cargando…</p> : null}
      {error ? <p className="login-error">{error}</p> : null}

      {sale ? (
        <div className="history-summary">
          <h3>Estado actual</h3>
          <pre>{summarizeSale(sale)}</pre>
        </div>
      ) : null}

      <div className="history-list">
        {!loading && !history.length ? (
          <p className="muted">Sin registros de cambio para esta venta.</p>
        ) : null}
        {history.map((h) => (
          <article className="history-item history-item-full" key={h.id}>
            <header>
              <strong>{h.action}</strong>
              <span>
                {h.changed_by || '—'} ·{' '}
                {h.created_at
                  ? new Date(h.created_at).toLocaleString('es-CO', {
                      timeZone: 'America/Bogota',
                    })
                  : ''}
              </span>
            </header>
            {h.context ? <p className="muted">{h.context}</p> : null}
            <div className="before-after">
              <div>
                <h4>Antes</h4>
                <pre>{summarizeSale(h.before_data)}</pre>
                <details>
                  <summary>JSON completo</summary>
                  <pre>{JSON.stringify(h.before_data, null, 2)}</pre>
                </details>
              </div>
              <div>
                <h4>Después</h4>
                <pre>{summarizeSale(h.after_data)}</pre>
                <details>
                  <summary>JSON completo</summary>
                  <pre>{JSON.stringify(h.after_data, null, 2)}</pre>
                </details>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
