# Canva pages for personal catalogs

The live Canva design is **Catálogo AG 2026 Con Precios** (27 pages):

- Share link: https://canva.link/8ockpjdctcec9zr
- View URL: https://www.canva.com/design/DAHV78HJ17k/pzYYk-On78W7is23mEqq5g/view

Automated download from this environment is blocked (Cloudflare / login). Export pages locally, then drop them here.

## What Marian should export

1. Open the design in Canva (link above).
2. **Share → Download** as **PDF** (all pages) *or* export each page as **PNG**.
3. If you exported a multi-page PDF, split it into images named:

```text
page-01.png
page-02.png
…
page-27.png
```

   Tip: Preview on macOS / `pdftoppm -png catalogo.pdf page` then rename to the pattern above.

4. Put the PNGs in this folder (`public/canva-pages/`).
5. Edit `data/canva-page-map.json` → `byReferencia.<REF>.page` with the **1-based** page number for that SKU (and optionally set `file`).

Example:

```json
"S20144-BBS": {
  "referencia_ag": "ALBA DRESS",
  "page": 4,
  "file": "page-04.png",
  "notes": null
}
```

6. Redeploy / restart the app. In **Catálogo**, select prendas → **PDF Canva personal**.

The app composes only the mapped Canva pages for the selected referencias (it does not rebuild the Canva layout from scratch).
