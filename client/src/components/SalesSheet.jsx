import { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../lib/api.js';
import { formatCOP, priceForTariff } from '../lib/format.js';

const ESTADOS = [
  'PENDIENTE',
  'ENTREGADO',
  'ENTREGADO 1° CORTE',
  'PAGADO',
  'PARCIAL',
  'CANCELADO',
];

const emptyForm = () => ({
  fecha_venta: new Date().toISOString().slice(0, 10),
  seller_id: '',
  vendedor_nombre: '',
  cliente: '',
  estado_pago: 'PENDIENTE',
  fecha_pago: '',
  notas: '',
  tariff: 'tienda',
  items: [{ referencia: '', descripcion: '', talla: '', cantidad: 1, precio_unitario: 0, catalog_item_id: null }],
});

export default function SalesSheet({ sellers, catalog, onOpenHistory }) {
  const [sales, setSales] = useState([]);
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [estado, setEstado] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [actionMode, setActionMode] = useState('create'); // create | edit | cambio

  const catalogByRef = useMemo(() => {
    const map = new Map();
    catalog.forEach((c) => map.set(String(c.referencia).toUpperCase(), c));
    return map;
  }, [catalog]);

  async function load() {
    setLoading(true);
    try {
      const data = await api.sales({
        from: from || undefined,
        to: to || undefined,
        seller_id: sellerId || undefined,
        estado: estado || undefined,
      });
      setSales(data.sales || []);
      setSource(data.source);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSellerChange(id) {
    const s = sellers.find((x) => String(x.id) === String(id));
    setForm((f) => ({
      ...f,
      seller_id: id,
      vendedor_nombre: s?.name || '',
    }));
  }

  function updateItem(idx, patch) {
    setForm((f) => {
      const items = f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
      return { ...f, items };
    });
  }

  function onRefBlur(idx, value) {
    const hit = catalogByRef.get(String(value).trim().toUpperCase());
    if (!hit) return;
    updateItem(idx, {
      referencia: hit.referencia,
      descripcion: hit.descripcion || hit.referencia_ag,
      catalog_item_id: hit.id || null,
      precio_unitario: priceForTariff(hit, form.tariff),
    });
  }

  function addLine() {
    setForm((f) => ({
      ...f,
      items: [
        ...f.items,
        { referencia: '', descripcion: '', talla: '', cantidad: 1, precio_unitario: 0, catalog_item_id: null },
      ],
    }));
  }

  function removeLine(idx) {
    setForm((f) => ({
      ...f,
      items: f.items.filter((_, i) => i !== idx),
    }));
  }

  function startEdit(sale, mode = 'edit') {
    setEditingId(sale.id);
    setActionMode(mode);
    setForm({
      fecha_venta: sale.fecha_venta,
      seller_id: sale.seller_id || '',
      vendedor_nombre: sale.vendedor_nombre || '',
      cliente: sale.cliente || '',
      estado_pago: sale.estado_pago || 'PENDIENTE',
      fecha_pago: sale.fecha_pago || '',
      notas: sale.notas || '',
      tariff: 'tienda',
      items: (sale.items || []).map((it) => ({
        referencia: it.referencia,
        descripcion: it.descripcion,
        talla: it.talla,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        catalog_item_id: it.catalog_item_id,
        tariff: it.tariff || 'tienda',
      })),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setEditingId(null);
    setActionMode('create');
    setForm(emptyForm());
  }

  async function submit(e) {
    e.preventDefault();
    setMessage('');
    const payload = {
      ...form,
      seller_id: form.seller_id ? Number(form.seller_id) : null,
      fecha_pago: form.fecha_pago || null,
      items: form.items
        .filter((it) => it.referencia)
        .map((it) => ({
          ...it,
          cantidad: Number(it.cantidad || 1),
          precio_unitario: Number(it.precio_unitario || 0),
          tariff: it.tariff || form.tariff,
        })),
      changed_by: form.vendedor_nombre || 'sistema',
      action: actionMode === 'cambio' ? 'cambio' : actionMode === 'edit' ? 'edit' : 'create',
      context:
        actionMode === 'cambio'
          ? 'Cambio / intercambio de prenda'
          : actionMode === 'edit'
            ? 'Edición de venta'
            : 'Venta creada',
    };
    if (!payload.items.length) {
      setMessage('Agrega al menos una prenda.');
      return;
    }
    try {
      if (editingId) {
        await api.updateSale(editingId, payload);
        setMessage(actionMode === 'cambio' ? 'Cambio registrado con historial.' : 'Venta actualizada.');
      } else {
        await api.createSale(payload);
        setMessage('Venta creada.');
      }
      resetForm();
      await load();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function changeEstado(sale, next) {
    try {
      await api.updateSale(sale.id, {
        estado_pago: next,
        action: 'estado',
        changed_by: 'sistema',
        context: `Estado de pago: ${sale.estado_pago} → ${next}`,
        // EXTENSION: Bancolombia — replace manual status with webhook sync
      });
      await load();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function runImport(dryRun) {
    setMessage(
      dryRun
        ? 'Probando qué ventas nuevas traería el Excel…'
        : 'Actualizando ventas desde Excel (sin borrar las existentes)…'
    );
    try {
      const data = await api.importSales(dryRun);
      if (dryRun) {
        setMessage(
          `Prueba: ${data.wouldImportLines}/${data.sourceRows} líneas nuevas → ` +
            `${data.wouldCreateSales} ventas; ya existentes (se omiten): ${data.skippedExisting}. ` +
            `Gaps: ${JSON.stringify(data.gapSummary || {})}` +
            (data.uniqueRefsMissing?.length
              ? `; refs fuera de catálogo: ${data.uniqueRefsMissing.join(', ')}`
              : '')
        );
      } else {
        setMessage(
          `Ventas actualizadas: ${data.importedLines} líneas en ${data.importedSales} ventas ` +
            `(omitidas: ${data.skippedExisting}; fuente ${data.source}).`
        );
        await load();
      }
    } catch (err) {
      setMessage(`Error al actualizar ventas: ${err.message}`);
    }
  }

  async function runDedupe(dryRun) {
    setMessage(
      dryRun
        ? 'Revisando ventas duplicadas…'
        : 'Quitando ventas duplicadas (se conserva la más antigua)…'
    );
    try {
      const data = await api.dedupeSales({ dryRun, vendedor: 'Alejandra' });
      if (dryRun) {
        setMessage(
          `Revisión de duplicados: ${data.duplicateGroups} grupo(s), ` +
            `quitaría ${data.wouldDelete} venta(s), conserva ids ${(data.wouldKeep || []).join(', ') || '—'}.`
        );
      } else {
        setMessage(
          `Duplicados quitados: eliminadas ${data.deleted} venta(s) en ${data.duplicateGroups} grupo(s).`
        );
        await load();
      }
    } catch (err) {
      setMessage(`Error al revisar/quitar duplicados: ${err.message}`);
    }
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(16);
    doc.text('American Grace — Inventario Ventas', 40, 40);
    doc.setFontSize(10);
    doc.text(`Filtro ${from || '…'} → ${to || '…'} · ${new Date().toLocaleString('es-CO')}`, 40, 58);

    const body = [];
    sales.forEach((s) => {
      (s.items || []).forEach((it) => {
        body.push([
          s.fecha_venta,
          s.vendedor_nombre || '',
          it.referencia || '',
          it.descripcion || '',
          it.talla || '',
          String(it.cantidad),
          s.estado_pago,
          formatCOP(it.precio_unitario),
        ]);
      });
    });

    autoTable(doc, {
      startY: 72,
      head: [['Fecha', 'Vendedor', 'Ref.', 'Descripción', 'Talla', 'Cant', 'Estado', 'Precio']],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [42, 36, 32] },
    });
    doc.save('ventas-american-grace.pdf');
  }

  return (
    <section className="panel">
      <h2>Hoja de ventas</h2>
      <p className="panel-sub">
        Crear, filtrar, editar y registrar cambios con auditoría completa. Fuente: {source || '—'}
      </p>

      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label>Fecha venta</label>
            <input
              type="date"
              value={form.fecha_venta}
              onChange={(e) => setForm({ ...form, fecha_venta: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>Vendedor</label>
            <select
              value={form.seller_id}
              onChange={(e) => onSellerChange(e.target.value)}
              required
            >
              <option value="">Seleccionar…</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Cliente</label>
            <input
              type="text"
              value={form.cliente}
              onChange={(e) => setForm({ ...form, cliente: e.target.value })}
              placeholder="Opcional"
            />
          </div>
          <div className="field">
            <label>Estado pago</label>
            <select
              value={form.estado_pago}
              onChange={(e) => setForm({ ...form, estado_pago: e.target.value })}
            >
              {ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Fecha pago</label>
            <input
              type="date"
              value={form.fecha_pago}
              onChange={(e) => setForm({ ...form, fecha_pago: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Tarifa nuevas líneas</label>
            <select
              value={form.tariff}
              onChange={(e) => setForm({ ...form, tariff: e.target.value })}
            >
              <option value="tienda">Tienda</option>
              <option value="mayorista">Mayorista</option>
              <option value="consignacion">Consignación</option>
            </select>
          </div>
        </div>

        <div className="field" style={{ marginBottom: '0.85rem' }}>
          <label>Notas</label>
          <textarea
            value={form.notas}
            onChange={(e) => setForm({ ...form, notas: e.target.value })}
            placeholder="Observaciones, entrega, cambio…"
          />
        </div>

        <div className="table-wrap" style={{ marginBottom: '0.85rem' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Referencia</th>
                <th>Descripción</th>
                <th>Talla</th>
                <th>Cant</th>
                <th>Precio</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      type="text"
                      value={it.referencia}
                      onChange={(e) => updateItem(idx, { referencia: e.target.value })}
                      onBlur={(e) => onRefBlur(idx, e.target.value)}
                      list="catalog-refs"
                      required
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={it.descripcion}
                      onChange={(e) => updateItem(idx, { descripcion: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={it.talla}
                      onChange={(e) => updateItem(idx, { talla: e.target.value })}
                      style={{ width: '5rem' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      value={it.cantidad}
                      onChange={(e) => updateItem(idx, { cantidad: e.target.value })}
                      style={{ width: '4rem' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={it.precio_unitario}
                      onChange={(e) => updateItem(idx, { precio_unitario: e.target.value })}
                      style={{ width: '7rem' }}
                    />
                  </td>
                  <td>
                    <button type="button" className="btn ghost" onClick={() => removeLine(idx)}>
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <datalist id="catalog-refs">
          {catalog.map((c) => (
            <option key={c.referencia} value={c.referencia}>
              {c.referencia_ag}
            </option>
          ))}
        </datalist>

        <div className="toolbar">
          <button type="button" className="btn secondary" onClick={addLine}>
            + Prenda
          </button>
          <button type="submit" className="btn">
            {actionMode === 'cambio'
              ? 'Guardar cambio'
              : editingId
                ? 'Guardar edición'
                : 'Registrar venta'}
          </button>
          {editingId ? (
            <button type="button" className="btn ghost" onClick={resetForm}>
              Cancelar
            </button>
          ) : null}
        </div>
      </form>

      {message ? <p className="muted">{message}</p> : null}

      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '1.25rem 0' }} />

      <div className="toolbar">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
        <select value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
          <option value="">Todos los vendedores</option>
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <button type="button" className="btn secondary" onClick={load} disabled={loading}>
          {loading ? 'Cargando…' : 'Filtrar'}
        </button>
        <button type="button" className="btn" onClick={exportPdf}>
          PDF
        </button>
        <a className="btn ghost" href={api.exportSalesXlsxUrl({ from, to, seller_id: sellerId })}>
          XLSX
        </a>
        <button
          type="button"
          className="btn ghost"
          onClick={() => runImport(true)}
          title="Simula traer ventas nuevas del Excel/Sheet a la app, sin guardar cambios"
        >
          Probar actualización
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => runImport(false)}
          title="Cuando agregas ventas en el Sheet/Excel y quieres verlas en la app (no borra las ya cargadas)"
        >
          Actualizar ventas desde Excel
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => runDedupe(true)}
          title="Muestra grupos de ventas gemelas sin borrar nada"
        >
          Revisar duplicados
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => runDedupe(false)}
          title="Elimina ventas duplicadas verdaderas; conserva la más antigua"
        >
          Quitar ventas duplicadas
        </button>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Vendedor</th>
              <th>Cliente</th>
              <th>Prendas</th>
              <th>Total</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id}>
                <td>{s.fecha_venta}</td>
                <td>{s.vendedor_nombre}</td>
                <td>{s.cliente || '—'}</td>
                <td>
                  {(s.items || []).map((it, i) => (
                    <div key={i}>
                      {it.referencia} · {it.talla} ×{it.cantidad}
                    </div>
                  ))}
                </td>
                <td>{formatCOP(s.total)}</td>
                <td>
                  <select
                    value={s.estado_pago}
                    onChange={(e) => changeEstado(s, e.target.value)}
                    title="Cambio manual de estado (extensión Bancolombia pendiente)"
                  >
                    {ESTADOS.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  <button type="button" className="btn ghost" onClick={() => startEdit(s, 'edit')}>
                    Editar
                  </button>
                  <button type="button" className="btn secondary" onClick={() => startEdit(s, 'cambio')}>
                    Cambio
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => onOpenHistory?.(s.id)}
                  >
                    Historial
                  </button>
                </td>
              </tr>
            ))}
            {!sales.length ? (
              <tr>
                <td colSpan={7} className="empty">
                  Sin ventas en este filtro
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
