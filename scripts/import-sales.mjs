#!/usr/bin/env node
/**
 * Import historical ventas from data/imports/ventas-sheet.csv
 *
 * Dry-run (default):
 *   node scripts/import-sales.mjs
 *
 * Apply via local API (server must be running):
 *   node scripts/import-sales.mjs --apply
 *
 * Or hit the API directly:
 *   curl -X POST http://localhost:5000/api/sales/import -H 'content-type: application/json' -d '{"dry_run":false}'
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const { buildImportPlan, loadDefaultCsv } = require('../lib/ventas-import.js');

const apply = process.argv.includes('--apply');
const base = process.env.AG_API || 'http://127.0.0.1:5000';

async function main() {
  const csv = loadDefaultCsv(root);
  if (!apply) {
    // Local dry-run without hitting DB — still prefer API health for catalog/sales if up
    let catalog = [];
    let sales = [];
    try {
      const [c, s] = await Promise.all([
        fetch(`${base}/api/catalog`).then((r) => r.json()),
        fetch(`${base}/api/sales`).then((r) => r.json()),
      ]);
      catalog = c.items || [];
      sales = s.sales || [];
      console.log(`[import] API ${base} catalog=${catalog.length} sales=${sales.length} (${c.source}/${s.source})`);
    } catch {
      catalog = require('../data/catalog-seed.json');
      console.log('[import] API offline — dry-run against catalog-seed only (no existing sales dedup)');
    }
    const plan = buildImportPlan(csv, catalog, sales);
    console.log(JSON.stringify({
      dry_run: true,
      sourceRows: plan.sourceRows,
      wouldImportLines: plan.newLineCount,
      wouldCreateSales: plan.salesToCreate.length,
      skippedExisting: plan.skippedExisting,
      gapSummary: plan.gapSummary,
      uniqueRefsMissing: plan.uniqueRefsMissing,
    }, null, 2));
    return;
  }

  const res = await fetch(`${base}/api/sales/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dry_run: false }),
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
  if (!res.ok || data.ok === false) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
