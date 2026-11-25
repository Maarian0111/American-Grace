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

const PORT = Number(process.env.PORT) || 5000;
const SEED_PATH = path.join(__dirname, 'data', 'catalog-seed.json');
const LOCAL_DB_PATH = path.join(__dirname, 'data', 'local-db.json');

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
    _seqs: { sales: 1, sale_items: 1, history: 1, sellers: 5 },
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
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: hasSupabase ? 'supabase' : 'local',
    port: PORT,
  });
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

app.post('/api/catalog/seed', async (_req, res) => {
  try {
    const seed = loadSeedCatalog();
    if (supabase) {
      const rows = seed.map((s) => ({
        referencia: s.referencia,
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
      // Live table may lack UNIQUE(referencia); replace-all seed is safest
      const { error: delErr } = await supabase
        .from('catalog_items')
        .delete()
        .gte('id', 0);
      if (delErr) throw delErr;
      const { data, error } = await supabase.from('catalog_items').insert(rows).select();
      if (error) throw error;
      // Mirror locally
      const db = readLocal();
      db.catalog_items = (data || rows).map((r, i) => ({ id: r.id || i + 1, ...r }));
      writeLocal(db);
      return res.json({ ok: true, source: 'supabase', count: (data || rows).length });
    }
    // Local seed: refresh catalog only — keep sales/sellers/history intact
    const db = readLocal();
    db.catalog_items = seed.map((item, i) => ({ id: i + 1, ...item }));
    writeLocal(db);
    res.json({ ok: true, source: 'local', count: db.catalog_items.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─── Sellers ───────────────────────────────────────────────────── */
app.get('/api/sellers', async (_req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('sellers')
        .select('*')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      if (data?.length) return res.json({ source: 'supabase', sellers: data });
    }
    const db = readLocal();
    res.json({
      source: 'local',
      sellers: db.sellers.filter((s) => s.active !== false),
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

/* Product photos (local durable paths under /catalog-photos/…) */
const photosDir = path.join(__dirname, 'public', 'catalog-photos');
if (fs.existsSync(photosDir)) {
  app.use('/catalog-photos', express.static(photosDir, { maxAge: '7d' }));
}

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
