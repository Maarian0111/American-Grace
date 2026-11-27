#!/usr/bin/env node
/**
 * Dry-run / apply duplicate sale cleanup via API.
 *
 *   node scripts/dedupe-sales.mjs
 *   node scripts/dedupe-sales.mjs --apply
 *   node scripts/dedupe-sales.mjs --vendedor=Alejandra --apply
 *
 * Requires a running server and a valid session cookie if APP_PASSWORD is set.
 * For CI/scripts against soft-lock local: logs in automatically.
 */
const base = process.env.AG_API || 'http://127.0.0.1:5000';
const apply = process.argv.includes('--apply');
const vendArg = process.argv.find((a) => a.startsWith('--vendedor='));
const vendedor = vendArg ? vendArg.slice('--vendedor='.length) : 'Alejandra';

async function loginIfNeeded() {
  const status = await fetch(`${base}/api/auth/status`).then((r) => r.json());
  if (status.authenticated) return '';
  const password = process.env.APP_PASSWORD || 'american-grace';
  const body = { password };
  if (status.userRequired && process.env.APP_USER) body.username = process.env.APP_USER;
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'login failed');
  return cookie;
}

async function main() {
  const cookie = await loginIfNeeded();
  const res = await fetch(`${base}/api/sales/dedupe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ dry_run: !apply, vendedor }),
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
  if (!res.ok || data.ok === false) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
