/**
 * Simple reception auth: APP_PASSWORD (+ optional APP_USER), HMAC cookie session.
 */
const crypto = require('crypto');

const COOKIE_NAME = 'ag_session';
const DEFAULT_SOFT_PASSWORD = 'american-grace';
const SESSION_DAYS = 14;

function configuredPassword() {
  const raw = process.env.APP_PASSWORD;
  if (raw != null && String(raw).trim() !== '') return String(raw);
  return null;
}

function authConfig() {
  const password = configuredPassword();
  const softLock = !password;
  const effectivePassword = password || DEFAULT_SOFT_PASSWORD;
  const user = process.env.APP_USER != null ? String(process.env.APP_USER).trim() : '';
  const secret =
    process.env.SESSION_SECRET ||
    process.env.APP_PASSWORD ||
    `ag-dev-${DEFAULT_SOFT_PASSWORD}`;
  return {
    softLock,
    password: effectivePassword,
    userRequired: Boolean(user),
    expectedUser: user,
    secret,
    cookieName: COOKIE_NAME,
  };
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

function signPayload(payloadObj, secret) {
  const payload = b64url(JSON.stringify(payloadObj));
  const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(fromB64url(payload).toString('utf8'));
    if (!data || !data.exp || Date.now() > Number(data.exp)) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function createSessionToken(username, secret) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  return signPayload({ u: username || 'reception', exp }, secret);
}

function sessionCookieHeader(token, { clear = false } = {}) {
  const maxAge = clear ? 0 : SESSION_DAYS * 24 * 60 * 60;
  const parts = [
    `${COOKIE_NAME}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function readSession(req, cfg = authConfig()) {
  const cookies = parseCookies(req.headers.cookie);
  return verifyToken(cookies[COOKIE_NAME], cfg.secret);
}

function credentialsOk(body, cfg = authConfig()) {
  const password = String(body?.password || '');
  const username = String(body?.username || body?.user || '').trim();
  if (cfg.userRequired) {
    if (username.toLowerCase() !== cfg.expectedUser.toLowerCase()) return false;
  }
  const a = Buffer.from(password);
  const b = Buffer.from(cfg.password);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isPublicApi(req) {
  if (req.method === 'GET' && req.path === '/api/health') return true;
  if (req.method === 'GET' && req.path === '/api/auth/status') return true;
  if (req.method === 'POST' && req.path === '/api/auth/login') return true;
  if (req.method === 'POST' && req.path === '/api/auth/logout') return true;
  return false;
}

function isMutating(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
}

/**
 * Protect mutating /api/* routes. Read GETs stay open for catalog browsing
 * after login gate on the SPA; mutations always need a session.
 */
function authMiddleware(req, res, next) {
  if (!req.path.startsWith('/api')) return next();
  if (isPublicApi(req)) return next();
  if (!isMutating(req.method)) return next();

  const cfg = authConfig();
  const session = readSession(req, cfg);
  if (!session) {
    return res.status(401).json({
      error: 'auth_required',
      message: 'Inicia sesión para modificar datos.',
    });
  }
  req.auth = session;
  next();
}

module.exports = {
  authConfig,
  authMiddleware,
  credentialsOk,
  createSessionToken,
  sessionCookieHeader,
  readSession,
  COOKIE_NAME,
  DEFAULT_SOFT_PASSWORD,
};
