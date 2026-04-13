import type { Violation } from '@/types/parking';

/** Logical enforcement sub-zones inside Barangay Blue Ridge B. */
export type HeatmapZoneId = 'twinPeaks' | 'moonlight' | 'riverview' | 'comet';

/** Barangay boundary (Katipunan / Bonny Serrano / ridge), counter-clockwise on the sphere projection used by Maps. */
export const BLUE_RIDGE_B_BOUNDARY: google.maps.LatLngLiteral[] = [
  { lat: 14.6205, lng: 121.0735 }, // Northwest — Katipunan
  { lat: 14.6145, lng: 121.0725 }, // Southwest — Katipunan / Bonny Serrano
  { lat: 14.614, lng: 121.079 }, // Southeast — ridge edge
  { lat: 14.6185, lng: 121.0805 }, // Northeast — Riverview ridge
];

const HUB: google.maps.LatLngLiteral = { lat: 14.6172, lng: 121.0755 };

const NW = BLUE_RIDGE_B_BOUNDARY[0];
const SW = BLUE_RIDGE_B_BOUNDARY[1];
const SE = BLUE_RIDGE_B_BOUNDARY[2];
const NE = BLUE_RIDGE_B_BOUNDARY[3];

/**
 * Four triangular sub-zones that tile the barangay quad (hub + two corners each).
 * Coordinates align with Twin Peaks (SW–NW), Moonlight (SW–SE), Riverview (SE–NE), Comet (NE–NW).
 */
export const BLUE_RIDGE_ZONE_POLYGONS: Record<
  HeatmapZoneId,
  { street: string; paths: google.maps.LatLngLiteral[] }
> = {
  twinPeaks: {
    street: 'Twin Peaks Dr',
    paths: [SW, NW, HUB, SW],
  },
  moonlight: {
    street: 'Moonlight Loop',
    paths: [SE, SW, HUB, SE],
  },
  riverview: {
    street: 'Riverview Dr',
    paths: [NE, SE, HUB, NE],
  },
  comet: {
    street: "Comet's Loop",
    paths: [NW, NE, HUB, NW],
  },
};

/** Representative GPS for a camera / LocationID site (inside the matching sub-zone). */
const ZONE_SITE: Record<HeatmapZoneId, google.maps.LatLngLiteral> = {
  twinPeaks: { lat: 14.6168, lng: 121.0734 },
  moonlight: { lat: 14.6156, lng: 121.0758 },
  riverview: { lat: 14.6165, lng: 121.0788 },
  comet: { lat: 14.6192, lng: 121.0768 },
};

/** Map API / camera location ids to a zone (extend when adding cameras). */
export const LOCATION_ID_TO_ZONE: Record<string, HeatmapZoneId> = {
  'LOC-001': 'twinPeaks',
  'LOC-002': 'moonlight',
  'LOC-003': 'riverview',
  'LOC-004': 'comet',
  'loc-001': 'twinPeaks',
  'loc-002': 'moonlight',
  'loc-003': 'riverview',
  'loc-004': 'comet',
};

export function resolveHeatmapZone(locationId: string): HeatmapZoneId | null {
  const raw = locationId.trim();
  const lower = raw.toLowerCase();
  if (LOCATION_ID_TO_ZONE[raw]) return LOCATION_ID_TO_ZONE[raw];
  if (LOCATION_ID_TO_ZONE[lower]) return LOCATION_ID_TO_ZONE[lower];
  if (lower.includes('twin') && lower.includes('peak')) return 'twinPeaks';
  if (lower.includes('moonlight')) return 'moonlight';
  if (lower.includes('riverview') || (lower.includes('river') && lower.includes('view'))) return 'riverview';
  if (lower.includes('comet')) return 'comet';
  if (lower.includes('milky')) return 'moonlight';
  return null;
}

export function getEnforcementSiteCoordinates(locationId: string): google.maps.LatLngLiteral | null {
  const z = resolveHeatmapZone(locationId);
  return z ? ZONE_SITE[z] : null;
}

/** Ray-cast point-in-polygon (lng = x, lat = y) — used when Maps Geometry is not yet loaded. */
export function pointInPolygon(lat: number, lng: number, ring: google.maps.LatLngLiteral[]): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || ring.length < 3) return false;
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = ring[i].lat;
    const xi = ring[i].lng;
    const yj = ring[j].lat;
    const xj = ring[j].lng;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Returns true when the point lies inside the Barangay Blue Ridge B polygon.
 * Uses `google.maps.geometry.poly.containsLocation` when the Geometry library is available
 * (load Maps with `libraries=geometry`); otherwise falls back to an equivalent point-in-polygon test.
 */
export function validateDetection(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const g = typeof window !== 'undefined' ? window.google?.maps : undefined;
  if (g?.geometry?.poly) {
    const boundary = new g.Polygon({ paths: BLUE_RIDGE_B_BOUNDARY });
    return g.geometry.poly.containsLocation(new g.LatLng(lat, lng), boundary);
  }
  return pointInPolygon(lat, lng, BLUE_RIDGE_B_BOUNDARY);
}

/** Open enforcement rows counted toward zone heat (warning + pending). */
function isActiveViolationForHeat(v: Violation): boolean {
  return v.status === 'warning' || v.status === 'pending';
}

/** 0–2 transparent, 3–9 soft amber, 10+ vivid red (per dashboard brief). */
export function zoneHeatStyle(count: number): { fillColor: string; fillOpacity: number; strokeColor: string; strokeWeight: number } {
  if (count <= 2) {
    return {
      fillColor: '#0f172a',
      fillOpacity: 0,
      strokeColor: 'rgba(148, 163, 184, 0.55)',
      strokeWeight: 1,
    };
  }
  if (count < 10) {
    return {
      fillColor: '#f59e0b',
      fillOpacity: 0.32,
      strokeColor: 'rgba(245, 158, 11, 0.85)',
      strokeWeight: 1,
    };
  }
  return {
    fillColor: '#ef4444',
    fillOpacity: 0.42,
    strokeColor: 'rgba(239, 68, 68, 0.95)',
    strokeWeight: 1,
  };
}

export function countActiveViolationsByZone(violations: Violation[]): Record<HeatmapZoneId, number> {
  const out: Record<HeatmapZoneId, number> = {
    twinPeaks: 0,
    moonlight: 0,
    riverview: 0,
    comet: 0,
  };
  for (const v of violations) {
    if (!isActiveViolationForHeat(v)) continue;
    const z = resolveHeatmapZone(v.cameraLocationId || '');
    if (z) out[z] += 1;
  }
  return out;
}

export type JurisdictionKind = 'in' | 'out' | 'unknown';

export function getJurisdictionKindForLocationId(locationId: string): JurisdictionKind {
  const c = getEnforcementSiteCoordinates(locationId);
  if (!c) return 'unknown';
  return validateDetection(c.lat, c.lng) ? 'in' : 'out';
}
