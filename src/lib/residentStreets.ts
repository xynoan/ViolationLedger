import { DEFAULT_DROPDOWN_CATALOG } from '@/types/dropdownCatalog';

/** Default street names when the server catalog is unavailable. */
export const RESIDENT_STREET_OPTIONS = DEFAULT_DROPDOWN_CATALOG.residentStreets;

export type ResidentStreetName = string;

export function residentStreetSetFromList(streets: readonly string[]) {
  return new Set<string>(streets);
}

/** @deprecated Use `residentStreetSetFromList` with streets from `useDropdownOptions`. */
export const RESIDENT_STREET_SET = residentStreetSetFromList(RESIDENT_STREET_OPTIONS);

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
