/** Keep in sync with src/lib/residentStreets.ts */
export const RESIDENT_STREET_OPTIONS = [
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

export const RESIDENT_STREET_SET = new Set(RESIDENT_STREET_OPTIONS);

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
