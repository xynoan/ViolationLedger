import type { Violation } from '@/types/parking';

/** Same normalization as server `normalizePlateForMatch` for lookup keys. */
export function plateLocationKey(plateNumber: string, locationId: string): string {
  return `${String(plateNumber).replace(/\s+/g, '').toUpperCase()}-${locationId}`;
}

export type RecentPlateEntry = {
  plateNumber: string;
  locationId: string;
  timestamp: string;
  detectionId?: string;
  cameraId?: string;
  vehicleClass?: string;
  imageUrl?: string | null;
};

/**
 * True if recent-plates entries include this plate at this location (newest-per-pair list from API).
 * When `graceEndsAtMs` is set, the detection must be at/after grace end — same gate as the server's
 * post-grace presence check (avoids matching a sighting that is still within 15m but before grace ended).
 */
export function recentPlateEntriesMatchViolation(
  entries: RecentPlateEntry[],
  plateNumber: string,
  cameraLocationId: string,
  graceEndsAtMs?: number | null,
): boolean {
  if (!plateNumber || plateNumber === 'NONE' || plateNumber === 'BLUR') return false;
  const key = plateLocationKey(plateNumber, cameraLocationId);
  return entries.some((e) => {
    if (plateLocationKey(e.plateNumber, e.locationId) !== key) return false;
    if (graceEndsAtMs != null && Number.isFinite(graceEndsAtMs)) {
      const t = new Date(e.timestamp).getTime();
      if (Number.isNaN(t) || t < graceEndsAtMs) return false;
    }
    return true;
  });
}

/** Attach `lastPlateDetectionAt` from `GET /detections/recent-plates` entries. */
export function mergeViolationsWithRecentPlates(
  violations: Violation[],
  entries: RecentPlateEntry[],
): Violation[] {
  const map = new Map<string, Date>();
  for (const e of entries) {
    const key = plateLocationKey(e.plateNumber, e.locationId);
    if (!map.has(key)) {
      map.set(key, new Date(e.timestamp));
    }
  }
  return violations.map((v) => ({
    ...v,
    lastPlateDetectionAt: map.get(plateLocationKey(v.plateNumber, v.cameraLocationId)),
  }));
}
