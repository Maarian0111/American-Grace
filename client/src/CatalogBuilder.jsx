import { useDeferredValue, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import GarmentForm from './components/GarmentForm.jsx';
import { api } from './lib/api.js';
import { formatCOP, priceForTariff } from './lib/format.js';

const CATEGORIES = ['Todas', 'Niña', 'Niño/Unisex', 'Accesorios'];
const GENEROS = ['Niña', 'Niño/Unisex', 'Accesorios'];
const TARIFFS = [
  { id: 'tienda', label: 'Tienda' },
  { id: 'mayorista', label: 'Mayorista' },
  { id: 'consignacion', label: 'Consignación' },
];

async function loadImageDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function pageFileFor(entry, pageNum) {
  if (entry?.file) return entry.file;
  const nn = String(pageNum).padStart(2, '0');
  return `page-${nn}.png`;
}

export default function CatalogBuilder({
  items,
  source,
  onSync,
  onMoveGenero,
  onCatalogChanged,
  syncing,
}) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [category, setCategory] = useState('Todas');
  const [selected, setSelected] = useState(() => new Set());
  const [tariff, setTariff] = useState('tienda');
  const [message, setMessage] = useState('');
  const [exporting, setExporting] = useState(false);
  const [movingId, setMovingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formBusy, setFormBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'Todas' && item.genero !== category) return false;
      if (!q) return true;
      const hay = [
        item.referencia,
        item.referencia_ag,
        item.descripcion,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [items, deferredQuery, category]);

  const withPhotos = items.filter((i) => i.image_url).length;

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((i) => selected.has(i.id ?? i.referencia));

  function keyOf(item) {
    return item.id ?? item.referencia;
  }

  function toggleOne(item) {
    const k = keyOf(item);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach((i) => next.delete(keyOf(i)));
      } else {
        filtered.forEach((i) => next.add(keyOf(i)));
      }
      return next;
    });
  }

  function selectedItems() {
    const keys = selected.size ? selected : null;
    if (!keys) return filtered;
    const list = items.filter((i) => keys.has(keyOf(i)));
    return list.length ? list : filtered;
  }

  async function exportPdf() {
    const rows = selectedItems();
    if (!rows.length) {
      setMessage('No hay prendas para exportar.');
      return;
    }
    setExporting(true);
    setMessage('Generando PDF…');
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text('American Grace', 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.text(`Catálogo comercial — tarifa ${tariff}`, 40, 58);
      doc.setFontSize(9);
      doc.text(`Generado ${new Date().toLocaleString('es-CO')}`, 40, 72);

      const thumbs = await Promise.all(rows.map((r) => loadImageDataUrl(r.image_url)));

      autoTable(doc, {
        startY: 88,
        head: [['Foto', 'Ref.', 'American Grace', 'Descripción', 'Tallas', 'Género', 'Precio', 'Stock']],
        body: rows.map((r) => [
          '',
          r.referencia,
          r.referencia_ag || '',
          r.descripcion || '',
          r.tallas || '',
          r.genero || '',
          formatCOP(priceForTariff(r, tariff)),
          String(r.stock ?? ''),
        ]),
        styles: { fontSize: 8, cellPadding: 5, minCellHeight: 42 },
        columnStyles: { 0: { cellWidth: 48 } },
        headStyles: { fillColor: [42, 36, 32], textColor: 255 },
        alternateRowStyles: { fillColor: [247, 243, 238] },
        didDrawCell(data) {
          if (data.section !== 'body' || data.column.index !== 0) return;
          const img = thumbs[data.row.index];
          if (!img) return;
          const dim = 34;
          const x = data.cell.x + 6;
          const y = data.cell.y + (data.cell.height - dim) / 2;
          try {
            const fmt = String(img).startsWith('data:image/png') ? 'PNG' : 'JPEG';
            doc.addImage(img, fmt, x, y, dim, dim);
          } catch {
            /* skip bad image */
          }
        },
      });

      doc.save(`catalogo-ag-${tariff}.pdf`);
      setMessage(`PDF exportado (${rows.length} prendas, tarifa ${tariff}).`);
    } finally {
      setExporting(false);
    }
  }

  async function exportCanvaPersonalPdf() {
    const rows = selectedItems();
    if (!rows.length) {
      setMessage('Selecciona prendas para el catálogo personal.');
      return;
    }
    setExporting(true);
    setMessage('Armando PDF desde páginas Canva…');
    try {
      const { map, localPages } = await api.canvaMap();
      const byRef = map?.byReferencia || {};
      const localSet = new Set((localPages || []).map((f) => f.toLowerCase()));
      const missingMap = [];
      const missingFile = [];
      const pages = [];

      for (const item of rows) {
        const entry = byRef[item.referencia];
        const page = entry?.page;
        if (!page) {
          missingMap.push(item.referencia);
          continue;
        }
        const file = pageFileFor(entry, page);
        if (!localSet.has(file.toLowerCase())) {
          // also try .jpg
          const alt = file.replace(/\.png$/i, '.jpg');
          if (localSet.has(alt.toLowerCase())) {
            pages.push({ item, page, file: alt });
            continue;
          }
          missingFile.push(`${item.referencia}→${file}`);
          continue;
        }
        pages.push({ item, page, file });
      }

      if (!pages.length) {
        setMessage(
          `Sin páginas Canva listas. Falta mapa: ${missingMap.slice(0, 8).join(', ') || '—'}; ` +
            `falta archivo: ${missingFile.slice(0, 8).join(', ') || '—'}. ` +
            'Exporta PNG a /canva-pages/ y completa data/canva-page-map.json (ver README).'
        );
        return;
      }

      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      let first = true;

      for (const p of pages) {
        const dataUrl = await loadImageDataUrl(`/canva-pages/${p.file}`);
        if (!dataUrl) {
          missingFile.push(`${p.item.referencia}→${p.file}`);
          continue;
        }
        if (!first) doc.addPage();
        first = false;
        const fmt = String(dataUrl).startsWith('data:image/png') ? 'PNG' : 'JPEG';
        // fill page, keep aspect via fit
        doc.addImage(dataUrl, fmt, 0, 0, pageW, pageH, undefined, 'FAST');
      }

      if (first) {
        setMessage('No se pudieron cargar las imágenes Canva exportadas.');
        return;
      }

      doc.save(`catalogo-personal-canva-${pages.length}p.pdf`);
      const parts = [`PDF Canva personal: ${pages.length} página(s)`];
      if (missingMap.length) parts.push(`sin mapa: ${missingMap.length}`);
      if (missingFile.length) parts.push(`sin archivo: ${missingFile.length}`);
      setMessage(parts.join(' · '));
    } catch (err) {
      setMessage(`Error PDF Canva: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  function printCatalog() {
    window.print();
  }

  async function handleSync() {
    setMessage('');
    try {
      const result = await onSync();
      const parts = [
        `Catálogo actualizado desde seed: ${result.count} ítems (${result.source})`,
      ];
      if (result.updated != null) parts.push(`${result.updated} actualizados`);
      if (result.inserted != null) parts.push(`${result.inserted} nuevos`);
      setMessage(`${parts.join(' · ')}. No borra prendas ya usadas en ventas.`);
    } catch (err) {
      setMessage(`Error al sincronizar: ${err.message}`);
    }
  }

  async function handleMoveGenero(item, genero) {
    if (!onMoveGenero || genero === item.genero) return;
    setMovingId(item.id);
    setMessage('');
    try {
      const result = await onMoveGenero(item, genero);
      if (result.unchanged) {
        setMessage(`${item.referencia_ag || item.referencia} ya estaba en ${genero}.`);
      } else {
        setMessage(
          `Movido ${item.referencia_ag || item.referencia}: ${result.from} → ${result.to}.`
        );
      }
    } catch (err) {
      setMessage(`No se pudo mover: ${err.message}`);
    } finally {
      setMovingId(null);
    }
  }

  function openCreate() {
    setEditingItem(null);
    setShowForm(true);
  }

  function openEdit(item) {
    setEditingItem(item);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingItem(null);
  }

  async function saveGarment(payload) {
    setFormBusy(true);
    setMessage('');
    try {
      if (editingItem?.id) {
        await api.updateCatalogItem(editingItem.id, payload);
        setMessage(`Prenda actualizada: ${payload.referencia_ag || payload.referencia}.`);
      } else {
        await api.createCatalogItem(payload);
        setMessage(`Prenda creada: ${payload.referencia_ag || payload.referencia}.`);
      }
      closeForm();
      await onCatalogChanged?.();
    } catch (err) {
      setMessage(`Error al guardar prenda: ${err.message}`);
    } finally {
      setFormBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Catálogo</h2>
      <p className="panel-sub">
        Búsqueda en tiempo real, filtros por categoría y exportación multi-tarifa.
        Fuente actual: <strong>{source || '—'}</strong>
        {' · '}
        {withPhotos}/{items.length} con foto
      </p>

      <div className="toolbar no-print">
        <input
          type="search"
          placeholder="Buscar referencia, nombre o descripción…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar en catálogo"
        />
        <select value={tariff} onChange={(e) => setTariff(e.target.value)} aria-label="Tarifa">
          {TARIFFS.map((t) => (
            <option key={t.id} value={t.id}>
              Precio {t.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn" onClick={openCreate}>
          + Agregar prenda
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={handleSync}
          disabled={syncing}
          title={
            'Actualiza precios/stock/campos desde el seed de la app (data/catalog-seed.json) y scripts opcionales. ' +
            'NO es sincronización en vivo con Excel/Google Sheet. ' +
            'No borra prendas que ya tienen ventas. ' +
            'Para traer ventas nuevas del Excel usa Ventas → «Actualizar ventas desde Excel».'
          }
        >
          {syncing ? 'Actualizando catálogo…' : 'Sync catálogo'}
        </button>
        <button type="button" className="btn" onClick={exportPdf} disabled={exporting}>
          {exporting ? 'PDF…' : 'Exportar PDF'}
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={exportCanvaPersonalPdf}
          disabled={exporting}
          title="Compone páginas exportadas de Canva según data/canva-page-map.json"
        >
          PDF Canva personal
        </button>
        <button type="button" className="btn ghost" onClick={printCatalog}>
          Imprimir
        </button>
      </div>

      {showForm ? (
        <div className="garment-form-wrap no-print">
          <GarmentForm
            initial={editingItem}
            onSubmit={saveGarment}
            onCancel={closeForm}
            busy={formBusy}
          />
        </div>
      ) : null}

      {/* Future: collections / catalogs-of-garments (Canva-driven groupings) — deferred */}
      <p className="muted no-print" style={{ fontSize: '0.82rem' }}>
        Colecciones / catálogos personalizados de prendas: pendiente (hooks Canva listos; sin bloquear).
      </p>

      <div className="chip-row no-print">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`chip ${category === c ? 'active' : ''}`}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="meta-bar">
        <span>
          {filtered.length} prendas · {selected.size} seleccionadas
        </span>
        <label className="no-print" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleAllFiltered}
          />
          Seleccionar todas (filtro)
        </label>
      </div>

      {message ? <p className="muted no-print">{message}</p> : null}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="no-print"></th>
              <th>Foto</th>
              <th>Referencia</th>
              <th>American Grace</th>
              <th>Descripción</th>
              <th>Tallas</th>
              <th>Género</th>
              <th>Precio</th>
              <th>Stock</th>
              <th className="no-print"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const k = keyOf(item);
              return (
                <tr key={k}>
                  <td className="no-print">
                    <input
                      type="checkbox"
                      checked={selected.has(k)}
                      onChange={() => toggleOne(item)}
                      aria-label={`Seleccionar ${item.referencia_ag}`}
                    />
                  </td>
                  <td>
                    {item.image_url ? (
                      <img
                        className="thumb"
                        src={item.image_url}
                        alt={item.referencia_ag || item.referencia}
                        loading="lazy"
                      />
                    ) : (
                      <span className="thumb-empty" aria-hidden />
                    )}
                  </td>
                  <td>{item.referencia}</td>
                  <td>{item.referencia_ag}</td>
                  <td>{item.descripcion}</td>
                  <td>{item.tallas}</td>
                  <td>
                    <select
                      className="genero-select no-print"
                      value={item.genero || 'Niña'}
                      disabled={movingId === item.id || !item.id}
                      onChange={(e) => handleMoveGenero(item, e.target.value)}
                      aria-label={`Mover ${item.referencia_ag || item.referencia} de sección`}
                    >
                      {GENEROS.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                    <span className="badge print-only">{item.genero}</span>
                  </td>
                  <td>{formatCOP(priceForTariff(item, tariff))}</td>
                  <td>{item.stock}</td>
                  <td className="no-print">
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => openEdit(item)}
                      disabled={!item.id}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              );
            })}
            {!filtered.length ? (
              <tr>
                <td colSpan={10} className="empty">
                  Sin resultados
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
