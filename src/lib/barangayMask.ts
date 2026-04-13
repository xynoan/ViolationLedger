import type { Feature, FeatureCollection, LineString, Polygon, Position } from 'geojson';

/**
 * Merge the two LineString rings from `blueRidgeBoundary.json` into one closed [lng, lat] ring.
 */
export function mergeBoundaryLineStringsToRing(fc: FeatureCollection): Position[] {
  const f0 = (fc.features[0].geometry as LineString).coordinates;
  const f1 = (fc.features[1].geometry as LineString).coordinates;
  const ring = [...f0, ...f1.slice(1)];
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return ring;
}

/**
 * World-sized outer ring + barangay hole → inverted polygon (spotlight / “donut”) for masking.
 * GeoJSON: first ring exterior, following rings are holes (RFC 7946).
 */
export function buildSpotlightInvertedPolygon(boundaryFc: FeatureCollection): Feature<Polygon> {
  const innerRaw = mergeBoundaryLineStringsToRing(boundaryFc);
  /** Hole ring must wind opposite the exterior ring for valid GeoJSON / Leaflet fill. */
  const innerHole = [...innerRaw].reverse();
  const outer: Position[] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];
  return {
    type: 'Feature',
    properties: { kind: 'spotlight-mask' },
    geometry: {
      type: 'Polygon',
      coordinates: [outer, innerHole],
    },
  };
}
