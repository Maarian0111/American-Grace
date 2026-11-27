import { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../lib/api.js';
import { formatCOP, priceForTariff, TARIFF_OPTIONS, tariffLabel } from '../lib/format.js';

const ESTADOS = [
  'PENDIENTE',
  'ENTREGADO',
  'ENTREGADO 1° CORTE',
  'PAGADO',
  'PARCIAL',
  'CANCELADO',
];

function emptyLine(tariff = 'tienda') {
  return {
    referencia: '',
    descripcion: '',
    talla: '',
    cantidad: 1,
    precio_unitario: 0,
    catalog_item_id: null,
    tariff,
  };
}

const emptyForm = () => ({
  fecha_venta: new Date().toISOString().slice(0, 10),
  seller_id: '',
  vendedor_nombre: '',
  cliente: '',
  estado_pago: 'PENDIENTE',
  fecha_pago: '',
  notas: '',
  defaultTariff: 'tienda',
  items: [emptyLine('tienda')],
});

function formatTalla(talla) {
  const t = String(talla || '').trim();
  return t || '—';
}

function tallasList(catalogItem) {
  if (!catalogItem?.tallas) return [];
  return String(catalogItem.tallas)
    .split(/[,;/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function SalesSheet({
  sellers,
  catalog,
  onOpenHistory,
  onOpenCambios,
  onOpenGarmentMailbox,
  cambioLaunch,
  onCambioLaunchConsumed,
}) {
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
  const [dupeGroups, setDupeGroups] = useState(null);
  const [dupeLoading, setDupeLoading] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [focusReferencia, setFocusReferencia] = useState(null);

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
      setMessage(`Lista actualizada desde la base de datos (${(data.sales || []).length} venta(s)).`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().then(() => setMessage(''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Deep-link from Historial: open the sale in Cambio mode with garment preselected. */
  useEffect(() => {
    if (!cambioLaunch?.nonce) return;
    let cancelled = false;
    (async () => {
      try {
        let sale = cambioLaunch.sale || null;
        if (!sale && cambioLaunch.saleId) {
          const data = await api.sale(cambioLaunch.saleId);
          sale = data.sale;
        }
        if (cancelled || !sale) return;
        startEdit(sale, 'cambio');
        setFocusReferencia(cambioLaunch.referencia || null);
        setMessage(
          `Cambio desde buzón de ${cambioLaunch.referencia || 'prenda'} · venta #${sale.id}. ` +
            'Ajusta la prenda de reemplazo (incluye talla) y guarda.'
        );
      } catch (err) {
        if (!cancelled) setMessage(err.message);
      } finally {
        onCambioLaunchConsumed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cambioLaunch?.nonce]);

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

  /** Fill description + price from catalog for the line's tariff (price still overridable). */
  function applyCatalogToLine(idx, referencia, tariff) {
    const hit = catalogByRef.get(String(referencia || '').trim().toUpperCase());
    if (!hit) return;
    updateItem(idx, {
      referencia: hit.referencia,
      descripcion: hit.descripcion || hit.referencia_ag,
      catalog_item_id: hit.id || null,
      tariff: tariff || 'tienda',
      precio_unitario: priceForTariff(hit, tariff || 'tienda'),
    });
  }

  function onRefBlur(idx, value) {
    const line = form.items[idx];
    applyCatalogToLine(idx, value, line?.tariff || form.defaultTariff);
  }

  function onLineTariffChange(idx, tariff) {
    const line = form.items[idx];
    const hit = catalogByRef.get(String(line.referencia || '').trim().toUpperCase());
    if (hit) {
      updateItem(idx, {
        tariff,
        precio_unitario: priceForTariff(hit, tariff),
      });
    } else {
      updateItem(idx, { tariff });
    }
  }

  function addLine() {
    setForm((f) => ({
      ...f,
      items: [...f.items, emptyLine(f.defaultTariff)],
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
      defaultTariff: 'tienda',
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
    setFocusReferencia(null);
    setForm(emptyForm());
  }

  async function submit(e) {
    e.preventDefault();
    setMessage('');
    const cliente = String(form.cliente || '').trim();
    if (!cliente) {
      setMessage('El nombre del cliente es obligatorio.');
      return;
    }
    const lines = form.items.filter((it) => it.referencia);
    if (!lines.length) {
      setMessage('Agrega al menos una prenda.');
      return;
    }
    const missingTalla = lines.find((it) => !String(it.talla || '').trim());
    if (missingTalla) {
      setMessage(
        `Indica la talla de cada prenda (falta en ${missingTalla.referencia}).`
      );
      return;
    }
    const payload = {
      ...form,
      cliente,
      seller_id: form.seller_id ? Number(form.seller_id) : null,
      fecha_pago: form.fecha_pago || null,
      items: lines.map((it) => ({
        ...it,
        talla: String(it.talla || '').trim(),
        cantidad: Number(it.cantidad || 1),
        precio_unitario: Number(it.precio_unitario || 0),
        tariff: it.tariff || form.defaultTariff || 'tienda',
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
    try {
      if (editingId) {
        await api.updateSale(editingId, payload);
        setMessage(
          actionMode === 'cambio'
            ? 'Cambio registrado (no pendiente). Revisa el buzón de la prenda en Historial de cambios.'
            : 'Venta actualizada.'
        );
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

  async function runImport() {
    setMessage('Actualizando ventas desde Excel (sin borrar las existentes)…');
    try {
      const data = await api.importSales(false);
      setMessage(
        `Ventas actualizadas: ${data.importedLines} líneas en ${data.importedSales} ventas ` +
          `(omitidas: ${data.skippedExisting}; fuente ${data.source}).`
      );
      await load();
    } catch (err) {
      setMessage(`Error al actualizar ventas: ${err.message}`);
    }
  }

  async function reviewDuplicates() {
    setDupeLoading(true);
    setMessage('Buscando posibles duplicados…');
    try {
      const data = await api.dedupeSales({ dryRun: true });
      setDupeGroups(data.groups || []);
      setMessage(
        data.duplicateGroups
          ? `Posibles duplicados: ${data.duplicateGroups} grupo(s). Misma fecha/vendedor/cliente/prendas — revisa cada fila.`
          : 'No se encontraron posibles duplicados.'
      );
    } catch (err) {
      setMessage(`Error al revisar duplicados: ${err.message}`);
      setDupeGroups(null);
    } finally {
      setDupeLoading(false);
    }
  }

  async function removeDuplicateSale(saleId) {
    if (!window.confirm(`¿Quitar la venta #${saleId}? Esta acción no se puede deshacer.`)) return;
    setRemovingId(saleId);
    try {
      await api.deleteSale(saleId);
      setDupeGroups((groups) =>
        (groups || [])
          .map((g) => ({
            ...g,
            sales: (g.sales || []).filter((s) => s.id !== saleId),
            deleteIds: (g.deleteIds || []).filter((id) => id !== saleId),
            keepId: g.keepId === saleId ? (g.sales || []).find((s) => s.id !== saleId)?.id : g.keepId,
          }))
          .filter((g) => (g.sales || []).length > 1)
      );
      setMessage(`Venta #${saleId} quitada. Pulsa Refrescar lista para confirmar la hoja.`);
    } catch (err) {
      setMessage(`Error al quitar venta: ${err.message}`);
    } finally {
      setRemovingId(null);
    }
  }

  function dismissDupeReview() {
    setDupeGroups(null);
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
          s.cliente || '',
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
      head: [['Fecha', 'Vendedor', 'Cliente', 'Ref.', 'Descripción', 'Talla', 'Cant', 'Estado', 'Precio']],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [42, 36, 32] },
    });
    doc.save('ventas-american-grace.pdf');
  }

  const formTitle =
    actionMode === 'cambio'
      ? 'Registrar cambio de prenda'
      : editingId
        ? 'Editar venta'
        : 'Nueva venta';

  return (
    <section className="panel module-panel">
      <div className="module-hero">
        <div>
          <p className="module-kicker">Recepción</p>
          <h2>Ventas</h2>
          <p className="panel-sub">
            Día a día: crear, filtrar, editar. Usa <strong>Cambio</strong> para iniciar un
            intercambio (incluye talla original y de reemplazo). El buzón y control por prenda
            están en <strong>Historial de cambios</strong>. Fuente: {source || '—'}
          </p>
        </div>
      </div>

      <div className={`sales-compose${actionMode === 'cambio' ? ' sales-compose-cambio' : ''}`}>
        <div className="sales-compose-head">
          <h3>{formTitle}</h3>
          <p className="muted sales-compose-hint">
            {actionMode === 'cambio'
              ? 'Reemplaza la prenda en las líneas (referencia + talla de la original y del reemplazo). Al guardar queda registrado en el buzón de esa prenda — no es una revisión pendiente.'
              : 'Elige referencia + tarifa (Tienda / Mayorista −30% / Consignación −15%) — el precio se llena solo y puedes ajustarlo a mano. Indica siempre la talla.'}
          </p>
        </div>

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
              <label>
                Cliente <span className="req-mark">*</span>
              </label>
              <input
                type="text"
                value={form.cliente}
                onChange={(e) => setForm({ ...form, cliente: e.target.value })}
                placeholder="Nombre del cliente"
                required
                autoComplete="name"
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
              <label>Tarifa por defecto</label>
              <select
                value={form.defaultTariff}
                onChange={(e) => setForm({ ...form, defaultTariff: e.target.value })}
                title="Se aplica a líneas nuevas; cada línea puede cambiar su tarifa"
              >
                {TARIFF_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="field-hint">Solo para líneas nuevas</span>
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

          <div className="lines-block">
            <div className="lines-block-head">
              <h4>Líneas de prenda</h4>
              <span className="muted">Referencia + tarifa → precio automático</span>
            </div>
            <div className="table-wrap" style={{ marginBottom: '0.85rem' }}>
              <table className="data lines-table">
                <thead>
                  <tr>
                    <th>Referencia</th>
                    <th>Descripción</th>
                    <th>Talla</th>
                    <th>Cant</th>
                    <th>Tarifa</th>
                    <th>Precio</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((it, idx) => {
                    const refKey = String(it.referencia || '')
                      .trim()
                      .toUpperCase();
                    const sizeOpts = tallasList(catalogByRef.get(refKey));
                    const isFocus =
                      focusReferencia && refKey === String(focusReferencia).toUpperCase();
                    return (
                    <tr key={idx} className={isFocus ? 'row-focus-garment' : ''}>
                      <td>
                        <input
                          type="text"
                          value={it.referencia}
                          onChange={(e) => updateItem(idx, { referencia: e.target.value })}
                          onBlur={(e) => onRefBlur(idx, e.target.value)}
                          list="catalog-refs"
                          required
                          placeholder="Ref."
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={it.descripcion}
                          onChange={(e) => updateItem(idx, { descripcion: e.target.value })}
                          placeholder="Descripción"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={it.talla}
                          onChange={(e) => updateItem(idx, { talla: e.target.value })}
                          style={{ width: '5.5rem' }}
                          placeholder="Talla"
                          list={sizeOpts.length ? `tallas-line-${idx}` : undefined}
                          required
                          aria-label={`Talla línea ${idx + 1}`}
                          title={
                            sizeOpts.length
                              ? `Tallas disponibles: ${sizeOpts.join(', ')}`
                              : 'Indica la talla'
                          }
                        />
                        {sizeOpts.length ? (
                          <datalist id={`tallas-line-${idx}`}>
                            {sizeOpts.map((sz) => (
                              <option key={sz} value={sz} />
                            ))}
                          </datalist>
                        ) : null}
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
                        <select
                          value={it.tariff || form.defaultTariff}
                          onChange={(e) => onLineTariffChange(idx, e.target.value)}
                          aria-label={`Tarifa línea ${idx + 1}`}
                          className="tariff-select"
                        >
                          {TARIFF_OPTIONS.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={it.precio_unitario}
                          onChange={(e) => updateItem(idx, { precio_unitario: e.target.value })}
                          style={{ width: '7rem' }}
                          title="Puedes ajustar el precio a mano"
                        />
                      </td>
                      <td>
                        <button type="button" className="btn ghost" onClick={() => removeLine(idx)}>
                          Quitar
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
      </div>

      {message ? <p className="status-banner">{message}</p> : null}

      <div className="sales-list-section">
        <div className="sales-list-head">
          <h3>Lista de ventas</h3>
          <p className="toolbar-hint">
            <strong>Refrescar lista</strong> recarga desde la base (no Excel).{' '}
            <strong>Actualizar desde Excel</strong> trae líneas nuevas.{' '}
            <strong>Revisar duplicados</strong> agrupa por fecha + vendedor + cliente + prendas —
            tú eliges cuál quitar.
          </p>
        </div>

        <div className="module-toolbar filters-row">
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
        </div>

        <div className="module-toolbar actions-row">
          <button
            type="button"
            className="btn secondary"
            onClick={load}
            disabled={loading}
            title="Recarga la lista de ventas desde la base de datos"
          >
            {loading ? 'Cargando…' : 'Refrescar lista'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={runImport}
            title="Trae ventas nuevas del Sheet/Excel a la app (no borra las ya cargadas)"
          >
            Actualizar ventas desde Excel
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={reviewDuplicates}
            disabled={dupeLoading}
            title="Muestra posibles ventas duplicadas para que tú elijas cuáles quitar"
          >
            {dupeLoading ? 'Revisando…' : 'Revisar duplicados'}
          </button>
          {onOpenCambios ? (
            <button type="button" className="btn ghost" onClick={onOpenCambios}>
              Ir a Historial de cambios
            </button>
          ) : null}
        </div>

        {dupeGroups ? (
          <div className="dupe-review">
            <div className="dupe-review-head">
              <h3>Revisión de duplicados</h3>
              <button type="button" className="btn ghost" onClick={dismissDupeReview}>
                Cerrar revisión
              </button>
            </div>
            <p className="muted">
              Agrupa ventas con misma fecha, vendedor, <strong>cliente</strong> y prendas/precio.
              Clientes distintos no aparecen juntos. Quita solo la fila que sobra; luego{' '}
              <strong>Refrescar lista</strong>.
            </p>
            {!dupeGroups.length ? (
              <p className="empty">Sin grupos duplicados para revisar.</p>
            ) : (
              dupeGroups.map((g, gi) => (
                <div className="dupe-group" key={g.fingerprint || gi}>
                  <h4>
                    Grupo {gi + 1} · {(g.sales || []).length} ventas parecidas
                    {g.sales?.[0]?.cliente ? ` · ${g.sales[0].cliente}` : ''}
                  </h4>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Id</th>
                          <th>Fecha</th>
                          <th>Vendedor</th>
                          <th>Cliente</th>
                          <th>Prendas</th>
                          <th>Total</th>
                          <th>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(g.sales || []).map((s) => (
                          <tr key={s.id}>
                            <td>#{s.id}</td>
                            <td>{s.fecha_venta}</td>
                            <td>{s.vendedor_nombre || '—'}</td>
                            <td>
                              <strong>{s.cliente || '—'}</strong>
                            </td>
                            <td>
                              {(s.items || []).length
                                ? (s.items || []).map((it, i) => (
                                    <div key={i}>
                                      {it.referencia} · {it.talla || '—'} ×{it.cantidad}{' '}
                                      {formatCOP(it.precio_unitario)}
                                      {it.tariff ? ` · ${tariffLabel(it.tariff)}` : ''}
                                    </div>
                                  ))
                                : `${s.itemCount || 0} ítem(s)`}
                            </td>
                            <td>{formatCOP(s.total)}</td>
                            <td>
                              <button
                                type="button"
                                className="btn ghost"
                                disabled={removingId === s.id}
                                onClick={() => removeDuplicateSale(s.id)}
                              >
                                {removingId === s.id ? 'Quitando…' : 'Quitar'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Vendedor</th>
                <th>Cliente</th>
                <th>Prendas</th>
                <th>Talla</th>
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
                        {it.referencia}
                        {it.descripcion ? (
                          <span className="muted"> · {it.descripcion}</span>
                        ) : null}
                        <span className="muted"> ×{it.cantidad}</span>
                        {it.tariff && it.tariff !== 'tienda' ? (
                          <span className="line-tariff-tag"> · {tariffLabel(it.tariff)}</span>
                        ) : null}
                      </div>
                    ))}
                  </td>
                  <td>
                    {(s.items || []).map((it, i) => (
                      <div key={i}>
                        <strong>{formatTalla(it.talla)}</strong>
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
                  <td className="row-actions">
                    <button type="button" className="btn ghost" onClick={() => startEdit(s, 'edit')}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        startEdit(s, 'cambio');
                        setFocusReferencia(
                          s.items?.[0]?.referencia
                            ? String(s.items[0].referencia).toUpperCase()
                            : null
                        );
                        setMessage(
                          'Modo Cambio: ajusta referencia y talla de la prenda de reemplazo, luego Guarda cambio.'
                        );
                      }}
                      title="Inicia el cambio de prenda sobre esta venta"
                    >
                      Cambio
                    </button>
                    {onOpenGarmentMailbox && s.items?.[0]?.referencia ? (
                      <button
                        type="button"
                        className="linkish"
                        onClick={() =>
                          onOpenGarmentMailbox(s.items[0].referencia, s.id)
                        }
                        title="Abrir buzón de la prenda en Historial"
                      >
                        Buzón prenda
                      </button>
                    ) : null}
                    {onOpenHistory ? (
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenHistory(s.id)}
                        title="Detalle de esta venta"
                      >
                        Ver detalle
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!sales.length ? (
                <tr>
                  <td colSpan={8} className="empty">
                    Sin ventas en este filtro
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
