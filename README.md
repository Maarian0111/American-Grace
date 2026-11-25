# American Grace — Inventario & Ventas

Boutique inventory and sales app for children’s clothing (American Grace).

**GitHub:** https://github.com/Maarian0111/American-Grace

## Stack

- **Root:** Node.js + Express on port `5000` (API + `client/dist`)
- **Client:** React + Vite (`client/`)
- **DB:** Supabase via `@supabase/supabase-js` (optional — app runs on local seed without credentials)

## Quick start (local)

```bash
cp .env.example .env   # optional: fill SUPABASE_* for cloud sync
npm install            # also installs client deps (postinstall)
npm run build --prefix client
npm start              # http://localhost:5000
```

Without Supabase env vars, the app uses `data/catalog-seed.json` and persists to `data/local-db.json` (gitignored).

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

5. Deploy. After the first deploy succeeds, open the service URL Render assigns.

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
```

4. Restart / redeploy, open the app, click **Sync catálogo** (`POST /api/catalog/seed`).

DDL cannot be applied with the anon key alone; use the SQL Editor (or a real DB password / service role — do not put passwords in git).

## API overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Mode: `local` \| `supabase` |
| GET | `/api/catalog` | List catalog items |
| POST | `/api/catalog/seed` | Upsert seed JSON → Supabase / local |
| GET | `/api/sellers` | List sellers |
| POST | `/api/sellers` | Add seller |
| GET | `/api/sales` | List/filter sales (`from`, `to`, `seller_id`, `estado`) |
| POST | `/api/sales` | Create sale + history |
| GET | `/api/sales/:id` | Sale detail |
| PUT | `/api/sales/:id` | Edit / cambio / estado + audit |
| GET | `/api/sales/:id/history` | Change history |
| GET | `/api/sales/export/xlsx` | Excel export |

## Features

- Hybrid catalog (local seed + Sync)
- Real-time search + category filter (Niña / Niño-Unisex / Accesorios)
- Multi-tariff PDF catalog (tienda / mayorista / consignación)
- Sales sheet with date/seller filters, edit & garment exchange audit
- PDF + XLSX sales export
- Manual payment status (Bancolombia extension point in schema + UI comments)
- Product photos via `/catalog-photos/…`

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
  sql/schema.sql
  public/catalog-photos/
  client/          # Vite React app
  README.md
```
