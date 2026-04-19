import { getResidentStreetOptions } from './runtime_config.js';

export function getResidentStreetSet() {
  return new Set(getResidentStreetOptions());
}

export function composeResidentAddress(houseNumber, streetName, barangay, city) {
  const h = typeof houseNumber === 'string' ? houseNumber.trim() : '';
  const s = typeof streetName === 'string' ? streetName.trim() : '';
  const b = typeof barangay === 'string' ? barangay.trim() : '';
  const c = typeof city === 'string' ? city.trim() : '';
  const primary = [h, s].filter(Boolean).join(' ').trim();
  const secondary = [b, c].filter(Boolean).join(', ').trim();
  if (!primary && !secondary) return null;
  return [primary, secondary].filter(Boolean).join(', ') || null;
}
