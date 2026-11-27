import { formatCOP, tariffLabel } from '../lib/format.js';

function Field({ label, value }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="snap-field">
      <span className="snap-field-label">{label}</span>
      <span className="snap-field-value">{value}</span>
    </div>
  );
}

function ItemCard({ item }) {
  const talla = String(item.talla || '').trim() || '—';
  return (
    <div className="snap-item">
      <div className="snap-item-ref">{item.referencia || '?'}</div>
      {item.descripcion ? <div className="snap-item-desc">{item.descripcion}</div> : null}
      <div className="snap-item-meta">
        <span className="snap-talla">
          Talla <strong>{talla}</strong>
        </span>
        <span>×{item.cantidad || 1}</span>
        <span>{formatCOP(item.precio_unitario)}</span>
        {item.tariff ? <span className="snap-tariff">{tariffLabel(item.tariff)}</span> : null}
      </div>
    </div>
  );
}

/** Pretty before/after snapshot — no raw JSON. */
export default function SaleSnapshotCards({ data, title, tone = 'neutral' }) {
  if (!data) {
    return (
      <div className={`snap-card snap-${tone}`}>
        {title ? <h4>{title}</h4> : null}
        <p className="muted">Sin datos</p>
      </div>
    );
  }

  const items = data.items || data.sale_items || [];
  const fecha = data.fecha_venta
    ? String(data.fecha_venta).slice(0, 10)
    : null;

  return (
    <div className={`snap-card snap-${tone}`}>
      {title ? <h4>{title}</h4> : null}
      <div className="snap-fields">
        <Field label="Fecha" value={fecha} />
        <Field label="Vendedor" value={data.vendedor_nombre} />
        <Field label="Cliente" value={data.cliente} />
        <Field label="Estado" value={data.estado_pago} />
        {data.fecha_pago ? (
          <Field label="Fecha pago" value={String(data.fecha_pago).slice(0, 10)} />
        ) : null}
        <Field label="Total" value={formatCOP(data.total)} />
        <Field label="Notas" value={data.notas} />
      </div>
      <div className="snap-items">
        <span className="snap-items-label">Prendas</span>
        {!items.length ? (
          <p className="muted" style={{ margin: 0 }}>
            Sin prendas
          </p>
        ) : (
          items.map((it, i) => <ItemCard key={i} item={it} />)
        )}
      </div>
    </div>
  );
}
