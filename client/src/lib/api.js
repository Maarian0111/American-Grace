async function request(path, options = {}) {
  const res = await fetch(path, {
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
    throw new Error(data?.error || res.statusText || 'request failed');
  }
  return data;
}

export const api = {
  health: () => request('/api/health'),
  catalog: () => request('/api/catalog'),
  seedCatalog: () => request('/api/catalog/seed', { method: 'POST' }),
  moveGenero: (id, genero, extra = {}) =>
    request(`/api/catalog/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ genero, ...extra }),
    }),
  canvaMap: () => request('/api/canva/map'),
  sellers: () => request('/api/sellers'),
  addSeller: (name) =>
    request('/api/sellers', { method: 'POST', body: JSON.stringify({ name }) }),
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
  exportSalesXlsxUrl: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v != null)
    ).toString();
    return `/api/sales/export/xlsx${q ? `?${q}` : ''}`;
  },
};
