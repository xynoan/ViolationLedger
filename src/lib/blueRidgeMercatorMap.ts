import { geoMercator, geoPath } from 'd3-geo';
import type { GeoPath, GeoProjection } from 'd3-geo';
import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  MultiLineString,
  Polygon,
} from 'geojson';
import { mergeBoundaryLineStringsToRing } from '@/lib/barangayMask';

/** d3-geo path + projection bundle used by the SVG map. */
export type BlueRidgeMercatorEngine = {
  projection: GeoProjection;
  path: GeoPath<GeoProjection>;
  boundaryPolygon: Feature<Polygon>;
};

/** Fixed SVG viewport (matches prior dashboard map card). */
export const BR_SVG_VIEWBOX = { width: 800, height: 600 } as const;

const R_EARTH = 6371000;

/**
 * Closed jurisdiction polygon from `blueRidgeBoundary.json` (two LineStrings → one ring).
 */
export function boundaryPolygonFromFeatureCollection(fc: FeatureCollection): Feature<Polygon> {
  const ring = mergeBoundaryLineStringsToRing(fc);
  return {
    type: 'Feature',
    properties: { kind: 'barangay-boundary' },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

function isStreetPathGeometry(g: Geometry | null): g is LineString | MultiLineString {
  return g?.type === 'LineString' || g?.type === 'MultiLineString';
}

/**
 * Single Mercator projection + geoPath. When `streetsFc` is passed, `fitSize` uses boundary + all
 * street line geometries so the viewport frames the full network (D3-aligned with the boundary).
 */
export function createBlueRidgeMercatorEngine(
  boundaryFc: FeatureCollection,
  width: number,
  height: number,
  streetsFc?: FeatureCollection,
): BlueRidgeMercatorEngine {
  const boundaryPolygon = boundaryPolygonFromFeatureCollection(boundaryFc);
  const streetFeatures =
    streetsFc?.features.filter((f) => f?.geometry && isStreetPathGeometry(f.geometry)) ?? [];
  const framing: FeatureCollection =
    streetFeatures.length > 0
      ? { type: 'FeatureCollection', features: [boundaryPolygon, ...streetFeatures] }
      : { type: 'FeatureCollection', features: [boundaryPolygon] };
  const pad = Math.min(20, Math.floor(Math.min(width, height) * 0.04));
  const projection = geoMercator().fitExtent(
    [
      [pad, pad],
      [width - pad, height - pad],
    ],
    framing,
  );
  const path = geoPath(projection);
  return { projection, path, boundaryPolygon };
}

/**
 * Horizontal 100 m scale bar in SVG space (east–west at mean latitude; Mercator parallels → horizontal).
 */
export function hundredMeterScaleBarInSvg(
  projection: GeoProjection,
  boundaryPolygon: Feature<Polygon>,
  viewWidth: number,
  viewHeight: number,
  margin: number,
): { x1: number; y: number; x2: number } | null {
  const poly = boundaryPolygon.geometry;
  const ring = poly.coordinates[0];
  if (!ring?.length) return null;
  let sx = 0;
  let sy = 0;
  for (const [lng, lat] of ring) {
    sx += lng;
    sy += lat;
  }
  const n = ring.length;
  const lng0 = sx / n;
  const lat0 = sy / n;
  const latRad = (lat0 * Math.PI) / 180;
  const halfM = 50;
  const dLngDeg = (halfM / (R_EARTH * Math.cos(latRad))) * (180 / Math.PI);
  const a: [number, number] = [lng0 - dLngDeg, lat0];
  const b: [number, number] = [lng0 + dLngDeg, lat0];
  const pA = projection(a);
  const pB = projection(b);
  if (!pA || !pB) return null;
  const len = Math.abs(pB[0]! - pA[0]!) || 1;
  const sbY = viewHeight - margin - 8;
  const sbX2 = viewWidth - margin;
  const sbX1 = sbX2 - len;
  return { x1: sbX1, y: sbY, x2: sbX2 };
}
