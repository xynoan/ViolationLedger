import type { Vehicle } from '@/types/parking';
import type { VisitorPurposePreset } from '@/types/dropdownCatalog';

export const PURPOSE_OTHER = 'Other';

export const PURPOSE_DELIVERY_LEGACY = ['Pickup', 'Package delivery'] as const;
export const PURPOSE_RENTAL_LEGACY = ['Short-term rental', 'Event parking', 'Overnight stay'] as const;

export function presetPurposeStorageValues(presets: VisitorPurposePreset[]) {
  return presets.map((p) => p.storageValue);
}

export function apiVisitorCategory(
  purposeValue: string,
  rented: string,
  presets: VisitorPurposePreset[],
): 'guest' | 'delivery' | 'rental' {
  const p = purposeValue.trim();
  const pl = p.toLowerCase();
  const r = rented.trim();

  const presetHit = presets.find(
    (pr) => pr.storageValue === p || pr.storageValue.toLowerCase() === pl || pr.label.toLowerCase() === pl,
  );
  if (presetHit) return presetHit.category;

  if (p === 'Visit resident') return 'guest';

  if (p === 'Delivery' || p === 'Drop-off') return 'delivery';
  if (PURPOSE_DELIVERY_LEGACY.some((x) => x.toLowerCase() === pl)) return 'delivery';
  if (pl.includes('deliver')) return 'delivery';

  if (p === 'Reservation' || PURPOSE_RENTAL_LEGACY.some((x) => x.toLowerCase() === pl)) return 'rental';
  if (r) return 'rental';

  return 'guest';
}

export function deriveVisitorPurposeTab(
  v: Pick<Vehicle, 'purposeOfVisit' | 'visitorCategory' | 'rented'>,
  presets: VisitorPurposePreset[],
): string {
  const raw = (v.purposeOfVisit || '').trim();
  const lower = raw.toLowerCase();

  for (const pr of presets) {
    if (lower === pr.storageValue.toLowerCase()) return pr.storageValue;
    if (lower === pr.label.toLowerCase()) return pr.storageValue;
  }

  for (const label of PURPOSE_DELIVERY_LEGACY) {
    if (label.toLowerCase() === lower) return 'Delivery';
  }
  for (const label of PURPOSE_RENTAL_LEGACY) {
    if (label.toLowerCase() === lower) return 'Reservation';
  }

  if (v.visitorCategory?.toLowerCase() === 'rental' || (v.rented && String(v.rented).trim())) {
    return 'Reservation';
  }
  if (v.visitorCategory?.toLowerCase() === 'delivery') return 'Delivery';
  if (lower.includes('deliver')) return 'Delivery';

  if (raw) return PURPOSE_OTHER;
  return presets[0]?.storageValue ?? 'Visit resident';
}

export function normalizePurposeForForm(
  raw: string,
  presets: VisitorPurposePreset[],
): { purposeOfVisit: string; purposeOfVisitOther: string } {
  const t = raw.trim();
  const first = presets[0]?.storageValue ?? 'Visit resident';
  if (!t) return { purposeOfVisit: first, purposeOfVisitOther: '' };
  const hit = presets.find(
    (x) => x.storageValue.toLowerCase() === t.toLowerCase() || x.label.toLowerCase() === t.toLowerCase(),
  );
  if (hit) return { purposeOfVisit: hit.storageValue, purposeOfVisitOther: '' };
  return { purposeOfVisit: PURPOSE_OTHER, purposeOfVisitOther: t };
}

export function showVisitorAuxLocationField(
  purposeOfVisit: string,
  purposeOfVisitOther: string,
  presets: VisitorPurposePreset[],
  editingVehicleRented?: string | null,
): boolean {
  const pr = presets.find((x) => x.storageValue === purposeOfVisit);
  if (pr?.rentedFieldMode === 'resident' || pr?.rentedFieldMode === 'facility') return true;
  if (PURPOSE_RENTAL_LEGACY.some((x) => x === purposeOfVisit)) return true;
  if (
    purposeOfVisit === PURPOSE_OTHER &&
    PURPOSE_RENTAL_LEGACY.some((x) => x === purposeOfVisitOther.trim())
  ) {
    return true;
  }
  return Boolean(editingVehicleRented?.trim());
}

/** Tab / form value used for "visiting a resident" (first preset that asks for resident search). */
export function getVisitResidentStorageValue(presets: VisitorPurposePreset[]) {
  const hit = presets.find((p) => p.rentedFieldMode === 'resident');
  if (hit) return hit.storageValue;
  return presets.find((p) => p.id === 'visit_resident')?.storageValue ?? 'Visit resident';
}

/** True if this stored purpose is the resident-visit flow (any preset using resident search). */
export function isResidentVisitPurpose(purposeRaw: string, presets: VisitorPurposePreset[]): boolean {
  const p = purposeRaw.trim();
  const pl = p.toLowerCase();
  return presets.some(
    (pr) =>
      pr.rentedFieldMode === 'resident' &&
      (pl === pr.storageValue.toLowerCase() || pl === pr.label.toLowerCase()),
  );
}

export function matchesPresetStorage(
  purposeRaw: string,
  presetId: string,
  presets: VisitorPurposePreset[],
): boolean {
  const pr = presets.find((x) => x.id === presetId);
  if (!pr) return false;
  const p = purposeRaw.trim();
  const pl = p.toLowerCase();
  return pl === pr.storageValue.toLowerCase() || pl === pr.label.toLowerCase();
}
