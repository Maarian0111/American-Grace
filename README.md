# American Grace — Inventario & Ventas

Boutique inventory and sales app for children’s clothing (American Grace).

**GitHub:** https://github.com/Maarian0111/American-Grace  
**Live:** https://american-grace.onrender.com/

## Stack

- **Root:** Node.js + Express on port `5000` (API + `client/dist`)
- **Client:** React + Vite (`client/`)
- **DB:** Supabase via `@supabase/supabase-js` (optional — app runs on local seed without credentials)
- **Auth:** Simple reception gate (`APP_PASSWORD`, optional `APP_USER`) with HttpOnly session cookie

## Quick start (local)

```bash
cp .env.example .env   # optional: fill SUPABASE_* and APP_PASSWORD
npm install            # also installs client deps (postinstall)
npm run build --prefix client
npm start              # http://localhost:5000
```

Without Supabase env vars, the app uses `data/catalog-seed.json` and persists to `data/local-db.json` (gitignored).

### Reception login

| Env | Purpose |
|-----|---------|
| `APP_PASSWORD` | Required in production. Password for the login screen. |
| `APP_USER` | Optional. If set, login also requires this username. |
| `SESSION_SECRET` | Optional. Signs the session cookie (defaults from `APP_PASSWORD`). |

If `APP_PASSWORD` is **unset** locally, the server uses a **soft-lock** password `american-grace` (logged at boot) and still shows the login form. On **Render / production**, an unset `APP_PASSWORD` does **not** soft-lock: the SPA shows setup instructions until Marian adds `APP_PASSWORD` in Render Environment and redeploys.

Mutating API routes (`POST` / `PUT` / `PATCH` / `DELETE` under `/api`) require a valid session cookie. The SPA always shows a login (or setup) gate before the app when there is no session.

## Deploy on Render (free)

1. Open [Render Dashboard](https://dashboard.render.com/) → **New +** → **Web Service**.
2. Connect **GitHub** and select this repo: `Maarian0111/American-Grace`.
3. Settings:
   - **Build Command:** `npm install && npm run build --prefix client`
   - **Start Command:** `npm start`
   - **Instance type:** Free
4. **Environment** (Environment → Environment Variables) — paste values from your private `.env` / Supabase dashboard; **do not commit secrets**:

   | Name | Notes |
   |------|--------|
   | `PORT` | Usually set by Render automatically; if you set it, use `5000` or match Render’s value |
   | `SUPABASE_URL` | Supabase project URL |
   | `SUPABASE_ANON_KEY` | Supabase anon / publishable key |
   | `APP_PASSWORD` | Strong reception password (required for production) |
   | `APP_USER` | Optional username |
   | `SESSION_SECRET` | Optional long random string for cookie signing |

5. Deploy. After the first deploy succeeds, open the service URL Render assigns and log in with `APP_PASSWORD`.

Optional: this repo includes [`render.yaml`](render.yaml) for Blueprint-style setup (`New` → `Blueprint`). Env values still must be entered in the Render dashboard (`sync: false`).

### Product photos on Render

Catalog photos ship in the repo under `public/catalog-photos/` and are served at **`/catalog-photos/{referencia}.jpg`**. The Vite client also keeps a copy under `client/public/catalog-photos/` for the build. No extra storage config is required for the bundled photos.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run [`sql/schema.sql`](sql/schema.sql). If `catalog_items` already exists partially, run [`sql/apply-remaining.sql`](sql/apply-remaining.sql) instead (sellers, sales, history, `image_url`, unique on `referencia`).
3. Copy project URL and anon/publishable key into `.env` locally or into Render env vars (never commit `.env`):

```env
PORT=5000
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=your-anon-or-publishable-key
APP_PASSWORD=change-me-in-production
```

4. Restart / redeploy, open the app, log in, click **Sync catálogo** (`POST /api/catalog/seed`).

**Sync catálogo** upserts from `data/catalog-seed.json` by `referencia` (updates prices/stock/fields). It does **not** delete catalog rows (protects `sale_items` FK) and is **not** a live Excel/Sheet sync. Sales from Excel use Ventas → **Actualizar ventas desde Excel**.

DDL cannot be applied with the anon key alone; use the SQL Editor (or a real DB password / service role — do not put passwords in git).

## API overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Mode: `local` \| `supabase` |
| GET | `/api/auth/status` | Session status |
| POST | `/api/auth/login` | Set session cookie |
| POST | `/api/auth/logout` | Clear session |
| GET | `/api/catalog` | List catalog items |
| POST | `/api/catalog` | Create garment (auth) |
| POST | `/api/catalog/seed` | Upsert seed JSON by `referencia` (never deletes catalog rows) |
| PATCH | `/api/catalog/:id` | Edit garment / move section (`genero`) |
| GET | `/api/canva/map` | Canva page map + local page files |
| GET | `/api/sellers` | List sellers (`?all=1` includes inactive) |
| POST | `/api/sellers` | Add seller |
| PATCH | `/api/sellers/:id` | Edit name / active |
| GET | `/api/sales` | List/filter sales (`from`, `to`, `seller_id`, `estado`) |
| POST | `/api/sales` | Create sale + history |
| POST | `/api/sales/import` | Import sheet CSV (`dry_run` default true) |
| POST | `/api/sales/dedupe` | Review duplicate groups (`dry_run` default true; mass apply scripts only) |
| GET | `/api/sales/:id` | Sale detail |
| PUT | `/api/sales/:id` | Edit / cambio / estado + audit |
| DELETE | `/api/sales/:id` | Remove one sale (manual duplicate cleanup) |
| GET | `/api/sales/:id/history` | Per-sale change history |
| GET | `/api/cambios` | Buzón por prenda: ventas asociadas + historial registrado (roles salió/entró) |
| GET | `/api/sales/export/xlsx` | Excel export |

## Features

- Hybrid catalog (local seed + Sync) with **add/edit garment form** (3 prices: tienda / mayorista 30% off / consignación 15% off)
- Real-time search + category filter (Niña / Niño-Unisex / Accesorios)
- Move garments between sections (persists `catalog_items.genero`)
- Multi-tariff PDF catalog + personal Canva-page PDF (offline export path; Canva files deferred)
- Sales sheet: day-to-day ventas with **Editar** / **Cambio** (starts exchange; talla required per line); refresh from DB; Excel import
- **Historial de cambios** tab: per-garment mailbox — associated sales (pick sale → apply cambio) + registered history
- Review possible duplicates (per-row keep/remove — no mass auto-delete in UI)
- Sellers: create + edit name/active
- PDF + XLSX sales export
- Manual payment status (Bancolombia extension point in schema + UI comments)
- Product photos via `/catalog-photos/…`

## Sales import & dedupe

Fuente: pestaña VENTAS del Sheet (CSV embebido en `data/imports/ventas-sheet.csv`). Dedupe por `fecha|vendedor|ref|talla|cant` (normalizado) y por fingerprint de venta completa.

```bash
npm run import-sales              # dry-run
npm run import-sales:apply        # apply via API
npm run dedupe-sales              # review duplicate groups (Alejandra filter)
npm run dedupe-sales:apply        # script-only mass delete of true twins (keeps oldest)
```

UI (recepción): Ventas → **Refrescar lista** / **Actualizar ventas desde Excel** / **Revisar duplicados** (elige quitar por fila) / **Cambio**. Tab **Historial de cambios** = buzón por prenda (ventas asociadas + historial).

If Google Sheet sharing blocks automated refresh, re-export the VENTAS tab to `data/imports/ventas-sheet.csv` manually and re-run the probe.

## Seed source

Catalog prices extracted from `Lista_de_precios_AG.pdf`. Stock totals merged from `INV_INICIAL.pdf` where references matched. Sales sheet columns follow `AG_INVENTARIO_VENTAS.pdf`.

## Product photos

- Bundled JPEGs: `public/catalog-photos/{referencia}.jpg` → URL path `/catalog-photos/…` (`image_url` on catalog).
- Google Sheet sync (needs link sharing or local CSV): `node scripts/sync-sheet-images.mjs --apply`

## Project layout

```
.
  server.js
  package.json
  render.yaml
  .env.example
  data/catalog-seed.json
  data/canva-page-map.json
  data/imports/ventas-sheet.csv
  lib/auth.js
  lib/ventas-import.js
  scripts/import-sales.mjs
  scripts/dedupe-sales.mjs
  sql/schema.sql
  public/catalog-photos/
  public/canva-pages/   # Marian: export Canva PNGs here (deferred)
  client/               # Vite React app
  README.md
```

## Canva personal catalog (deferred)

Design: [canva.link/8ockpjdctcec9zr](https://canva.link/8ockpjdctcec9zr) (*Catálogo AG 2026 Con Precios*, 27 pages). Automated page download needs Canva auth; export PNGs into `public/canva-pages/` and fill `data/canva-page-map.json` — see `public/canva-pages/README.md`. Collections / catalogs-of-garments remain a future stub.
