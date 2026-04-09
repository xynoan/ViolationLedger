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

export function composeResidentAddress(houseNumber, streetName) {
  const h = typeof houseNumber === 'string' ? houseNumber.trim() : '';
  const s = typeof streetName === 'string' ? streetName.trim() : '';
  if (!h && !s) return null;
  return [h, s].filter(Boolean).join(' ').trim() || null;
}
