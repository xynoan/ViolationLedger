import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import type { GeoJSON as GeoJSONType } from 'geojson';
import type { Violation } from '@/types/parking';
import { cn } from '@/lib/utils';
import {
  BLUE_RIDGE_ZONE_POLYGONS,
  resolveHeatmapZone,
} from '@/lib/blueRidgeGeofence';
import boundaryGeo from '@/assets/blueRidgeBoundary.json';

/** Canonical street labels → [lat, lng] for enforcement sites (Barangay Blue Ridge B). */
const LOCATION_STRING_TO_COORD: Record<string, [number, number]> = {
  'Twin Peaks Dr': [14.616, 121.074],
  'Moonlight Loop': [14.6178, 121.0748],
  "Comet's Loop": [14.6162, 121.0735],
  'Riverview Dr': [14.6165, 121.0795],
};

function isActiveViolation(v: Violation): boolean {
  return v.status === 'warning' || v.status === 'pending';
}

/** Merge GeoJSON LineString rings into one closed [lng, lat] ring for point-in-polygon. */
function boundaryRingFromGeoJson(fc: GeoJSONType.FeatureCollection): [number, number][] | null {
  const ring: [number, number][] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g || g.type !== 'LineString') continue;
    const c = g.coordinates as [number, number][];
    if (ring.length > 0 && c.length > 0) {
      const last = ring[ring.length - 1];
      const first = c[0];
      const dup =
        Math.abs(last[0] - first[0]) < 1e-7 && Math.abs(last[1] - first[1]) < 1e-7;
      ring.push(...(dup ? c.slice(1) : c));
    } else {
      ring.push(...c);
    }
  }
  if (ring.length < 3) return null;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return ring;
}

/** Ray-cast point-in-polygon; ring vertices are [lng, lat] (GeoJSON order). */
function isCoordinateInBoundary(lat: number, lng: number, ring: [number, number][]): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || ring.length < 3) return false;
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function resolveStreetLabel(v: Violation): string | null {
  const z = resolveHeatmapZone(v.cameraLocationId || '');
  if (z) return BLUE_RIDGE_ZONE_POLYGONS[z].street;
  const raw = (v.cameraLocationId || '').trim();
  if (!raw) return null;
  if (LOCATION_STRING_TO_COORD[raw]) return raw;
  const lower = raw.toLowerCase();
  for (const key of Object.keys(LOCATION_STRING_TO_COORD)) {
    if (key.toLowerCase() === lower) return key;
  }
  if (lower.includes('twin') && lower.includes('peak')) return 'Twin Peaks Dr';
  if (lower.includes('moonlight')) return 'Moonlight Loop';
  if (lower.includes('riverview') || (lower.includes('river') && lower.includes('view'))) return 'Riverview Dr';
  if (lower.includes('comet')) return "Comet's Loop";
  return null;
}

type HeatmapLayerProps = {
  points: [number, number, number][];
};

/** Renders `L.heatLayer` on the parent map (leaflet.heat plugin). */
export function HeatmapLayer({ points }: HeatmapLayerProps) {
  const map = useMap();

  useEffect(() => {
    const maxIntensity = Math.max(...points.map((p) => p[2]));
    const heatLayer = (L as typeof L & { heatLayer: (pts: typeof points, o?: object) => L.Layer }).heatLayer(points, {
      radius: 28,
      blur: 18,
      maxZoom: 18,
      max: maxIntensity > 0 ? maxIntensity : 1,
    });
    map.addLayer(heatLayer);
    return () => {
      map.removeLayer(heatLayer);
    };
  }, [map, points]);

  return null;
}

function FitBoundsToGeoJson({ data }: { data: GeoJSONType.FeatureCollection }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.geoJSON(data as Parameters<typeof L.geoJSON>[0]);
    const b = layer.getBounds();
    if (b.isValid()) {
      map.fitBounds(b, { padding: [28, 28], maxZoom: 18 });
    }
  }, [map, data]);
  return null;
}

export type BarangayHeatmapProps = {
  violations: Violation[];
  className?: string;
};

export function BarangayHeatmap({ violations, className }: BarangayHeatmapProps) {
  const boundaryRing = useMemo(
    () => boundaryRingFromGeoJson(boundaryGeo as GeoJSONType.FeatureCollection),
    [],
  );

  const { heatPoints, outsideJurisdiction } = useMemo(() => {
    const byStreet = new Map<string, number>();
    for (const v of violations) {
      if (!isActiveViolation(v)) continue;
      const street = resolveStreetLabel(v);
      if (!street) continue;
      byStreet.set(street, (byStreet.get(street) || 0) + 1);
    }

    const heatPointsInner: [number, number, number][] = [];
    const outside: { label: string; count: number }[] = [];

    for (const [street, count] of byStreet) {
      const coord = LOCATION_STRING_TO_COORD[street];
      if (!coord) continue;
      const [lat, lng] = coord;
      if (boundaryRing && !isCoordinateInBoundary(lat, lng, boundaryRing)) {
        outside.push({ label: street, count });
        continue;
      }
      heatPointsInner.push([lat, lng, count]);
    }

    return { heatPoints: heatPointsInner, outsideJurisdiction: outside };
  }, [violations, boundaryRing]);

  const center: [number, number] = [14.6176, 121.0753];

  return (
    <div className={cn('rounded-xl border border-border bg-muted/25 p-3 shadow-sm', className)}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-tight text-foreground">Geospatial Enforcement Heatmap</h3>
        <span className="text-[10px] text-muted-foreground">Barangay Blue Ridge B · Leaflet</span>
      </div>
      <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
        Intensity reflects active violations (warnings + pending) by street. Points outside the GeoJSON boundary are excluded
        from the heat layer and listed as Outside Jurisdiction.
      </p>
      {outsideJurisdiction.length > 0 ? (
        <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-950 dark:text-amber-100">
          <span className="font-semibold">Outside Jurisdiction: </span>
          {outsideJurisdiction.map((o) => `${o.label} (${o.count})`).join(' · ')}
        </div>
      ) : null}
      <div className="relative h-[min(280px,38vh)] min-h-[220px] w-full overflow-hidden rounded-lg border border-border/80 bg-card [&_.leaflet-container]:h-full [&_.leaflet-container]:w-full [&_.leaflet-container]:bg-card">
        <MapContainer center={center} zoom={16} className="h-full w-full" scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={20}
          />
          <GeoJSON
            data={boundaryGeo as GeoJSONType.FeatureCollection}
            style={() => ({
              color: '#3b82f6',
              weight: 2,
              fillOpacity: 0,
            })}
          />
          <FitBoundsToGeoJson data={boundaryGeo as GeoJSONType.FeatureCollection} />
          {heatPoints.length > 0 ? <HeatmapLayer points={heatPoints} /> : null}
        </MapContainer>
      </div>
    </div>
  );
}
