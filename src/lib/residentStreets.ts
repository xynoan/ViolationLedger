/** Allowed street names for resident address (house number is separate). */
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
] as const;

export type ResidentStreetName = (typeof RESIDENT_STREET_OPTIONS)[number];

export const RESIDENT_STREET_SET = new Set<string>(RESIDENT_STREET_OPTIONS);

export function formatResidentAddressLine(r: {
  houseNumber?: string;
  streetName?: string;
  barangay?: string;
  city?: string;
  address?: string;
}): string {
  const h = (r.houseNumber || '').trim();
  const s = (r.streetName || '').trim();
  const b = (r.barangay || '').trim();
  const c = (r.city || '').trim();
  if (h || s || b || c) {
    const primary = [h, s].filter(Boolean).join(' ').trim();
    const secondary = [b, c].filter(Boolean).join(', ').trim();
    return [primary, secondary].filter(Boolean).join(', ');
  }
  return (r.address || '').trim();
}
