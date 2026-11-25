export function formatCOP(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

export function priceForTariff(item, tariff) {
  if (tariff === 'mayorista') return Number(item.precio_mayorista) || 0;
  if (tariff === 'consignacion') return Number(item.precio_consignacion) || 0;
  return Number(item.precio_tienda) || 0;
}
