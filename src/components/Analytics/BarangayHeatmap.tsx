import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, GeoJSON, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { GeoJSON as GeoJSONType } from 'geojson';
import type { PathOptions } from 'leaflet';
import type { Violation } from '@/types/parking';
import { cn } from '@/lib/utils';
import type { ResidentStreetName } from '@/lib/residentStreets';
import { RESIDENT_STREET_OPTIONS } from '@/lib/residentStreets';
import { countActiveViolationsByStreet } from '@/lib/violationStreetAttribution';
import { buildSpotlightInvertedPolygon, mergeBoundaryLineStringsToRing } from '@/lib/barangayMask';
import {
  STREET_GEOMETRY,
  STREET_GEOMETRY_BY_NAME,
  centroidFromLineString,
  geoJsonPositionsToLeaflet,
} from '@/lib/streetGeometry';
import boundaryGeo from '@/assets/blueRidgeBoundary.json';

/** Carto Dark Matter — no labels (minimal chrome). Fallback-friendly pattern. */
const TILE_DARK_NO_LABELS =
  'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';

/**
 * Neon heat-trace: Safe · Low (1–2) cyan · Medium (3–4) electric orange · Critical (5+) neon pink.
 */
function polylineStyleForCount(count: number): PathOptions {
  const round = { lineJoin: 'round' as const, lineCap: 'round' as const };
  if (count <= 0) {
    return { color: '#64748b', weight: 3, opacity: 0.45, className: 'street-heat-safe', ...round };
  }
  if (count <= 2) {
    return { color: '#00f2ff', weight: 5, opacity: 0.95, className: 'street-heat-low', ...round };
  }
  if (count <= 4) {
    return { color: '#ffaa00', weight: 8, opacity: 0.95, className: 'street-heat-medium', ...round };
  }
  return {
    color: '#ff0055',
    weight: 12,
    opacity: 1,
    className: 'street-heat-critical',
    ...round,
  };
}

function tierDotClass(count: number): string {
  if (count <= 0) return 'bg-slate-500';
  if (count <= 2) return 'bg-cyan-400';
  if (count <= 4) return 'bg-amber-400';
  return 'bg-pink-500';
}

function tooltipViolationsLine(street: string, count: number): string {
  return `${street} | ${count} Active Violation${count === 1 ? '' : 's'}`;
}

function rosterViolationsPhrase(count: number): string {
  return `${count} Active Violation${count === 1 ? '' : 's'}`;
}

/** Fit to barangay, then lock pan/zoom so the view cannot leave the jurisdiction. */
function LockViewportToBarangay({ boundaryData }: { boundaryData: GeoJSONType.FeatureCollection }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.geoJSON(boundaryData as Parameters<typeof L.geoJSON>[0]);
    const b = layer.getBounds();
    if (!b.isValid()) return;
    map.fitBounds(b, { padding: [24, 24], maxZoom: 18 });
    map.setMaxBounds(b.pad(0.1));
  }, [map, boundaryData]);
  return null;
}

function SpotlightMaskLayer({
  maskFeatureCollection,
}: {
  maskFeatureCollection: GeoJSONType.FeatureCollection;
}) {
  return (
    <GeoJSON
      data={maskFeatureCollection}
      style={() => ({
        fillColor: '#0f172a',
        fillOpacity: 0.85,
        stroke: false,
        weight: 0,
      })}
      onEachFeature={(_, layer) => {
        (layer as L.Path).options.interactive = false;
      }}
    />
  );
}

type StreetHeatPolylineProps = {
  positions: [number, number][];
  pathOptions: PathOptions;
  tooltip: string;
};

function StreetHeatPolyline({ positions, pathOptions, tooltip }: StreetHeatPolylineProps) {
  const map = useMap();
  return (
    <Polyline
      positions={positions}
      pathOptions={pathOptions}
      eventHandlers={{
        click: () => {
          const b = L.latLngBounds(positions);
          map.flyToBounds(b, { padding: [28, 28], maxZoom: 18, duration: 0.55 });
        },
      }}
    >
      {/* Only on hover along the illuminated street geometry (not sticky / not permanent). */}
      <Tooltip direction="top" offset={[0, -6]} opacity={0.98}>
        {tooltip}
      </Tooltip>
    </Polyline>
  );
}

export type BarangayHeatmapProps = {
  violations: Violation[];
  className?: string;
};

export function BarangayHeatmap({ violations, className }: BarangayHeatmapProps) {
  const boundaryFc = boundaryGeo as GeoJSONType.FeatureCollection;

  /** Tight jurisdiction bounds — used with maxBoundsViscosity so pan cannot leave Barangay B. */
  const jurisdictionMaxBounds = useMemo(() => {
    const ring = mergeBoundaryLineStringsToRing(boundaryFc);
    let minLat = 90;
    let maxLat = -90;
    let minLng = 180;
    let maxLng = -180;
    for (const [lng, lat] of ring) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
    return L.latLngBounds([minLat, minLng], [maxLat, maxLng]).pad(0.12);
  }, [boundaryFc]);

  const spotlightMaskFc = useMemo(
    () =>
      ({
        type: 'FeatureCollection',
        features: [buildSpotlightInvertedPolygon(boundaryFc)],
      }) as GeoJSONType.FeatureCollection,
    [boundaryFc],
  );

  const countByStreet = useMemo(() => countActiveViolationsByStreet(violations), [violations]);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const c of countByStreet.values()) {
      if (c > max) max = c;
    }
    return max;
  }, [countByStreet]);

  const sortedStreetLayers = useMemo(() => {
    const layers: {
      street: ResidentStreetName;
      count: number;
      positions: [number, number][];
      pathOptions: PathOptions;
    }[] = [];

    for (const f of STREET_GEOMETRY.features) {
      const street = (f.properties as { streetName?: ResidentStreetName }).streetName;
      if (!street || !STREET_GEOMETRY_BY_NAME[street]) continue;
      const coords = f.geometry.coordinates;
      const positions = geoJsonPositionsToLeaflet(coords);
      const count = countByStreet.get(street) ?? 0;
      layers.push({
        street,
        count,
        positions,
        pathOptions: polylineStyleForCount(count),
      });
    }

    layers.sort((a, b) => a.count - b.count || a.street.localeCompare(b.street));

    return layers;
  }, [countByStreet]);

  const center: [number, number] = [14.6176, 121.075];
  const rosterRows = useMemo(() => {
    return RESIDENT_STREET_OPTIONS.map((street) => {
      const feat = STREET_GEOMETRY_BY_NAME[street];
      const coords = feat?.geometry?.coordinates ?? [];
      const { lat, lng } = centroidFromLineString(coords);
      const count = countByStreet.get(street) ?? 0;
      return { street, lat, lng, count };
    });
  }, [countByStreet]);

  return (
    <div className={cn('rounded-xl border border-border bg-muted/25 p-3 shadow-sm', className)}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-tight text-foreground">Street-trace heatmap</h3>
        <span className="text-[10px] text-muted-foreground">Spotlight jurisdiction · Leaflet</span>
      </div>
      <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
        Active violations roll up by street (resident registry). Inverted polygon masks the world outside Barangay Blue
        Ridge B. Peak load: {maxCount > 0 ? `${maxCount} active (max)` : '—'}.
      </p>
      <div className="relative h-[min(300px,42vh)] min-h-[240px] w-full overflow-hidden rounded-lg border border-border/80 bg-[#0b1222] [&_.leaflet-container]:h-full [&_.leaflet-container]:w-full [&_.leaflet-container]:bg-[#0b1222]">
        <MapContainer
          center={center}
          zoom={16}
          className="h-full w-full"
          scrollWheelZoom
          worldCopyJump={false}
          maxBounds={jurisdictionMaxBounds}
          maxBoundsViscosity={1}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url={TILE_DARK_NO_LABELS}
            subdomains="abcd"
            maxZoom={20}
            opacity={0.28}
          />

          <SpotlightMaskLayer maskFeatureCollection={spotlightMaskFc} />

          <GeoJSON
            data={boundaryFc}
            style={() => ({
              color: '#38bdf8',
              weight: 2,
              opacity: 0.95,
              fillOpacity: 0,
            })}
          />

          <LockViewportToBarangay boundaryData={boundaryFc} />

          {sortedStreetLayers.map(({ street, positions, pathOptions }) => {
            const count = countByStreet.get(street) ?? 0;
            const tooltip = tooltipViolationsLine(street, count);
            return (
              <StreetHeatPolyline key={street} positions={positions} pathOptions={pathOptions} tooltip={tooltip} />
            );
          })}
        </MapContainer>

        <div className="pointer-events-none absolute left-0 right-0 top-2 z-[1000] flex justify-center px-2">
          <p className="rounded border border-sky-500/40 bg-[#0f172a]/90 px-3 py-1 font-mono text-[10px] font-semibold tracking-wide text-sky-100 shadow-md backdrop-blur-sm">
            OPERATIONAL JURISDICTION: BLUE RIDGE B
          </p>
        </div>

        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] max-w-[230px] rounded-md border border-slate-600/60 bg-[#0f172a]/95 px-2.5 py-2 shadow-md backdrop-blur-[2px]">
          <p className="mb-1.5 text-[10px] font-semibold leading-tight text-slate-100">Neon heat (active)</p>
          <ul className="pointer-events-auto space-y-1 text-[9px] leading-tight text-slate-300">
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-7 shrink-0 rounded-sm bg-slate-500" />
              <span>Safe (0)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-7 shrink-0 rounded-sm bg-[#00f2ff]" />
              <span>Low (1–2)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-7 shrink-0 rounded-sm bg-[#ffaa00]" />
              <span>Medium (3–4)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-7 shrink-0 rounded-sm bg-[#ff0055]" />
              <span>Critical (5+)</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border/70 bg-card/80 px-2 py-2">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Streets (centroid)</p>
        <ul className="grid max-h-[min(200px,28vh)] grid-cols-1 gap-x-3 gap-y-1 overflow-y-auto text-[10px] sm:grid-cols-2 sm:max-h-none sm:overflow-visible">
          {rosterRows.map(({ street, lat, lng, count }) => (
            <li
              key={`list-${street}`}
              className="flex min-w-0 items-start gap-2 border-b border-border/40 py-1 last:border-b-0 sm:border-b-0 sm:py-0.5"
            >
              <span
                className={cn('mt-0.5 h-2 w-2 shrink-0 rounded-full ring-1 ring-border', tierDotClass(count))}
                title="Tier"
              />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="font-medium text-foreground">{street}</span>
                <span className="mt-0.5 block font-mono text-[9px] text-muted-foreground tabular-nums">
                  {lat.toFixed(4)}°N, {lng.toFixed(4)}°E
                </span>
                <span className="text-[9px] text-muted-foreground">
                  {count > 0 ? ` · ${rosterViolationsPhrase(count)}` : ' · No active violations'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
