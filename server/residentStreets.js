import { getDropdownConfig } from './dropdown_config.js';

const FALLBACK_STREETS = [
  'Twin Peaks Drive',
  'Milky Way Drive',
  'Moonlight Loop',
  "Comet's Loop",
  'Hillside Loop',
  'Starline Road',
  'Evening Glow Road',
  'Milky Way Lane',
  'Hillside Lane',
  'Starline Road Alley',
  'Promenade Lane',
  'Riverside Drive',
  'Riverview Drive',
  'Union Lane',
];

export function getAllowedResidentStreets() {
  try {
    const streets = getDropdownConfig().residentStreets;
    return Array.isArray(streets) && streets.length ? streets : FALLBACK_STREETS;
  } catch {
    return FALLBACK_STREETS;
  }
}

export function getResidentStreetSet() {
  return new Set(getAllowedResidentStreets());
}

/** @deprecated Use `getAllowedResidentStreets()` (catalog may change at runtime). */
export const RESIDENT_STREET_OPTIONS = FALLBACK_STREETS;

/** @deprecated Use `getResidentStreetSet()`. */
export const RESIDENT_STREET_SET = new Set(FALLBACK_STREETS);

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
