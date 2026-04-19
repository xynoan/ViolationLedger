import { DEFAULT_RESIDENT_STREETS } from '@/lib/formOptionsDefaults';

/** Default street catalog (overridden by Settings → Form options when runtime config loads). */
export const RESIDENT_STREET_OPTIONS = DEFAULT_RESIDENT_STREETS as readonly string[];

export type ResidentStreetName = string;

export function buildResidentStreetSet(streets: string[]) {
  return new Set(streets);
}

/** @deprecated Use buildResidentStreetSet with runtime `residentStreets` from settings. */
export const RESIDENT_STREET_SET = new Set<string>(DEFAULT_RESIDENT_STREETS);

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
