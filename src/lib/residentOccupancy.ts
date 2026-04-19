import type { Resident } from '@/types/parking';
import type { LabeledValue } from '@/types/dropdownCatalog';

/** Canonical value slug from catalog, or first catalog entry / homeowner fallback. */
export function normalizeResidentTypeValue(raw: string | undefined, types: LabeledValue[]): string {
  const list = Array.isArray(types) && types.length ? types : [{ value: 'homeowner', label: 'Homeowner' }];
  const t = (raw || '').trim().toLowerCase();
  const hit = list.find((x) => String(x.value).toLowerCase() === t);
  if (hit) return hit.value;
  return list[0]?.value ?? 'homeowner';
}

export function residentOccupancyLabel(value: string, types: LabeledValue[]): string {
  const hit = types.find((x) => String(x.value).toLowerCase() === String(value).toLowerCase());
  return hit?.label ?? value;
}

export function residentOccupancyBadgeClass(value: string): string {
  const v = String(value).toLowerCase();
  if (v === 'tenant') {
    return 'border-purple-600/55 bg-purple-600 text-white shadow-none hover:bg-purple-600/95 dark:bg-purple-700';
  }
  if (v === 'homeowner') {
    return 'border-blue-600/55 bg-blue-600 text-white shadow-none hover:bg-blue-600/95 dark:bg-blue-700';
  }
  return 'border-slate-500/50 bg-slate-600 text-white shadow-none hover:bg-slate-600/90 dark:bg-slate-700';
}

export function resolveResidentTypeForDisplay(r: Resident, types: LabeledValue[]): string {
  return normalizeResidentTypeValue(r.residentType, types);
}
