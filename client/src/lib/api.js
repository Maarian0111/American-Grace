async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || res.statusText || 'request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request('/api/health'),
  authStatus: () => request('/api/auth/status'),
  login: (body) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request('/api/auth/logout', { method: 'POST', body: '{}' }),
  catalog: () => request('/api/catalog'),
  seedCatalog: () => request('/api/catalog/seed', { method: 'POST' }),
  createCatalogItem: (body) =>
    request('/api/catalog', { method: 'POST', body: JSON.stringify(body) }),
  updateCatalogItem: (id, body) =>
    request(`/api/catalog/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  moveGenero: (id, genero, extra = {}) =>
    request(`/api/catalog/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ genero, ...extra }),
    }),
  canvaMap: () => request('/api/canva/map'),
  sellers: (all = false) => request(`/api/sellers${all ? '?all=1' : ''}`),
  addSeller: (name) =>
    request('/api/sellers', { method: 'POST', body: JSON.stringify({ name }) }),
  updateSeller: (id, body) =>
    request(`/api/sellers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  sales: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v != null)
    ).toString();
    return request(`/api/sales${q ? `?${q}` : ''}`);
  },
  sale: (id) => request(`/api/sales/${id}`),
  createSale: (body) =>
    request('/api/sales', { method: 'POST', body: JSON.stringify(body) }),
  updateSale: (id, body) =>
    request(`/api/sales/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  saleHistory: (id) => request(`/api/sales/${id}/history`),
  importSales: (dryRun = true) =>
    request('/api/sales/import', {
      method: 'POST',
      body: JSON.stringify({ dry_run: dryRun }),
    }),
  dedupeSales: (opts = {}) =>
    request('/api/sales/dedupe', {
      method: 'POST',
      body: JSON.stringify({
        dry_run: opts.dryRun !== false,
        vendedor: opts.vendedor || undefined,
      }),
    }),
  exportSalesXlsxUrl: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v != null)
    ).toString();
    return `/api/sales/export/xlsx${q ? `?${q}` : ''}`;
  },
};
