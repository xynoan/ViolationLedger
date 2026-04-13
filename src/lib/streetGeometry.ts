import type { Feature, FeatureCollection, LineString, Position } from 'geojson';
import streetNetworkRaw from '@/assets/streetNetwork.json';
import type { ResidentStreetName } from '@/lib/residentStreets';
import { RESIDENT_STREET_OPTIONS } from '@/lib/residentStreets';

/** Consolidated street centerlines (Barangay Blue Ridge B). Built by `scripts/build-street-network.mjs` (OSM + in-polygon clip; unmapped streets use a local fallback). */
export const STREET_GEOMETRY = streetNetworkRaw as FeatureCollection<LineString>;

export const STREET_GEOMETRY_BY_NAME: Record<ResidentStreetName, Feature<LineString>> = {} as Record<
  ResidentStreetName,
  Feature<LineString>
>;

for (const f of STREET_GEOMETRY.features) {
  const name = (f.properties as { streetName?: string } | null)?.streetName;
  if (name && RESIDENT_STREET_OPTIONS.includes(name as ResidentStreetName)) {
    STREET_GEOMETRY_BY_NAME[name as ResidentStreetName] = f as Feature<LineString>;
  }
}

/**
 * GeoJSON uses [longitude, latitude]; Leaflet paths expect [latitude, longitude].
 * Call this on raw LineString coordinates before passing to `Polyline` / `LatLng` APIs.
 */
export function geoJsonPositionsToLeaflet(coords: Position[]): [number, number][] {
  return coords.map(([lng, lat]) => [lat, lng] as [number, number]);
}

/** Representative [lat, lng] for roster / labels (centroid of LineString vertices). */
export function centroidFromLineString(coords: Position[]): { lat: number; lng: number } {
  if (coords.length === 0) return { lat: 0, lng: 0 };
  let sx = 0;
  let sy = 0;
  for (const c of coords) {
    sx += c[0];
    sy += c[1];
  }
  const n = coords.length;
  return { lng: sx / n, lat: sy / n };
}
