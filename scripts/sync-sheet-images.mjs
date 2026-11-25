#!/usr/bin/env node
/**
 * Sync product photos from the American Grace Google Sheet into catalog image_url.
 *
 * Sheet (default):
 *   https://docs.google.com/spreadsheets/d/1kt5TnGEkbqXe1JOEErNNKcrj5aGWodOefX47_1V0KnI
 *   gid=965314796
 *
 * Sharing required for unattended sync:
 *   Share → Anyone with the link → Viewer
 *   (or File → Share → Publish to web / export CSV and pass --csv)
 *
 * Usage:
 *   node scripts/sync-sheet-images.mjs
 *   node scripts/sync-sheet-images.mjs --csv /path/to/export.csv
 *   node scripts/sync-sheet-images.mjs --apply   # POST updates to local API
 *
 * Detects: raw https URLs, =IMAGE("url"), Drive file IDs, HYPERLINK to Drive.
 * Prefers durable lh3/uc?export=view Drive thumbnail URLs when an ID is found.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SHEET_ID = '1kt5TnGEkbqXe1JOEErNNKcrj5aGWodOefX47_1V0KnI';
const GID = '965314796';

const args = process.argv.slice(2);
const csvPath = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : null;
const apply = args.includes('--apply');
const apiBase = process.env.AG_API || 'http://localhost:5000';

function driveViewUrl(fileId) {
  // Durable-ish public thumbnail / view URL (requires file shared appropriately)
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

function extractUrlsAndIds(text) {
  const out = [];
  if (!text) return out;
  const s = String(text);
  // =IMAGE("url") or =IMAGE("url", mode)
  for (const m of s.matchAll(/IMAGE\s*\(\s*"([^"]+)"/gi)) out.push(m[1]);
  for (const m of s.matchAll(/HYPERLINK\s*\(\s*"([^"]+)"/gi)) out.push(m[1]);
  for (const m of s.matchAll(/https?:\/\/[^\s",)]+/gi)) out.push(m[0]);
  for (const m of s.matchAll(/[-\w]{25,}/g)) {
    // rough Drive file id; validated later if URL contains drive
    if (/drive\.google|docs\.google|googleusercontent/.test(s)) out.push(m[0]);
  }
  for (const m of s.matchAll(/\/d\/([a-zA-Z0-9_-]{20,})/g)) out.push(m[1]);
  for (const m of s.matchAll(/[?&]id=([a-zA-Z0-9_-]{20,})/g)) out.push(m[1]);
  return out;
}

function normalizeImageUrl(raw) {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v) return null;
  const idFromPath = v.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  const idFromQuery = v.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  const id = idFromPath?.[1] || idFromQuery?.[1];
  if (id) return driveViewUrl(id);
  if (/^https?:\/\//i.test(v)) return v;
  // bare file id
  if (/^[a-zA-Z0-9_-]{25,}$/.test(v)) return driveViewUrl(v);
  return null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQ) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (ch !== '\r') cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

async function fetchSheetCsv() {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`,
  ];
  for (const url of urls) {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'AmericanGraceSync/1.0' } });
    const text = await res.text();
    if (res.ok && !text.includes('<!DOCTYPE html') && text.includes(',')) {
      return text;
    }
    console.error(`[sync] blocked/failed ${res.status} for export — need sharing "Anyone with the link"`);
  }
  return null;
}

function mapRows(csvText, catalog) {
  const rows = parseCsv(csvText);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const findCol = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
  let refCol = findCol('referencia', 'ref');
  let agCol = findCol('american grace', 'referencia ag', 'nombre', 'ag');
  let fotoCol = findCol('foto', 'image', 'imagen', 'photo', 'url');
  // If C is foto per Marian's range=C2 hint and headers unclear, prefer col C (index 2)
  if (fotoCol < 0 && header.length >= 3) fotoCol = 2;
  if (refCol < 0) refCol = 0;

  const byRef = new Map(catalog.map((c) => [String(c.referencia).toUpperCase(), c]));
  const byAg = new Map(
    catalog.map((c) => [String(c.referencia_ag || '').toUpperCase(), c])
  );

  const updates = [];
  for (const row of rows.slice(1)) {
    const ref = (row[refCol] || '').trim();
    const ag = agCol >= 0 ? (row[agCol] || '').trim() : '';
    const fotoCell = fotoCol >= 0 ? row[fotoCol] || '' : row.join(' ');
    const candidates = extractUrlsAndIds(fotoCell);
    let imageUrl = null;
    for (const c of candidates) {
      imageUrl = normalizeImageUrl(c);
      if (imageUrl) break;
    }
    if (!imageUrl && /^https?:\/\//i.test(fotoCell.trim())) imageUrl = fotoCell.trim();
    if (!imageUrl) continue;

    let item =
      (ref && byRef.get(ref.toUpperCase())) ||
      (ag && byAg.get(ag.toUpperCase())) ||
      null;
    if (!item && ref) {
      // soft match referencia contained
      for (const [k, v] of byRef) {
        if (k.includes(ref.toUpperCase()) || ref.toUpperCase().includes(k)) {
          item = v;
          break;
        }
      }
    }
    if (!item) continue;
    updates.push({ referencia: item.referencia, image_url: imageUrl });
  }
  return updates;
}

async function main() {
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalog-seed.json'), 'utf8'));
  let csvText = null;
  if (csvPath) {
    csvText = fs.readFileSync(csvPath, 'utf8');
    console.log(`[sync] loaded local CSV ${csvPath}`);
  } else {
    csvText = await fetchSheetCsv();
  }
  if (!csvText) {
    console.error(`
[sync] Sheet is not publicly readable.

Ask Marian to either:
  1) Share the sheet: Anyone with the link → Viewer, then re-run this script; or
  2) File → Download → CSV and run:
       node scripts/sync-sheet-images.mjs --csv ./export.csv --apply

Interim photos already come from Lista_de_precios_AG.pdf → /catalog-photos/{ref}.jpg
`);
    process.exit(2);
  }

  const updates = mapRows(csvText, seed);
  const out = path.join(ROOT, 'data/sheet-image-updates.json');
  fs.writeFileSync(out, `${JSON.stringify(updates, null, 2)}\n`);
  console.log(`[sync] mapped ${updates.length} image URLs → ${out}`);

  if (apply && updates.length) {
    const res = await fetch(`${apiBase}/api/catalog/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
    const body = await res.json();
    console.log('[sync] apply', body);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
