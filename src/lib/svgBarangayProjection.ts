import type { FeatureCollection, LineString, Position } from 'geojson';

export const SVG_MAP_VIEWBOX = { width: 800, height: 600 } as const;

export type GeoBounds = {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
};

export type SvgProjection = {
  viewWidth: number;
  viewHeight: number;
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  /** Uniform scale (meters → SVG units). */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Local tangent plane origin [lng, lat] for ENU projection. */
  originLng: number;
  originLat: number;
  /** BBox of `bounds` corners in ENU meters (aligned axes). */
  enuMinX: number;
  enuMaxY: number;
};

function accumulateLngLat(coords: Position[], into: [number, number][]): void {
  for (const c of coords) {
    into.push([c[0], c[1]]);
  }
}

/** Bounding box of all vertices in boundary + street LineStrings (GeoJSON [lng, lat]). */
export function computeDrawingBounds(
  boundaryFc: FeatureCollection,
  streetFc: FeatureCollection,
  paddingRatio = 0.06,
): GeoBounds {
  const pts: [number, number][] = [];
  for (const f of boundaryFc.features) {
    const g = f.geometry;
    if (g.type === 'LineString') accumulateLngLat(g.coordinates as Position[], pts);
  }
  for (const f of streetFc.features) {
    const g = f.geometry;
    if (g.type === 'LineString') accumulateLngLat(g.coordinates as Position[], pts);
  }
  if (pts.length === 0) {
    return { minLng: 121.07, maxLng: 121.08, minLat: 14.615, maxLat: 14.62 };
  }
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of pts) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const w = maxLng - minLng;
  const h = maxLat - minLat;
  const dx = Math.max(w, 1e-8) * paddingRatio;
  const dy = Math.max(h, 1e-8) * paddingRatio;
  return {
    minLng: minLng - dx,
    maxLng: maxLng + dx,
    minLat: minLat - dy,
    maxLat: maxLat + dy,
  };
}

const R_EARTH = 6371000;

/** ENU meters east/north from origin [lng, lat] (WGS84 small-area approximation). */
export function lngLatToEnuMeters(lng: number, lat: number, originLng: number, originLat: number): { x: number; y: number } {
  const cosLat = Math.cos((originLat * Math.PI) / 180);
  const x = ((lng - originLng) * Math.PI) / 180 * R_EARTH * cosLat;
  const y = ((lat - originLat) * Math.PI) / 180 * R_EARTH;
  return { x, y };
}

/**
 * Uniform scale + letterboxing inside viewBox. Uses a local ENU (meter) plane so E–W and N–S
 * distances match real-world proportions (plain degree scaling skews shapes at this latitude).
 */
export function buildSvgProjection(bounds: GeoBounds, viewWidth: number, viewHeight: number): SvgProjection {
  const originLng = (bounds.minLng + bounds.maxLng) / 2;
  const originLat = (bounds.minLat + bounds.maxLat) / 2;
  const corners: [number, number][] = [
    [bounds.minLng, bounds.minLat],
    [bounds.maxLng, bounds.minLat],
    [bounds.maxLng, bounds.maxLat],
    [bounds.minLng, bounds.maxLat],
  ];
  let minMx = Infinity;
  let maxMx = -Infinity;
  let minMy = Infinity;
  let maxMy = -Infinity;
  for (const [lng, lat] of corners) {
    const { x, y } = lngLatToEnuMeters(lng, lat, originLng, originLat);
    minMx = Math.min(minMx, x);
    maxMx = Math.max(maxMx, x);
    minMy = Math.min(minMy, y);
    maxMy = Math.max(maxMy, y);
  }
  const geoW = maxMx - minMx;
  const geoH = maxMy - minMy;
  const scale = Math.min(viewWidth / geoW, viewHeight / geoH);
  const drawW = geoW * scale;
  const drawH = geoH * scale;
  const offsetX = (viewWidth - drawW) / 2;
  const offsetY = (viewHeight - drawH) / 2;
  return {
    viewWidth,
    viewHeight,
    minLng: bounds.minLng,
    maxLng: bounds.maxLng,
    minLat: bounds.minLat,
    maxLat: bounds.maxLat,
    scale,
    offsetX,
    offsetY,
    originLng,
    originLat,
    enuMinX: minMx,
    enuMaxY: maxMy,
  };
}

/** Low-level: GeoJSON order [longitude, latitude]. */
export function projectLngLatToSvg(p: SvgProjection, lng: number, lat: number): { x: number; y: number } {
  const { x: mx, y: my } = lngLatToEnuMeters(lng, lat, p.originLng, p.originLat);
  const x = p.offsetX + (mx - p.enuMinX) * p.scale;
  const y = p.offsetY + (p.enuMaxY - my) * p.scale;
  return { x, y };
}

/**
 * Maps WGS84 latitude/longitude into the 800×600 SVG space (same projection as {@link buildSvgProjection}).
 * Aspect ratio of the barangay bbox is preserved via uniform scale + letterboxing stored in `p`.
 */
export function project(lat: number, lng: number, p: SvgProjection): { x: number; y: number } {
  return projectLngLatToSvg(p, lng, lat);
}

/** Horizontal length in SVG units representing `meters` (projection is already metric). */
export function metersToSvgWidth(meters: number, p: SvgProjection): number {
  return meters * p.scale;
}

/** SVG `d` for an open LineString (stroke only). Coordinates are GeoJSON [lng, lat]. */
export function lineStringToPathD(coords: Position[], p: SvgProjection): string {
  if (coords.length === 0) return '';
  const [lng0, lat0] = coords[0];
  const first = project(lat0, lng0, p);
  const parts = [`M ${first.x} ${first.y}`];
  for (let i = 1; i < coords.length; i++) {
    const [lng, lat] = coords[i];
    const pt = project(lat, lng, p);
    parts.push(`L ${pt.x} ${pt.y}`);
  }
  return parts.join(' ');
}

/** Closed ring for boundary fill: first point repeated at end → Z. */
export function ringToClosedPathD(ring: Position[], p: SvgProjection): string {
  if (ring.length < 2) return '';
  const open = lineStringToPathD(ring, p);
  return `${open} Z`;
}
