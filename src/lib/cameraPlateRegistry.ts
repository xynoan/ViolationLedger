import type { Vehicle } from '@/types/parking';

export type PlateRegistryStatus =
  | 'RESIDENT'
  | 'VISITOR'
  | 'UNREGISTERED'
  | 'DELIVERY'
  | 'DROPOFF';

/** Matches Visitors.tsx legacy delivery purposes. */
const PURPOSE_DELIVERY_LEGACY = ['pickup', 'package delivery'] as const;

function isLinkedResident(v: Vehicle): boolean {
  return v.residentId != null && String(v.residentId).trim() !== '';
}

function isDropoffPurpose(v: Vehicle): boolean {
  const raw = (v.purposeOfVisit || '').trim();
  if (!raw) return false;
  return /drop\s*-?\s*off|dropoff/i.test(raw);
}

function isDeliveryVisitor(v: Vehicle): boolean {
  if (isDropoffPurpose(v)) return false;
  const cat = String(v.visitorCategory || '').toLowerCase().trim();
  if (cat === 'delivery') return true;
  const lower = (v.purposeOfVisit || '').trim().toLowerCase();
  if (!lower) return false;
  if (PURPOSE_DELIVERY_LEGACY.some((p) => lower === p)) return true;
  if (lower.includes('deliver')) return true;
  return false;
}

/** Splits registry vehicles into camera overlay buckets (mutually exclusive by plate). */
export function partitionCameraPlateLists(vehicles: Vehicle[]) {
  const resident: string[] = [];
  const dropoff: string[] = [];
  const delivery: string[] = [];
  const visitor: string[] = [];
  for (const v of vehicles) {
    if (isLinkedResident(v)) {
      resident.push(v.plateNumber);
      continue;
    }
    if (isDropoffPurpose(v)) {
      dropoff.push(v.plateNumber);
    } else if (isDeliveryVisitor(v)) {
      delivery.push(v.plateNumber);
    } else {
      visitor.push(v.plateNumber);
    }
  }
  return {
    residentPlates: resident,
    dropoffPlates: dropoff,
    deliveryPlates: delivery,
    visitorPlates: visitor,
  };
}

export function resolvePlateRegistryStatus(
  normalized: string,
  resident: Set<string>,
  dropoff: Set<string>,
  delivery: Set<string>,
  visitor: Set<string>,
): PlateRegistryStatus {
  if (resident.has(normalized)) return 'RESIDENT';
  if (dropoff.has(normalized)) return 'DROPOFF';
  if (delivery.has(normalized)) return 'DELIVERY';
  if (visitor.has(normalized)) return 'VISITOR';
  return 'UNREGISTERED';
}
