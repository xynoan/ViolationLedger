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
