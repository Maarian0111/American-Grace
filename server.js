/**
 * American Grace — Express API + static client
 * Hybrid local-first: works without Supabase using in-memory + seed JSON.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const XLSX = require('xlsx');
const {
  buildImportPlan,
  loadDefaultCsv,
  findDuplicateSaleGroups,
} = require('./lib/ventas-import');
const {
  authConfig,
  authMiddleware,
  credentialsOk,
  createSessionToken,
  sessionCookieHeader,
  readSession,
  DEFAULT_SOFT_PASSWORD,
} = require('./lib/auth');

const PORT = Number(process.env.PORT) || 5000;
const SEED_PATH = path.join(__dirname, 'data', 'catalog-seed.json');
const LOCAL_DB_PATH = path.join(__dirname, 'data', 'local-db.json');
const CANVA_MAP_PATH = path.join(__dirname, 'data', 'canva-page-map.json');
const GENEROS = new Set(['Niña', 'Niño/Unisex', 'Accesorios']);

function suggestPricesFromTienda(tiendaRaw) {
  const tienda = Math.round(Number(tiendaRaw) || 0);
  return {
    precio_tienda: tienda,
    precio_mayorista: Math.round(tienda * 0.7), // 30% off
    precio_consignacion: Math.round(tienda * 0.85), // 15% off
  };
}

function normalizeCatalogBody(body = {}, { partial = false } = {}) {
  const out = {};
  if (body.referencia !== undefined || !partial) {
    out.referencia = String(body.referencia || '')
      .trim()
      .toUpperCase();
  }
  if (body.referencia_ag !== undefined || !partial) {
    out.referencia_ag = String(body.referencia_ag || body.nombre_ag || '').trim();
  }
  if (body.descripcion !== undefined || !partial) {
    out.descripcion = String(body.descripcion || '').trim();
  }
  if (body.tallas !== undefined || !partial) {
    out.tallas = String(body.tallas || '').trim();
  }
  if (body.genero !== undefined || !partial) {
    out.genero = String(body.genero || 'Niña').trim();
  }
  if (body.stock !== undefined || !partial) {
    out.stock = Number(body.stock || 0);
  }
  if (body.image_url !== undefined) {
    out.image_url = body.image_url || null;
  }

  const hasTienda = body.precio_tienda !== undefined && body.precio_tienda !== '';
  const suggested = hasTienda ? suggestPricesFromTienda(body.precio_tienda) : null;
  if (hasTienda || !partial) {
    out.precio_tienda = suggested
      ? suggested.precio_tienda
      : Math.round(Number(body.precio_tienda) || 0);
  }
  if (body.precio_mayorista !== undefined && body.precio_mayorista !== '') {
    out.precio_mayorista = Math.round(Number(body.precio_mayorista) || 0);
  } else if (suggested && !partial) {
    out.precio_mayorista = suggested.precio_mayorista;
  }
  if (body.precio_consignacion !== undefined && body.precio_consignacion !== '') {
    out.precio_consignacion = Math.round(Number(body.precio_consignacion) || 0);
  } else if (suggested && !partial) {
    out.precio_consignacion = suggested.precio_consignacion;
  }
  return out;
}

const hasSupabase =
  Boolean(process.env.SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_ANON_KEY) &&
  !String(process.env.SUPABASE_URL).includes('your-project');

let supabase = null;
if (hasSupabase) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  console.log('[ag] Supabase connected');
} else {
  console.log('[ag] No Supabase credentials — using local seed / memory store');
}

/* ─── Local persistence ─────────────────────────────────────────── */
function loadSeedCatalog() {
  return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
}

function defaultLocalDb() {
  const catalog = loadSeedCatalog().map((item, i) => ({ id: i + 1, ...item }));
  return {
    catalog_items: catalog,
    sellers: [
      { id: 1, name: 'Felipe Alvernia', active: true },
      { id: 2, name: 'Alejandra Rivera', active: true },
      { id: 3, name: 'Angie Ortiz', active: true },
      { id: 4, name: 'Mariana Rivera', active: true },
    ],
    sales: [],
    sale_items: [],
    sale_change_history: [],
    catalog_change_history: [],
    _seqs: { sales: 1, sale_items: 1, history: 1, sellers: 5, catalog_history: 1 },
  };
}

function readLocal() {
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    const db = defaultLocalDb();
    writeLocal(db);
    return db;
  }
  return JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf8'));
}

function writeLocal(db) {
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(db, null, 2));
}

function saleSnapshot(db, saleId) {
  const sale = db.sales.find((s) => s.id === saleId);
  if (!sale) return null;
  const items = db.sale_items.filter((i) => i.sale_id === saleId);
  return { ...sale, items };
}

function addSellerLocal(name) {
  const db = readLocal();
  if (db.sellers.find((s) => s.name.toLowerCase() === name.toLowerCase())) {
    return { error: 'seller already exists' };
  }
  const seller = { id: db._seqs.sellers++, name, active: true };
  db.sellers.push(seller);
  writeLocal(db);
  return seller;
}

function createSaleLocal(body, items, total) {
  const db = readLocal();
  const sale = {
    id: db._seqs.sales++,
    fecha_venta: body.fecha_venta || new Date().toISOString().slice(0, 10),
    seller_id: body.seller_id || null,
    vendedor_nombre: body.vendedor_nombre || null,
    cliente: body.cliente || null,
    estado_pago: body.estado_pago || 'PENDIENTE',
    fecha_pago: body.fecha_pago || null,
    notas: body.notas || null,
    total,
    payment_provider: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.sales.push(sale);
  const insertedItems = items.map((it) => ({
    id: db._seqs.sale_items++,
    sale_id: sale.id,
    catalog_item_id: it.catalog_item_id || null,
    referencia: it.referencia,
    descripcion: it.descripcion,
    talla: it.talla,
    cantidad: Number(it.cantidad || 1),
    precio_unitario: Number(it.precio_unitario || 0),
    tariff: it.tariff || 'tienda',
  }));
  db.sale_items.push(...insertedItems);
  const after = { ...sale, items: insertedItems };
  db.sale_change_history.push({
    id: db._seqs.history++,
    sale_id: sale.id,
    action: 'create',
    changed_by: body.changed_by || body.vendedor_nombre || 'sistema',
    before_data: null,
    after_data: after,
    context: 'Venta creada',
    created_at: new Date().toISOString(),
  });
  writeLocal(db);
  return after;
}

/* ─── App ───────────────────────────────────────────────────────── */
const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(authMiddleware);

const bootAuth = authConfig();
if (bootAuth.setupRequired) {
  console.warn(
    '[ag] APP_PASSWORD unset on production/Render — login blocked until Marian sets APP_PASSWORD in env and redeploys'
  );
} else if (bootAuth.softLock) {
  console.warn(
    `[ag] APP_PASSWORD unset — soft-lock password "${DEFAULT_SOFT_PASSWORD}" (local/dev only; set APP_PASSWORD on Render)`
  );
} else {
  console.log('[ag] Auth enabled (APP_PASSWORD set)');
}

app.get('/api/health', (_req, res) => {
  const cfg = authConfig();
  res.json({
    ok: true,
    mode: hasSupabase ? 'supabase' : 'local',
    port: PORT,
    auth: cfg.setupRequired ? 'setup-required' : cfg.softLock ? 'soft-lock' : 'required',
    passwordConfigured: cfg.passwordConfigured,
  });
});

app.get('/api/auth/status', (req, res) => {
  const cfg = authConfig();
  const session = readSession(req, cfg);
  res.json({
    ok: true,
    authenticated: Boolean(session),
    user: session?.u || null,
    softLock: cfg.softLock,
    setupRequired: cfg.setupRequired,
    passwordConfigured: cfg.passwordConfigured,
    authRequired: cfg.authRequired,
    userRequired: cfg.userRequired,
  });
});

app.post('/api/auth/login', (req, res) => {
  const cfg = authConfig();
  if (cfg.setupRequired) {
    return res.status(503).json({
      ok: false,
      error:
        'Falta APP_PASSWORD en Render. Ve a Environment → Add Environment Variable → APP_PASSWORD, guarda y redespliega.',
      setupRequired: true,
    });
  }
  if (!credentialsOk(req.body || {}, cfg)) {
    return res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
  }
  const username =
    String(req.body?.username || req.body?.user || '').trim() ||
    cfg.expectedUser ||
    'reception';
  const token = createSessionToken(username, cfg.secret);
  res.setHeader('Set-Cookie', sessionCookieHeader(token));
  res.json({ ok: true, user: username, softLock: cfg.softLock });
});

app.post('/api/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', sessionCookieHeader('', { clear: true }));
  res.json({ ok: true });
});

/* ─── Catalog ───────────────────────────────────────────────────── */
app.get('/api/catalog', async (_req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('catalog_items')
        .select('*')
        .order('referencia_ag');
      if (error) throw error;
      if (data && data.length) return res.json({ source: 'supabase', items: data });
    }
    const db = readLocal();
    res.json({ source: 'local', items: db.catalog_items });
  } catch (err) {
    console.error(err);
    const db = readLocal();
    res.json({ source: 'local-fallback', items: db.catalog_items, warning: err.message });
  }
});

app.post('/api/catalog', async (req, res) => {
  const body = normalizeCatalogBody(req.body || {}, { partial: false });
  if (!body.referencia) return res.status(400).json({ error: 'referencia required' });
  if (!GENEROS.has(body.genero)) {
    return res.status(400).json({
      error: `genero must be one of: ${[...GENEROS].join(', ')}`,
    });
  }
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('catalog_items')
        .insert({
          referencia: body.referencia,
          referencia_ag: body.referencia_ag || null,
          descripcion: body.descripcion || null,
          tallas: body.tallas || null,
          genero: body.genero,
          precio_tienda: body.precio_tienda,
          precio_mayorista: body.precio_mayorista,
          precio_consignacion: body.precio_consignacion,
          stock: body.stock,
          image_url: body.image_url || null,
        })
        .select()
        .single();
      if (error) throw error;
      const db = readLocal();
      if (!db.catalog_items.find((c) => c.referencia === data.referencia)) {
        db.catalog_items.push(data);
        writeLocal(db);
      }
      return res.status(201).json({ source: 'supabase', item: data });
    }
    const db = readLocal();
    if (db.catalog_items.find((c) => c.referencia === body.referencia)) {
      return res.status(409).json({ error: 'referencia already exists' });
    }
    const nextId =
      db.catalog_items.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;
    const item = {
      id: nextId,
      ...body,
      image_url: body.image_url || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.catalog_items.push(item);
    writeLocal(db);
    res.status(201).json({ source: 'local', item });
  } catch (err) {
    console.error('[catalog create]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Upsert catalog from data/catalog-seed.json by `referencia`.
 * NEVER deletes catalog rows (sale_items.catalog_item_id FK) — only insert/update fields.
 * This is NOT a live Google Sheet/Excel sync; Excel sales use "Actualizar ventas".
 */
app.post('/api/catalog/seed', async (_req, res) => {
  try {
    const seed = loadSeedCatalog();
    const seedRows = seed.map((s) => ({
      referencia: String(s.referencia || '')
        .trim()
        .toUpperCase(),
      referencia_ag: s.referencia_ag,
      descripcion: s.descripcion,
      tallas: s.tallas,
      genero: s.genero,
      precio_tienda: s.precio_tienda,
      precio_mayorista: s.precio_mayorista,
      precio_consignacion: s.precio_consignacion,
      stock: s.stock,
      image_url: s.image_url || null,
    }));

    if (supabase) {
      const { data: existing, error: fetchErr } = await supabase
        .from('catalog_items')
        .select('*');
      if (fetchErr) throw fetchErr;

      const byRef = new Map(
        (existing || []).map((row) => [String(row.referencia || '').trim().toUpperCase(), row])
      );
      let inserted = 0;
      let updated = 0;
      const mirrored = [...(existing || [])];

      for (const row of seedRows) {
        if (!row.referencia) continue;
        const prev = byRef.get(row.referencia);
        if (prev) {
          const { data, error } = await supabase
            .from('catalog_items')
            .update({
              referencia_ag: row.referencia_ag,
              descripcion: row.descripcion,
              tallas: row.tallas,
              genero: row.genero,
              precio_tienda: row.precio_tienda,
              precio_mayorista: row.precio_mayorista,
              precio_consignacion: row.precio_consignacion,
              stock: row.stock,
              image_url: row.image_url,
              updated_at: new Date().toISOString(),
            })
            .eq('id', prev.id)
            .select()
            .maybeSingle();
          if (error) throw error;
          const next = data || { ...prev, ...row };
          const idx = mirrored.findIndex((c) => c.id === prev.id);
          if (idx >= 0) mirrored[idx] = next;
          byRef.set(row.referencia, next);
          updated += 1;
        } else {
          const { data, error } = await supabase
            .from('catalog_items')
            .insert(row)
            .select()
            .maybeSingle();
          if (error) throw error;
          const next = data || { id: null, ...row };
          mirrored.push(next);
          byRef.set(row.referencia, next);
          inserted += 1;
        }
      }

      const db = readLocal();
      db.catalog_items = mirrored.map((r, i) => ({ id: r.id || i + 1, ...r }));
      writeLocal(db);
      return res.json({
        ok: true,
        source: 'supabase',
        count: mirrored.length,
        inserted,
        updated,
        preserved: Math.max(0, mirrored.length - inserted),
        mode: 'upsert-by-referencia',
        note: 'No se borran filas del catálogo (protege sale_items). No es sync en vivo de Excel.',
      });
    }

    // Local: upsert by referencia; keep ids + orphan rows (sales FKs / local history)
    const db = readLocal();
    const byRef = new Map(
      (db.catalog_items || []).map((c) => [String(c.referencia || '').trim().toUpperCase(), c])
    );
    let nextId =
      (db.catalog_items || []).reduce((max, c) => Math.max(max, Number(c.id) || 0), 0) + 1;
    let inserted = 0;
    let updated = 0;

    for (const row of seedRows) {
      if (!row.referencia) continue;
      const prev = byRef.get(row.referencia);
      if (prev) {
        Object.assign(prev, row);
        updated += 1;
      } else {
        const created = { id: nextId++, ...row };
        db.catalog_items.push(created);
        byRef.set(row.referencia, created);
        inserted += 1;
      }
    }

    writeLocal(db);
    res.json({
      ok: true,
      source: 'local',
      count: db.catalog_items.length,
      inserted,
      updated,
      preserved: Math.max(0, db.catalog_items.length - inserted),
      mode: 'upsert-by-referencia',
      note: 'No se borran filas del catálogo. No es sync en vivo de Excel.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─── Sellers ───────────────────────────────────────────────────── */
app.get('/api/sellers', async (req, res) => {
  const includeInactive = String(req.query.all || '') === '1';
  try {
    if (supabase) {
      let q = supabase.from('sellers').select('*').order('name');
      if (!includeInactive) q = q.eq('active', true);
      const { data, error } = await q;
      if (error) throw error;
      if (data?.length) return res.json({ source: 'supabase', sellers: data });
    }
    const db = readLocal();
    res.json({
      source: 'local',
      sellers: includeInactive
        ? db.sellers
        : db.sellers.filter((s) => s.active !== false),
    });
  } catch (err) {
    const db = readLocal();
    res.json({ source: 'local-fallback', sellers: db.sellers, warning: err.message });
  }
});

app.post('/api/sellers', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('sellers')
        .insert({ name, active: true })
        .select()
        .single();
      if (error) throw error;
      const db = readLocal();
      if (!db.sellers.find((s) => s.name === name)) {
        db.sellers.push(data);
        writeLocal(db);
      }
      return res.status(201).json({ source: 'supabase', seller: data });
    }
    const seller = addSellerLocal(name);
    if (seller.error) return res.status(409).json({ error: seller.error });
    res.status(201).json({ source: 'local', seller });
  } catch (err) {
    const seller = addSellerLocal(name);
    if (seller.error) return res.status(409).json({ error: seller.error, warning: err.message });
    res.status(201).json({ source: 'local-fallback', seller, warning: err.message });
  }
});

app.patch('/api/sellers/:id', async (req, res) => {
  const id = Number(req.params.id);
  const patch = {};
  if (req.body?.name !== undefined) {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    patch.name = name;
  }
  if (req.body?.active !== undefined) {
    patch.active = Boolean(req.body.active);
  }
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'name or active required' });
  }
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('sellers')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      const db = readLocal();
      const local = db.sellers.find((s) => s.id === id);
      if (local) Object.assign(local, patch);
      writeLocal(db);
      return res.json({ source: 'supabase', seller: data });
    }
    const db = readLocal();
    const seller = db.sellers.find((s) => s.id === id);
    if (!seller) return res.status(404).json({ error: 'not found' });
    if (patch.name) {
      const clash = db.sellers.find(
        (s) => s.id !== id && s.name.toLowerCase() === patch.name.toLowerCase()
      );
      if (clash) return res.status(409).json({ error: 'seller already exists' });
      seller.name = patch.name;
    }
    if (patch.active !== undefined) seller.active = patch.active;
    writeLocal(db);
    res.json({ source: 'local', seller });
  } catch (err) {
    console.error('[sellers patch]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─── Sales ─────────────────────────────────────────────────────── */
function buildSaleFilters(query) {
  return {
    from: query.from || null,
    to: query.to || null,
    sellerId: query.seller_id ? Number(query.seller_id) : null,
    sellerName: query.vendedor || null,
    estado: query.estado || null,
  };
}

function filterLocalSales(db, f) {
  return db.sales.filter((s) => {
    if (f.from && s.fecha_venta < f.from) return false;
    if (f.to && s.fecha_venta > f.to) return false;
    if (f.sellerId && s.seller_id !== f.sellerId) return false;
    if (f.sellerName && (s.vendedor_nombre || '').toLowerCase() !== f.sellerName.toLowerCase())
      return false;
    if (f.estado && s.estado_pago !== f.estado) return false;
    return true;
  });
}

app.get('/api/sales', async (req, res) => {
  const f = buildSaleFilters(req.query);
  try {
    if (supabase) {
      let q = supabase
        .from('sales')
        .select('*, sale_items(*), sellers(name)')
        .order('fecha_venta', { ascending: false });
      if (f.from) q = q.gte('fecha_venta', f.from);
      if (f.to) q = q.lte('fecha_venta', f.to);
      if (f.sellerId) q = q.eq('seller_id', f.sellerId);
      if (f.estado) q = q.eq('estado_pago', f.estado);
      const { data, error } = await q;
      if (error) throw error;
      if (data) {
        return res.json({
          source: 'supabase',
          sales: data.map((s) => ({
            ...s,
            items: s.sale_items || [],
            vendedor_nombre: s.vendedor_nombre || s.sellers?.name,
          })),
        });
      }
    }
    const db = readLocal();
    const sales = filterLocalSales(db, f)
      .map((s) => ({ ...s, items: db.sale_items.filter((i) => i.sale_id === s.id) }))
      .sort((a, b) => (a.fecha_venta < b.fecha_venta ? 1 : -1));
    res.json({ source: 'local', sales });
  } catch (err) {
    const db = readLocal();
    const sales = filterLocalSales(db, f).map((s) => ({
      ...s,
      items: db.sale_items.filter((i) => i.sale_id === s.id),
    }));
    res.json({ source: 'local-fallback', sales, warning: err.message });
  }
});

/* ─── Exports ───────────────────────────────────────────────────── */
app.get('/api/sales/export/xlsx', async (req, res) => {
  try {
    const f = buildSaleFilters(req.query);
    let sales;
    if (supabase) {
      let q = supabase.from('sales').select('*, sale_items(*)').order('fecha_venta');
      if (f.from) q = q.gte('fecha_venta', f.from);
      if (f.to) q = q.lte('fecha_venta', f.to);
      if (f.sellerId) q = q.eq('seller_id', f.sellerId);
      const { data, error } = await q;
      if (error) throw error;
      sales = (data || []).map((s) => ({ ...s, items: s.sale_items || [] }));
    } else {
      const db = readLocal();
      sales = filterLocalSales(db, f).map((s) => ({
        ...s,
        items: db.sale_items.filter((i) => i.sale_id === s.id),
      }));
    }

    const rows = [];
    for (const s of sales) {
      for (const it of s.items || []) {
        rows.push({
          'Fecha venta': s.fecha_venta,
          Vendedor: s.vendedor_nombre,
          Cliente: s.cliente || '',
          Referencia: it.referencia,
          Descripción: it.descripcion,
          Talla: it.talla,
          Cantidad: it.cantidad,
          'Precio unitario': it.precio_unitario,
          Tarifa: it.tariff,
          'Estado pago': s.estado_pago,
          'Fecha pago': s.fecha_pago || '',
          Total: s.total,
          Notas: s.notas || '',
        });
      }
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Ventas');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="ventas-american-grace.xlsx"');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/sales/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('sales')
        .select('*, sale_items(*), sale_change_history(*)')
        .eq('id', id)
        .single();
      if (error) throw error;
      return res.json({
        source: 'supabase',
        sale: { ...data, items: data.sale_items, history: data.sale_change_history },
      });
    }
    const db = readLocal();
    const sale = saleSnapshot(db, id);
    if (!sale) return res.status(404).json({ error: 'not found' });
    const history = db.sale_change_history.filter((h) => h.sale_id === id);
    res.json({ source: 'local', sale: { ...sale, history } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales', async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json({ error: 'items required' });

  const total = items.reduce(
    (sum, it) => sum + Number(it.precio_unitario || 0) * Number(it.cantidad || 1),
    0
  );

  try {
    if (supabase) {
      const { data: sale, error } = await supabase
        .from('sales')
        .insert({
          fecha_venta: body.fecha_venta || new Date().toISOString().slice(0, 10),
          seller_id: body.seller_id || null,
          vendedor_nombre: body.vendedor_nombre || null,
          cliente: body.cliente || null,
          estado_pago: body.estado_pago || 'PENDIENTE',
          fecha_pago: body.fecha_pago || null,
          notas: body.notas || null,
          total,
          payment_provider: null, // manual until Bancolombia integration
        })
        .select()
        .single();
      if (error) throw error;

      const itemRows = items.map((it) => ({
        sale_id: sale.id,
        catalog_item_id: it.catalog_item_id || null,
        referencia: it.referencia,
        descripcion: it.descripcion,
        talla: it.talla,
        cantidad: Number(it.cantidad || 1),
        precio_unitario: Number(it.precio_unitario || 0),
        tariff: it.tariff || 'tienda',
      }));
      const { data: insertedItems, error: iErr } = await supabase
        .from('sale_items')
        .insert(itemRows)
        .select();
      if (iErr) throw iErr;

      const after = { ...sale, items: insertedItems };
      await supabase.from('sale_change_history').insert({
        sale_id: sale.id,
        action: 'create',
        changed_by: body.changed_by || body.vendedor_nombre || 'sistema',
        before_data: null,
        after_data: after,
        context: 'Venta creada',
      });

      return res.status(201).json({ source: 'supabase', sale: after });
    }

    const after = createSaleLocal(body, items, total);
    res.status(201).json({ source: 'local', sale: after });
  } catch (err) {
    console.error('[sales create]', err.message);
    // Tables may be missing until full schema.sql is applied — keep app usable
    try {
      const after = createSaleLocal(body, items, total);
      return res.status(201).json({
        source: 'local-fallback',
        sale: after,
        warning: err.message,
      });
    } catch (localErr) {
      res.status(500).json({ error: err.message, localError: localErr.message });
    }
  }
});

app.put('/api/sales/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const action = body.action || 'edit'; // edit | cambio | estado

  try {
    if (supabase) {
      const { data: existing, error } = await supabase
        .from('sales')
        .select('*, sale_items(*)')
        .eq('id', id)
        .single();
      if (error) throw error;
      const before = { ...existing, items: existing.sale_items };

      const patch = {
        updated_at: new Date().toISOString(),
      };
      if (body.fecha_venta !== undefined) patch.fecha_venta = body.fecha_venta;
      if (body.seller_id !== undefined) patch.seller_id = body.seller_id;
      if (body.vendedor_nombre !== undefined) patch.vendedor_nombre = body.vendedor_nombre;
      if (body.cliente !== undefined) patch.cliente = body.cliente;
      if (body.estado_pago !== undefined) patch.estado_pago = body.estado_pago;
      if (body.fecha_pago !== undefined) patch.fecha_pago = body.fecha_pago;
      if (body.notas !== undefined) patch.notas = body.notas;

      let items = before.items;
      if (Array.isArray(body.items)) {
        await supabase.from('sale_items').delete().eq('sale_id', id);
        const itemRows = body.items.map((it) => ({
          sale_id: id,
          catalog_item_id: it.catalog_item_id || null,
          referencia: it.referencia,
          descripcion: it.descripcion,
          talla: it.talla,
          cantidad: Number(it.cantidad || 1),
          precio_unitario: Number(it.precio_unitario || 0),
          tariff: it.tariff || 'tienda',
        }));
        const { data: newItems, error: iErr } = await supabase
          .from('sale_items')
          .insert(itemRows)
          .select();
        if (iErr) throw iErr;
        items = newItems;
        patch.total = items.reduce(
          (s, it) => s + Number(it.precio_unitario) * Number(it.cantidad),
          0
        );
      }

      const { data: updated, error: uErr } = await supabase
        .from('sales')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (uErr) throw uErr;

      const after = { ...updated, items };
      await supabase.from('sale_change_history').insert({
        sale_id: id,
        action,
        changed_by: body.changed_by || 'sistema',
        before_data: before,
        after_data: after,
        context: body.context || (action === 'cambio' ? 'Cambio de prenda' : 'Edición de venta'),
      });

      return res.json({ source: 'supabase', sale: after });
    }

    const db = readLocal();
    const idx = db.sales.findIndex((s) => s.id === id);
    if (idx < 0) return res.status(404).json({ error: 'not found' });
    const before = saleSnapshot(db, id);

    const sale = db.sales[idx];
    if (body.fecha_venta !== undefined) sale.fecha_venta = body.fecha_venta;
    if (body.seller_id !== undefined) sale.seller_id = body.seller_id;
    if (body.vendedor_nombre !== undefined) sale.vendedor_nombre = body.vendedor_nombre;
    if (body.cliente !== undefined) sale.cliente = body.cliente;
    if (body.estado_pago !== undefined) sale.estado_pago = body.estado_pago;
    if (body.fecha_pago !== undefined) sale.fecha_pago = body.fecha_pago;
    if (body.notas !== undefined) sale.notas = body.notas;
    sale.updated_at = new Date().toISOString();

    if (Array.isArray(body.items)) {
      db.sale_items = db.sale_items.filter((i) => i.sale_id !== id);
      const finalItems = body.items.map((it) => ({
        id: db._seqs.sale_items++,
        sale_id: id,
        catalog_item_id: it.catalog_item_id || null,
        referencia: it.referencia,
        descripcion: it.descripcion,
        talla: it.talla,
        cantidad: Number(it.cantidad || 1),
        precio_unitario: Number(it.precio_unitario || 0),
        tariff: it.tariff || 'tienda',
      }));
      db.sale_items.push(...finalItems);
      sale.total = finalItems.reduce(
        (s, it) => s + Number(it.precio_unitario) * Number(it.cantidad),
        0
      );
    }

    const after = saleSnapshot(db, id);
    db.sale_change_history.push({
      id: db._seqs.history++,
      sale_id: id,
      action,
      changed_by: body.changed_by || 'sistema',
      before_data: before,
      after_data: after,
      context: body.context || (action === 'cambio' ? 'Cambio de prenda' : 'Edición de venta'),
      created_at: new Date().toISOString(),
    });
    writeLocal(db);
    res.json({ source: 'local', sale: after });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales/:id/history', async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('sale_change_history')
        .select('*')
        .eq('sale_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.json({ source: 'supabase', history: data });
    }
    const db = readLocal();
    res.json({
      source: 'local',
      history: db.sale_change_history
        .filter((h) => h.sale_id === id)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Delete one sale (manual duplicate cleanup — never mass-auto). */
app.delete('/api/sales/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    if (supabase) {
      const { data: existing, error: gErr } = await supabase
        .from('sales')
        .select('*, sale_items(*)')
        .eq('id', id)
        .maybeSingle();
      if (gErr) throw gErr;
      if (!existing) return res.status(404).json({ error: 'not found' });
      const before = { ...existing, items: existing.sale_items || [] };
      const { error: dErr } = await supabase.from('sales').delete().eq('id', id);
      if (dErr) throw dErr;
      // Mirror local cache if present
      try {
        const db = readLocal();
        db.sales = (db.sales || []).filter((s) => s.id !== id);
        db.sale_items = (db.sale_items || []).filter((i) => i.sale_id !== id);
        writeLocal(db);
      } catch {
        /* local mirror optional */
      }
      return res.json({ source: 'supabase', deleted: id, before });
    }

    const db = readLocal();
    const before = saleSnapshot(db, id);
    if (!before) return res.status(404).json({ error: 'not found' });
    db.sale_change_history.push({
      id: db._seqs.history++,
      sale_id: id,
      action: 'delete',
      changed_by: req.body?.changed_by || 'recepción',
      before_data: before,
      after_data: null,
      context: req.body?.context || 'Venta quitada (revisión manual de duplicados)',
      created_at: new Date().toISOString(),
    });
    db.sales = db.sales.filter((s) => s.id !== id);
    db.sale_items = db.sale_items.filter((i) => i.sale_id !== id);
    writeLocal(db);
    res.json({ source: 'local', deleted: id, before });
  } catch (err) {
    console.error('[sales delete]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Mailbox of garment exchanges/edits, grouped by referencia / prenda.
 * Ventas = day-to-day sales; this endpoint = control of cambios across sales.
 */
app.get('/api/cambios', async (req, res) => {
  try {
    let catalog = [];
    let history = [];

    if (supabase) {
      const [{ data: cat, error: cErr }, { data: hist, error: hErr }] = await Promise.all([
        supabase.from('catalog_items').select('*').order('referencia'),
        supabase
          .from('sale_change_history')
          .select('*')
          .in('action', ['cambio', 'edit'])
          .order('created_at', { ascending: false }),
      ]);
      if (cErr) throw cErr;
      if (hErr) throw hErr;
      catalog = cat || [];
      history = hist || [];
    } else {
      const db = readLocal();
      catalog = [...(db.catalog_items || [])].sort((a, b) =>
        String(a.referencia).localeCompare(String(b.referencia))
      );
      history = (db.sale_change_history || [])
        .filter((h) => h.action === 'cambio' || h.action === 'edit')
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    }

    function refsFromSnapshot(data) {
      const items = data?.items || data?.sale_items || [];
      const refs = new Set();
      for (const it of items) {
        const r = String(it.referencia || '')
          .trim()
          .toUpperCase();
        if (r) refs.add(r);
      }
      return refs;
    }

    const byRef = new Map();
    for (const c of catalog) {
      const ref = String(c.referencia || '')
        .trim()
        .toUpperCase();
      if (!ref) continue;
      byRef.set(ref, {
        referencia: ref,
        referencia_ag: c.referencia_ag || c.descripcion || ref,
        descripcion: c.descripcion || '',
        changes: [],
      });
    }

    for (const h of history) {
      const refs = new Set([
        ...refsFromSnapshot(h.before_data),
        ...refsFromSnapshot(h.after_data),
      ]);
      if (!refs.size) {
        // Orphan history without item refs — skip garment mailbox
        continue;
      }
      const entry = {
        id: h.id,
        sale_id: h.sale_id,
        action: h.action,
        changed_by: h.changed_by,
        context: h.context,
        created_at: h.created_at,
        before_data: h.before_data,
        after_data: h.after_data,
      };
      for (const ref of refs) {
        if (!byRef.has(ref)) {
          byRef.set(ref, {
            referencia: ref,
            referencia_ag: ref,
            descripcion: '',
            changes: [],
          });
        }
        byRef.get(ref).changes.push(entry);
      }
    }

    const garments = [...byRef.values()].sort((a, b) =>
      a.referencia.localeCompare(b.referencia)
    );

    res.json({
      source: supabase ? 'supabase' : 'local',
      garments,
      totalChanges: history.length,
    });
  } catch (err) {
    console.error('[cambios]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* Product photos (local durable paths under /catalog-photos/…) */
const photosDir = path.join(__dirname, 'public', 'catalog-photos');
if (fs.existsSync(photosDir)) {
  app.use('/catalog-photos', express.static(photosDir, { maxAge: '7d' }));
}

/* Canva page exports for personal catalogs */
const canvaPagesDir = path.join(__dirname, 'public', 'canva-pages');
if (!fs.existsSync(canvaPagesDir)) fs.mkdirSync(canvaPagesDir, { recursive: true });
app.use('/canva-pages', express.static(canvaPagesDir, { maxAge: '1d' }));

/* Update garment fields and/or move section (genero) */
app.patch('/api/catalog/:id', async (req, res) => {
  const id = Number(req.params.id);
  const note = String(req.body?.note || req.body?.context || '').trim();
  const changedBy = String(req.body?.changed_by || 'sistema').trim();
  const fields = normalizeCatalogBody(req.body || {}, { partial: true });
  // Drop empty referencia from accidental partial payloads
  if (fields.referencia === '') delete fields.referencia;
  if (fields.genero !== undefined && !GENEROS.has(fields.genero)) {
    return res.status(400).json({
      error: `genero must be one of: ${[...GENEROS].join(', ')}`,
    });
  }
  if (!Object.keys(fields).length) {
    return res.status(400).json({ error: 'no fields to update' });
  }

  function recordHistory(db, before, after, action) {
    if (!Array.isArray(db.catalog_change_history)) db.catalog_change_history = [];
    if (!db._seqs.catalog_history) db._seqs.catalog_history = 1;
    db.catalog_change_history.push({
      id: db._seqs.catalog_history++,
      catalog_item_id: id,
      referencia: after.referencia || before.referencia,
      action,
      changed_by: changedBy,
      before_data: before,
      after_data: after,
      context:
        note ||
        (action === 'genero_move'
          ? `Movido de ${before.genero} → ${after.genero}`
          : 'Edición de prenda'),
      created_at: new Date().toISOString(),
    });
  }

  try {
    if (supabase) {
      const { data: before, error: bErr } = await supabase
        .from('catalog_items')
        .select('*')
        .eq('id', id)
        .single();
      if (bErr) throw bErr;
      if (!before) return res.status(404).json({ error: 'not found' });

      const onlyGenero =
        Object.keys(fields).length === 1 && fields.genero !== undefined;
      if (onlyGenero && before.genero === fields.genero) {
        return res.json({ source: 'supabase', item: before, unchanged: true });
      }

      const patch = { ...fields, updated_at: new Date().toISOString() };
      const { data: updated, error } = await supabase
        .from('catalog_items')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      const db = readLocal();
      const local = db.catalog_items.find(
        (c) => c.id === id || c.referencia === before.referencia
      );
      if (local) Object.assign(local, updated);
      const action =
        onlyGenero || (fields.genero && fields.genero !== before.genero)
          ? Object.keys(fields).every((k) => k === 'genero')
            ? 'genero_move'
            : 'edit'
          : 'edit';
      recordHistory(db, before, updated, action);
      writeLocal(db);
      return res.json({
        source: 'supabase',
        item: updated,
        from: before.genero,
        to: updated.genero,
      });
    }

    const db = readLocal();
    const item = db.catalog_items.find((c) => c.id === id);
    if (!item) return res.status(404).json({ error: 'not found' });
    const before = { ...item };
    const onlyGenero =
      Object.keys(fields).length === 1 && fields.genero !== undefined;
    if (onlyGenero && item.genero === fields.genero) {
      return res.json({ source: 'local', item, unchanged: true });
    }
    Object.assign(item, fields, { updated_at: new Date().toISOString() });
    const action =
      onlyGenero || (fields.genero && fields.genero !== before.genero)
        ? Object.keys(fields).every((k) => k === 'genero')
          ? 'genero_move'
          : 'edit'
        : 'edit';
    recordHistory(db, before, { ...item }, action);
    writeLocal(db);
    res.json({
      source: 'local',
      item,
      from: before.genero,
      to: item.genero,
    });
  } catch (err) {
    console.error('[catalog patch]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/catalog/:id/history', async (req, res) => {
  const id = Number(req.params.id);
  const db = readLocal();
  const history = (db.catalog_change_history || [])
    .filter((h) => h.catalog_item_id === id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  res.json({ source: 'local', history });
});

/* Canva personal-catalog mapping */
app.get('/api/canva/map', (_req, res) => {
  try {
    if (!fs.existsSync(CANVA_MAP_PATH)) {
      return res.status(404).json({ error: 'canva-page-map.json missing' });
    }
    const map = JSON.parse(fs.readFileSync(CANVA_MAP_PATH, 'utf8'));
    const pagesDir = path.join(__dirname, 'public', 'canva-pages');
    const files = fs.existsSync(pagesDir)
      ? fs.readdirSync(pagesDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      : [];
    res.json({
      map,
      localPages: files,
      pagesReady: files.length,
      designPageCount: map?.design?.pageCount || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * One-shot cleanup of true duplicate sales (same fecha + vendor + same lines).
 * Keeps the oldest sale in each group; dry_run defaults to true.
 * Optional body.vendedor filter (e.g. "Alejandra").
 */
app.post('/api/sales/dedupe', async (req, res) => {
  const dryRun = req.body?.dry_run !== false;
  const vendedor = String(req.body?.vendedor || '').trim() || null;
  try {
    let existingSales = [];
    if (supabase) {
      const { data: sales, error } = await supabase
        .from('sales')
        .select('*, sale_items(*)');
      if (error) throw error;
      existingSales = (sales || []).map((s) => ({
        ...s,
        vendedor_nombre: s.vendedor_nombre || s.sellers?.name,
        items: s.sale_items || [],
      }));
    } else {
      const db = readLocal();
      existingSales = db.sales.map((s) => ({
        ...s,
        items: db.sale_items.filter((i) => i.sale_id === s.id),
      }));
    }

    const groups = findDuplicateSaleGroups(existingSales, { vendedor });
    const deleteIds = groups.flatMap((g) => g.deleteIds);
    if (dryRun) {
      return res.json({
        ok: true,
        dry_run: true,
        source: supabase ? 'supabase' : 'local',
        vendedorFilter: vendedor,
        duplicateGroups: groups.length,
        wouldDelete: deleteIds.length,
        wouldKeep: groups.map((g) => g.keepId),
        groups,
      });
    }

    let deleted = 0;
    if (supabase) {
      for (const id of deleteIds) {
        // sale_items / history cascade via FK on delete
        const { error } = await supabase.from('sales').delete().eq('id', id);
        if (error) throw error;
        deleted += 1;
      }
      // Mirror local
      const db = readLocal();
      const del = new Set(deleteIds);
      db.sales = db.sales.filter((s) => !del.has(s.id));
      db.sale_items = db.sale_items.filter((i) => !del.has(i.sale_id));
      db.sale_change_history = (db.sale_change_history || []).filter(
        (h) => !del.has(h.sale_id)
      );
      writeLocal(db);
    } else {
      const db = readLocal();
      const del = new Set(deleteIds);
      for (const id of deleteIds) {
        const before = saleSnapshot(db, id);
        if (!before) continue;
        db.sale_change_history.push({
          id: db._seqs.history++,
          sale_id: id,
          action: 'delete',
          changed_by: 'dedupe:cleanup',
          before_data: before,
          after_data: null,
          context: 'Duplicate sale removed (kept oldest twin)',
          created_at: new Date().toISOString(),
        });
      }
      db.sales = db.sales.filter((s) => !del.has(s.id));
      db.sale_items = db.sale_items.filter((i) => !del.has(i.sale_id));
      // Keep history rows that reference deleted sales for audit; optional prune:
      // leave them — sale_id orphan is fine in local JSON.
      writeLocal(db);
      deleted = deleteIds.length;
    }

    res.json({
      ok: true,
      dry_run: false,
      source: supabase ? 'supabase' : 'local',
      vendedorFilter: vendedor,
      duplicateGroups: groups.length,
      deleted,
      kept: groups.map((g) => g.keepId),
      groups,
    });
  } catch (err) {
    console.error('[sales dedupe]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* Import historical sales (upsert-style: skip existing dedup keys; never wipe) */
app.post('/api/sales/import', async (req, res) => {
  const dryRun = req.body?.dry_run !== false; // default true
  try {
    const csv = loadDefaultCsv(__dirname);
    let catalogItems = [];
    let existingSales = [];

    if (supabase) {
      const { data: cat, error: cErr } = await supabase.from('catalog_items').select('*');
      if (cErr) throw cErr;
      catalogItems = cat || [];
      const { data: sales, error: sErr } = await supabase
        .from('sales')
        .select('*, sale_items(*)');
      if (sErr) throw sErr;
      existingSales = (sales || []).map((s) => ({
        ...s,
        items: s.sale_items || [],
      }));
    } else {
      const db = readLocal();
      catalogItems = db.catalog_items;
      existingSales = db.sales.map((s) => ({
        ...s,
        items: db.sale_items.filter((i) => i.sale_id === s.id),
      }));
    }

    const plan = buildImportPlan(csv, catalogItems, existingSales);
    if (dryRun) {
      return res.json({
        ok: true,
        dry_run: true,
        source: supabase ? 'supabase' : 'local',
        sourceRows: plan.sourceRows,
        wouldImportLines: plan.newLineCount,
        wouldCreateSales: plan.salesToCreate.length,
        skippedExisting: plan.skippedExisting,
        gapSummary: plan.gapSummary,
        uniqueRefsMissing: plan.uniqueRefsMissing,
        sampleSale: plan.salesToCreate[0] || null,
      });
    }

    // Ensure sellers exist
    const sellerNames = [
      ...new Set(
        plan.salesToCreate
          .map((s) => s.vendedor_nombre)
          .filter(Boolean)
          .map((n) => String(n).trim())
      ),
    ];
    const sellerIdByName = new Map();
    if (supabase) {
      const { data: sellers } = await supabase.from('sellers').select('*');
      for (const s of sellers || []) sellerIdByName.set(s.name.toLowerCase(), s.id);
      for (const name of sellerNames) {
        if (sellerIdByName.has(name.toLowerCase())) continue;
        const { data: created, error } = await supabase
          .from('sellers')
          .insert({ name, active: true })
          .select()
          .single();
        if (!error && created) {
          sellerIdByName.set(name.toLowerCase(), created.id);
          const db = readLocal();
          if (!db.sellers.find((x) => x.name.toLowerCase() === name.toLowerCase())) {
            db.sellers.push(created);
            writeLocal(db);
          }
        }
      }
    } else {
      for (const name of sellerNames) {
        const db = readLocal();
        let seller = db.sellers.find((s) => s.name.toLowerCase() === name.toLowerCase());
        if (!seller) {
          const created = addSellerLocal(name);
          if (!created.error) seller = created;
        }
        if (seller) sellerIdByName.set(name.toLowerCase(), seller.id);
      }
    }

    let importedSales = 0;
    let importedLines = 0;
    const createdIds = [];

    for (const saleBody of plan.salesToCreate) {
      const sellerId = saleBody.vendedor_nombre
        ? sellerIdByName.get(saleBody.vendedor_nombre.toLowerCase()) || null
        : null;
      const payload = {
        fecha_venta: saleBody.fecha_venta,
        seller_id: sellerId,
        vendedor_nombre: saleBody.vendedor_nombre,
        estado_pago: saleBody.estado_pago,
        fecha_pago: saleBody.fecha_pago,
        notas: saleBody.notas,
        items: saleBody.items.map((it) => ({
          catalog_item_id: it.catalog_item_id,
          referencia: it.referencia,
          descripcion: it.descripcion,
          talla: it.talla,
          cantidad: it.cantidad,
          precio_unitario: it.precio_unitario,
          tariff: it.tariff || 'tienda',
        })),
        changed_by: 'import:ventas-sheet',
      };

      // Reuse create paths
      const total = payload.items.reduce(
        (sum, it) => sum + Number(it.precio_unitario || 0) * Number(it.cantidad || 1),
        0
      );

      if (supabase) {
        const { data: sale, error } = await supabase
          .from('sales')
          .insert({
            fecha_venta: payload.fecha_venta,
            seller_id: payload.seller_id,
            vendedor_nombre: payload.vendedor_nombre,
            cliente: null,
            estado_pago: payload.estado_pago || 'PENDIENTE',
            fecha_pago: payload.fecha_pago || null,
            notas: payload.notas || null,
            total,
            payment_provider: null,
          })
          .select()
          .single();
        if (error) throw error;
        const itemRows = payload.items.map((it) => ({
          sale_id: sale.id,
          catalog_item_id: it.catalog_item_id || null,
          referencia: it.referencia,
          descripcion: it.descripcion,
          talla: it.talla,
          cantidad: Number(it.cantidad || 1),
          precio_unitario: Number(it.precio_unitario || 0),
          tariff: it.tariff || 'tienda',
        }));
        const { error: iErr } = await supabase.from('sale_items').insert(itemRows);
        if (iErr) throw iErr;
        await supabase.from('sale_change_history').insert({
          sale_id: sale.id,
          action: 'create',
          changed_by: 'import:ventas-sheet',
          before_data: null,
          after_data: { ...sale, items: itemRows },
          context: 'Import hoja AG INVENTARIO VENTAS',
        });
        createdIds.push(sale.id);
        importedSales += 1;
        importedLines += itemRows.length;
      } else {
        const after = createSaleLocal(payload, payload.items, total);
        createdIds.push(after.id);
        importedSales += 1;
        importedLines += (after.items || []).length;
      }
    }

    res.json({
      ok: true,
      dry_run: false,
      source: supabase ? 'supabase' : 'local',
      sourceRows: plan.sourceRows,
      importedSales,
      importedLines,
      skippedExisting: plan.skippedExisting,
      gapSummary: plan.gapSummary,
      uniqueRefsMissing: plan.uniqueRefsMissing,
      createdIds,
    });
  } catch (err) {
    console.error('[sales import]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* Apply image_url map (from PDF extract or sheet sync) */
app.post('/api/catalog/images', async (req, res) => {
  const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
  if (!updates.length) return res.status(400).json({ error: 'updates[] required' });
  try {
    let applied = 0;
    if (supabase) {
      for (const u of updates) {
        const ref = u.referencia;
        if (!ref) continue;
        const { error } = await supabase
          .from('catalog_items')
          .update({ image_url: u.image_url || null })
          .eq('referencia', ref);
        if (!error) applied += 1;
      }
    }
    const db = readLocal();
    const byRef = new Map(db.catalog_items.map((c) => [c.referencia, c]));
    for (const u of updates) {
      const row = byRef.get(u.referencia);
      if (row) {
        row.image_url = u.image_url || null;
        applied += supabase ? 0 : 1;
      }
    }
    writeLocal(db);
    // persist into seed for offline boots
    const seed = loadSeedCatalog();
    for (const s of seed) {
      const u = updates.find((x) => x.referencia === s.referencia);
      if (u) s.image_url = u.image_url || null;
    }
    fs.writeFileSync(SEED_PATH, `${JSON.stringify(seed, null, 2)}\n`);
    res.json({ ok: true, applied, source: supabase ? 'supabase+local' : 'local' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Static client */
const dist = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[ag] American Grace listening on http://0.0.0.0:${PORT}`);
});
