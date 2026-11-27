export function formatCOP(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Resolve unit price for a tariff.
 * Prefer catalog fields; if mayorista/consignación missing, recalculate from precio_tienda
 * (mayorista = 30% off, consignación = 15% off).
 */
export function priceForTariff(item, tariff) {
  const tienda = Number(item?.precio_tienda) || 0;
  if (tariff === 'mayorista') {
    const stored = Number(item?.precio_mayorista);
    if (stored > 0) return stored;
    return Math.round(tienda * 0.7);
  }
  if (tariff === 'consignacion') {
    const stored = Number(item?.precio_consignacion);
    if (stored > 0) return stored;
    return Math.round(tienda * 0.85);
  }
  return tienda;
}

/** Mayorista = 30% off tienda; consignación = 15% off tienda. */
export function suggestPricesFromTienda(tiendaRaw) {
  const tienda = Math.round(Number(tiendaRaw) || 0);
  return {
    precio_tienda: tienda,
    precio_mayorista: Math.round(tienda * 0.7),
    precio_consignacion: Math.round(tienda * 0.85),
  };
}

export const TARIFF_OPTIONS = [
  { value: 'tienda', label: 'Tienda' },
  { value: 'mayorista', label: 'Mayorista (−30%)' },
  { value: 'consignacion', label: 'Consignación (−15%)' },
];

export function tariffLabel(tariff) {
  const hit = TARIFF_OPTIONS.find((t) => t.value === tariff);
  return hit ? hit.label : 'Tienda';
}
