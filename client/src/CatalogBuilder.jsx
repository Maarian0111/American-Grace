import { useDeferredValue, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCOP, priceForTariff } from './lib/format.js';

const CATEGORIES = ['Todas', 'Niña', 'Niño/Unisex', 'Accesorios'];
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

export default function CatalogBuilder({
  items,
  source,
  onSync,
  syncing,
}) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [category, setCategory] = useState('Todas');
  const [selected, setSelected] = useState(() => new Set());
  const [tariff, setTariff] = useState('tienda');
  const [message, setMessage] = useState('');
  const [exporting, setExporting] = useState(false);

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

  function printCatalog() {
    window.print();
  }

  async function handleSync() {
    setMessage('');
    try {
      const result = await onSync();
      setMessage(`Sincronizado: ${result.count} ítems (${result.source}).`);
    } catch (err) {
      setMessage(`Error al sincronizar: ${err.message}`);
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
        <button type="button" className="btn secondary" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Sincronizando…' : 'Sync catálogo'}
        </button>
        <button type="button" className="btn" onClick={exportPdf} disabled={exporting}>
          {exporting ? 'PDF…' : 'Exportar PDF'}
        </button>
        <button type="button" className="btn ghost" onClick={printCatalog}>
          Imprimir
        </button>
      </div>

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
                    <span className="badge">{item.genero}</span>
                  </td>
                  <td>{formatCOP(priceForTariff(item, tariff))}</td>
                  <td>{item.stock}</td>
                </tr>
              );
            })}
            {!filtered.length ? (
              <tr>
                <td colSpan={9} className="empty">
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
