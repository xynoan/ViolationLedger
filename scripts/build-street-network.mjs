/**
 * Generates src/assets/streetNetwork.json — one LineString per street, clipped to the barangay polygon.
 * Primary source: OpenStreetMap named highways (Overpass). Unmapped streets fall back to a denser
 * synthetic trace inside the polygon (legacy behavior, improved).
 *
 * Run: node scripts/build-street-network.mjs
 * Optional: OVERPASS_URL=https://overpass.kumi.systems/api/interpreter node scripts/build-street-network.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

/** @type {Record<string, string[]>} Resident roster key → OSM `name` tags to match (case-insensitive) */
const STREET_OSM_NAMES = {
  'Twin Peaks Drive': ['Twin Peaks Drive'],
  'Milky Way Drive': ['Milkyway Drive', 'Milky Way Drive'],
  'Moonlight Loop': ['Moonlight Loop'],
  "Comet's Loop": ['Comets Loop', "Comet's Loop", 'Comet Loop'],
  'Hillside Loop': ['Hillside Loop'],
  'Starline Road': ['Starline Road'],
  'Evening Glow Road': ['Evening Glow Road'],
  'Milky Way Lane': ['Milky Way Lane', 'Milkyway Lane'],
  'Hillside Lane': ['Hillside Lane', 'Hillside Drive'],
  'Starline Road Alley': [], // derived from Starline Road offset when possible
  'Promenade Lane': ['Promenade Line', 'Promenade Lane'],
  'Riverview Drive': ['Riverview Drive'],
  'Union Lane': ['Union Lane'],
  'Riverside Drive': ['Riverside Drive'],
};

/** Rough anchors [lat, lng] when OSM has no match (same as before, slightly refined for QC area) */
const STREET_COORDINATES = {
  'Twin Peaks Drive': [14.6158, 121.0735],
  'Milky Way Drive': [14.6165, 121.0755],
  'Moonlight Loop': [14.6178, 121.0748],
  "Comet's Loop": [14.6162, 121.0732],
  'Hillside Loop': [14.619, 121.0755],
  'Starline Road': [14.6185, 121.077],
  'Evening Glow Road': [14.6188, 121.0782],
  'Milky Way Lane': [14.6155, 121.076],
  'Hillside Lane': [14.6195, 121.0762],
  'Starline Road Alley': [14.6182, 121.0778],
  'Promenade Lane': [14.6175, 121.0775],
  'Riverview Drive': [14.6165, 121.0795],
  'Union Lane': [14.6168, 121.0725],
  'Riverside Drive': [14.615, 121.0785],
};

function mergeBoundaryRing(fc) {
  const f0 = fc.features[0].geometry.coordinates;
  const f1 = fc.features[1].geometry.coordinates;
  const ring = [...f0, ...f1.slice(1)];
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return ring;
}

function normName(s) {
  return String(s)
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wayToCoords(el) {
  if (!el.geometry || !Array.isArray(el.geometry)) return [];
  return el.geometry.map((pt) => [pt.lon, pt.lat]);
}

function distKm(a, b) {
  return turf.distance(turf.point(a), turf.point(b), { units: 'kilometers' });
}

/** Join colinear fragments (e.g. split at polygon edge) into one polyline when endpoints meet. */
function chainCoordinateParts(parts, tolKm = 0.004) {
  const segs = parts.filter((c) => c.length >= 2).map((c) => [...c]);
  if (segs.length === 0) return null;
  if (segs.length === 1) return segs[0];

  const chains = [];
  while (segs.length) {
    let chain = segs.pop();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = segs.length - 1; i >= 0; i -= 1) {
        const s = segs[i];
        const c0 = chain[0];
        const c1 = chain[chain.length - 1];
        const s0 = s[0];
        const s1 = s[s.length - 1];
        if (distKm(c1, s0) < tolKm) {
          chain = [...chain, ...s.slice(1)];
          segs.splice(i, 1);
          grew = true;
          break;
        }
        if (distKm(c1, s1) < tolKm) {
          const rs = [...s].reverse();
          chain = [...chain, ...rs.slice(1)];
          segs.splice(i, 1);
          grew = true;
          break;
        }
        if (distKm(c0, s1) < tolKm) {
          chain = [...s.slice(0, -1), ...chain];
          segs.splice(i, 1);
          grew = true;
          break;
        }
        if (distKm(c0, s0) < tolKm) {
          const rs = [...s].reverse();
          chain = [...rs.slice(0, -1), ...chain];
          segs.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    chains.push(chain);
  }

  let best = chains[0];
  let bestLen = turf.length(turf.lineString(best), { units: 'kilometers' });
  for (let i = 1; i < chains.length; i += 1) {
    const len = turf.length(turf.lineString(chains[i]), { units: 'kilometers' });
    if (len > bestLen) {
      bestLen = len;
      best = chains[i];
    }
  }
  return best;
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} line
 * @param {import('geojson').Feature<import('geojson').Polygon>} poly
 * @returns {import('geojson').LineString | null}
 */
function clipLineToPolygon(line, poly) {
  if (line.geometry.coordinates.length < 2) return null;
  let boundary;
  try {
    boundary = turf.polygonToLine(poly);
  } catch {
    return null;
  }
  let split;
  try {
    split = turf.lineSplit(line, boundary);
  } catch {
    return null;
  }
  const inside = [];
  for (const f of split.features) {
    const coords = f.geometry.coordinates;
    if (coords.length < 2) continue;
    const mid = turf.midpoint(coords[0], coords[coords.length - 1]);
    if (turf.booleanPointInPolygon(mid, poly)) inside.push(coords);
  }
  if (inside.length === 0) return null;
  const merged = chainCoordinateParts(inside);
  if (!merged || merged.length < 2) return null;
  return { type: 'LineString', coordinates: merged };
}

/** Per-way clip + chain; prefers longest continuous run inside the barangay. */
function mergeOsmWaysToLine(ways, poly) {
  const parts = [];
  for (const w of ways) {
    const c = wayToCoords(w);
    if (c.length < 2) continue;
    const clipped = clipLineToPolygon(turf.lineString(c), poly);
    if (clipped?.coordinates?.length >= 2) parts.push(clipped.coordinates);
  }
  if (parts.length === 0) return null;
  const merged = chainCoordinateParts(parts);
  return merged ? { type: 'LineString', coordinates: merged } : null;
}

function snapTowardInside(poly, lng, lat) {
  const anchor = turf.pointOnFeature(poly);
  const ax = anchor.geometry.coordinates[0];
  const ay = anchor.geometry.coordinates[1];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    const px = ax * (1 - mid) + lng * mid;
    const py = ay * (1 - mid) + lat * mid;
    const p = turf.point([px, py]);
    if (turf.booleanPointInPolygon(p, poly)) lo = mid;
    else hi = mid;
  }
  return [ax * (1 - lo) + lng * lo, ay * (1 - lo) + lat * lo];
}

function hash01(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return (h >>> 0) / 2 ** 32;
}

/** Denser synthetic centerline (~9 segments) for streets not in OSM. */
function buildStreetLine(poly, streetName, lat, lng) {
  const h = hash01(streetName);
  const bearing = h * 2 * Math.PI;
  const perp = bearing + Math.PI / 2;
  const scale = 0.00038 + h * 0.00016;
  const coords = [];
  for (let i = -8; i <= 8; i += 1) {
    const t = i / 8;
    const lngP = lng + scale * t * Math.cos(bearing) + scale * 0.12 * Math.sin(perp) * (1 - Math.abs(t));
    const latP = lat + scale * t * Math.sin(bearing) * 0.92;
    const p = snapTowardInside(poly, lngP, latP);
    coords.push(p);
  }
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i += 1) {
    const c = coords[i];
    const p = out[out.length - 1];
    if (Math.hypot(c[0] - p[0], c[1] - p[1]) > 1e-9) out.push(c);
  }
  if (out.length < 2) {
    const a = snapTowardInside(poly, lng - 0.00015, lat - 0.0001);
    const b = snapTowardInside(poly, lng + 0.00015, lat + 0.0001);
    return [a, b];
  }
  return out;
}

function escapeOsmString(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Narrow union query — full bbox + every named highway was timing out on public Overpass. */
async function fetchOsmNamedWays(bbox) {
  const [west, south, east, north] = bbox;
  const names = new Set();
  for (const list of Object.values(STREET_OSM_NAMES)) {
    for (const n of list) {
      if (n) names.add(n);
    }
  }
  const union = [...names]
    .map((n) => `  way["highway"]["name"="${escapeOsmString(n)}"](${south},${west},${north},${east});`)
    .join('\n');
  const q = `[out:json][timeout:120];
(
${union}
);
out geom;`;

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: `data=${encodeURIComponent(q)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = await res.json();
  return data.elements || [];
}

function indexWaysByName(elements) {
  /** @type {Map<string, object[]>} */
  const map = new Map();
  for (const el of elements) {
    if (el.type !== 'way' || !el.tags?.name) continue;
    const key = normName(el.tags.name);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(el);
  }
  return map;
}

function simplifyCoords(coords) {
  if (coords.length < 2) return coords;
  try {
    return turf.simplify(turf.lineString(coords), { tolerance: 0.000012, highQuality: true }).geometry
      .coordinates;
  } catch {
    return coords;
  }
}

async function main() {
  const boundaryPath = path.join(root, 'src', 'assets', 'blueRidgeBoundary.json');
  const outPath = path.join(root, 'src', 'assets', 'streetNetwork.json');
  const cachePath = path.join(root, 'src', 'assets', 'osmHighwaysBlueRidge.cache.json');

  const fc = JSON.parse(fs.readFileSync(boundaryPath, 'utf8'));
  const ring = mergeBoundaryRing(fc);
  const poly = turf.polygon([ring]);
  const bbox = turf.bbox(poly);

  let elements;
  if (process.argv.includes('--offline') && fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    elements = cached.elements || [];
    console.log(`Using cached OSM data (${elements.length} elements)`);
  } else {
    console.log('Fetching OSM highways (Overpass)...');
    elements = await fetchOsmNamedWays(bbox);
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ fetchedAt: new Date().toISOString(), bbox, elements }, null, 0),
    );
    console.log(`Cached ${elements.length} elements to ${cachePath}`);
  }

  const byName = indexWaysByName(elements);

  /** @type {Record<string, import('geojson').LineString>} */
  const resolved = {};

  // First pass: OSM by name
  for (const [streetName, aliases] of Object.entries(STREET_OSM_NAMES)) {
    if (streetName === 'Starline Road Alley') continue;
    const collected = [];
    const seenWay = new Set();
    for (const al of aliases) {
      const ways = byName.get(normName(al));
      if (!ways) continue;
      for (const w of ways) {
        if (seenWay.has(w.id)) continue;
        seenWay.add(w.id);
        collected.push(w);
      }
    }
    if (collected.length === 0) continue;
    const merged = mergeOsmWaysToLine(collected, poly);
    if (!merged?.coordinates?.length) continue;
    const coords = simplifyCoords(merged.coordinates);
    if (coords.length >= 2) {
      resolved[streetName] = { type: 'LineString', coordinates: coords };
    }
  }

  // Starline Road Alley: offset from Starline Road if available
  if (!resolved['Starline Road Alley'] && resolved['Starline Road']) {
    const base = turf.feature(resolved['Starline Road']);
    for (const dist of [14, -14, 22, -22]) {
      try {
        const off = turf.lineOffset(base, dist, { units: 'meters' });
        const clipped = clipLineToPolygon(off, poly);
        if (clipped?.coordinates?.length >= 2) {
          const len = turf.length(turf.lineString(clipped.coordinates), { units: 'kilometers' });
          if (len > 0.02) {
            resolved['Starline Road Alley'] = {
              type: 'LineString',
              coordinates: simplifyCoords(clipped.coordinates),
            };
            break;
          }
        }
      } catch {
        /* try next */
      }
    }
  }

  const features = [];
  for (const streetName of Object.keys(STREET_COORDINATES)) {
    let geometry = resolved[streetName];
    if (!geometry) {
      const [lat, lng] = STREET_COORDINATES[streetName];
      const coordinates = buildStreetLine(poly, streetName, lat, lng);
      geometry = { type: 'LineString', coordinates };
    }
    const line = turf.lineString(geometry.coordinates);
    const len =
      geometry.coordinates.length >= 2 ? turf.length(line, { units: 'kilometers' }) : 0;
    if (len < 0.012) {
      console.warn(`Short trace for ${streetName}: ${len.toFixed(4)} km`);
    }
    features.push({
      type: 'Feature',
      properties: { streetName },
      geometry,
    });
  }

  const out = {
    type: 'FeatureCollection',
    name: 'Barangay Blue Ridge B — street centerlines (OSM + fallback)',
    features,
  };
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`Wrote ${features.length} features to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
