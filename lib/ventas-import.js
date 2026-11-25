/**
 * Shared AG ventas sheet import helpers (CJS — used by server + scripts).
 */
const fs = require('fs');

const ESTADO_ALLOWED = new Set([
  'PENDIENTE',
  'ENTREGADO',
  'ENTREGADO 1° CORTE',
  'PAGADO',
  'PARCIAL',
  'CANCELADO',
]);

function parseCsv(text) {
  const rows = [];
  let i = 0;
  const len = text.length;

  function readField() {
    if (i >= len) return '';
    if (text[i] === '"') {
      i += 1;
      let out = '';
      while (i < len) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            out += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        out += text[i++];
      }
      return out;
    }
    let out = '';
    while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
      out += text[i++];
    }
    return out;
  }

  function readRow() {
    if (i >= len) return null;
    const fields = [];
    while (i < len) {
      fields.push(readField());
      if (i >= len) break;
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === '\r') i += 1;
      if (text[i] === '\n') i += 1;
      break;
    }
    return fields;
  }

  const header = readRow();
  if (!header) return [];
  const keys = header.map((h) => String(h || '').trim());
  while (i < len) {
    const fields = readRow();
    if (!fields) break;
    const obj = {};
    keys.forEach((k, idx) => {
      obj[k] = fields[idx] != null ? fields[idx] : '';
    });
    if (Object.values(obj).every((v) => String(v).trim() === '')) continue;
    rows.push(obj);
  }
  return rows;
}

function parseMoney(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  const cleaned = s
    .replace(/\$/g, '')
    .replace(/\s/g, '')
    .replace(/COP/gi, '')
    .replace(/\./g, '')
    .replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseSheetDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function normalizeReferencia(raw) {
  return String(raw || '').trim().toUpperCase();
}

function normalizeEstado(estadoRaw, fechaPagoRaw) {
  let estado = String(estadoRaw || 'PENDIENTE').trim().toUpperCase() || 'PENDIENTE';
  const pago = String(fechaPagoRaw || '').trim();
  if (estado === 'ENTREGADO' && /1[°º]?\s*CORTE/i.test(pago)) {
    estado = 'ENTREGADO 1° CORTE';
  }
  if (!ESTADO_ALLOWED.has(estado)) {
    if (estado.startsWith('ENTREGADO')) estado = 'ENTREGADO';
    else estado = 'PENDIENTE';
  }
  return estado;
}

function lineDedupKey(line) {
  return [
    line.fecha_venta || '',
    (line.vendedor_nombre || '').toLowerCase(),
    (line.referencia || '').toUpperCase(),
    String(line.talla || ''),
    String(line.cantidad || 1),
  ].join('|');
}

function parseVentasCsv(csvText, opts = {}) {
  const catalogByRef = opts.catalogByRef || new Map();
  const rows = parseCsv(csvText);
  const lines = [];
  const gaps = [];
  let lastFecha = null;
  let lastVendedor = null;

  rows.forEach((row, idx) => {
    const sheetRow = idx + 2;
    const ref = normalizeReferencia(row.Referencia || row.referencia);
    if (!ref) {
      gaps.push({ sheetRow, reason: 'missing_referencia' });
      return;
    }

    const fechaParsed = parseSheetDate(row['Fecha venta'] || row.fecha_venta);
    if (fechaParsed) lastFecha = fechaParsed;
    const vendRaw = String(row['VENDIDO POR'] || row.vendedor || '').trim();
    if (vendRaw) lastVendedor = vendRaw;

    const fecha = fechaParsed || lastFecha;
    const vendedor = vendRaw || lastVendedor;
    if (!fecha) gaps.push({ sheetRow, reason: 'missing_fecha', referencia: ref });

    const estado = normalizeEstado(row.Estado || row.estado, row['Fecha pago']);
    const fechaPagoRaw = String(row['Fecha pago'] || '').trim();
    const fechaPagoDate = parseSheetDate(fechaPagoRaw);
    const paymentAmount = !fechaPagoDate ? parseMoney(fechaPagoRaw) : null;

    let cantidad = Number(String(row.Cant || row.cantidad || '').trim());
    if (!Number.isFinite(cantidad) || cantidad <= 0) cantidad = 1;

    const catalog = catalogByRef.get(ref) || null;
    const retail =
      paymentAmount || (catalog ? Number(catalog.precio_tienda) || 0 : 0) || 0;

    if (!catalog) gaps.push({ sheetRow, reason: 'ref_not_in_catalog', referencia: ref });

    const line = {
      sheetRow,
      fecha_venta: fecha || '2026-01-01',
      fecha_inferred: !fecha,
      vendedor_nombre: vendedor || null,
      referencia: ref,
      descripcion: String(
        row.Descripcion || row.descripcion || catalog?.descripcion || ''
      ).trim(),
      talla: String(row.Talla || row.talla || '').trim() || null,
      cantidad,
      precio_unitario: retail,
      tariff: 'tienda',
      estado_pago: estado,
      fecha_pago: fechaPagoDate,
      catalog_item_id: catalog?.id || null,
      notas_extra: paymentAmount ? `monto_pago_hoja=${paymentAmount}` : null,
    };
    line.dedup_key = lineDedupKey(line);
    lines.push(line);
  });

  return { lines, gaps };
}

function groupLinesIntoSales(lines) {
  const groups = new Map();
  for (const line of lines) {
    const gkey = [
      line.fecha_venta,
      (line.vendedor_nombre || '').toLowerCase(),
      line.estado_pago,
    ].join('|');
    if (!groups.has(gkey)) {
      groups.set(gkey, {
        fecha_venta: line.fecha_venta,
        vendedor_nombre: line.vendedor_nombre,
        estado_pago: line.estado_pago,
        fecha_pago: line.fecha_pago,
        items: [],
      });
    }
    const g = groups.get(gkey);
    if (!g.fecha_pago && line.fecha_pago) g.fecha_pago = line.fecha_pago;
    g.items.push(line);
  }
  return [...groups.values()].map((g) => {
    const total = g.items.reduce(
      (s, it) => s + Number(it.precio_unitario || 0) * Number(it.cantidad || 1),
      0
    );
    const notes = [
      'import:ventas-sheet',
      ...new Set(g.items.map((i) => i.notas_extra).filter(Boolean)),
    ].join('; ');
    return {
      fecha_venta: g.fecha_venta,
      vendedor_nombre: g.vendedor_nombre,
      estado_pago: g.estado_pago,
      fecha_pago: g.fecha_pago,
      notas: notes,
      total,
      items: g.items.map((it) => ({
        catalog_item_id: it.catalog_item_id,
        referencia: it.referencia,
        descripcion: it.descripcion,
        talla: it.talla,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        tariff: it.tariff,
        dedup_key: it.dedup_key,
        sheetRow: it.sheetRow,
      })),
    };
  });
}

function existingDedupKeysFromSales(sales) {
  const keys = new Set();
  for (const s of sales || []) {
    for (const it of s.items || s.sale_items || []) {
      keys.add(
        lineDedupKey({
          fecha_venta: s.fecha_venta,
          vendedor_nombre: s.vendedor_nombre,
          referencia: it.referencia,
          talla: it.talla,
          cantidad: it.cantidad,
        })
      );
    }
  }
  return keys;
}

function buildImportPlan(csvText, catalogItems, existingSales) {
  const catalogByRef = new Map();
  for (const c of catalogItems || []) {
    if (c.referencia) catalogByRef.set(String(c.referencia).toUpperCase(), c);
  }
  const { lines, gaps } = parseVentasCsv(csvText, { catalogByRef });
  const existing = existingDedupKeysFromSales(existingSales);
  const newLines = [];
  let skippedExisting = 0;
  for (const line of lines) {
    if (existing.has(line.dedup_key)) {
      skippedExisting += 1;
      continue;
    }
    newLines.push(line);
  }
  const salesToCreate = groupLinesIntoSales(newLines);
  const gapSummary = {};
  for (const g of gaps) {
    gapSummary[g.reason] = (gapSummary[g.reason] || 0) + 1;
  }
  return {
    sourceRows: lines.length,
    newLineCount: newLines.length,
    skippedExisting,
    salesToCreate,
    gaps,
    gapSummary,
    uniqueRefsMissing: [
      ...new Set(gaps.filter((g) => g.reason === 'ref_not_in_catalog').map((g) => g.referencia)),
    ],
  };
}

function loadDefaultCsv(repoRoot) {
  const p = require('path').join(repoRoot, 'data', 'imports', 'ventas-sheet.csv');
  return fs.readFileSync(p, 'utf8');
}

module.exports = {
  parseVentasCsv,
  groupLinesIntoSales,
  lineDedupKey,
  buildImportPlan,
  loadDefaultCsv,
  normalizeReferencia,
};
