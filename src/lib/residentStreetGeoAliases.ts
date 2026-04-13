import type { Violation } from '@/types/parking';
import type { ResidentStreetName } from '@/lib/residentStreets';
import { RESIDENT_STREET_OPTIONS, RESIDENT_STREET_SET } from '@/lib/residentStreets';
import {
  buildActiveViolationCountsByHeatmapLocation,
  isActiveViolationForStreetHeat,
  resolveViolationToResidentStreet,
  violationLocationForHeatmap,
} from '@/lib/violationStreetAttribution';

/** OSM / heatmap `name` tags that map to a roster street (exact string match on violations). */
const GEO_EXTRA_NAMES: Partial<Record<ResidentStreetName, readonly string[]>> = {
  'Milky Way Drive': ['Milkyway Drive'],
  "Comet's Loop": ['Comets Loop'],
  'Promenade Lane': ['Promenade Line'],
};

export function geoNamesForResidentStreet(street: ResidentStreetName): readonly string[] {
  const extra = GEO_EXTRA_NAMES[street];
  return extra ? [street, ...extra] : [street];
}

/** Map GeoJSON `properties.name` to roster street, or null if outside roster (decorative segment). */
export function mapGeoNameToResidentStreet(geoName: string): ResidentStreetName | null {
  const n = geoName.trim();
  if (!n) return null;
  if (RESIDENT_STREET_SET.has(n)) return n as ResidentStreetName;
  for (const street of RESIDENT_STREET_OPTIONS) {
    if (GEO_EXTRA_NAMES[street]?.includes(n)) return street;
  }
  return null;
}

export function violationMatchesResidentStreet(v: Violation, street: ResidentStreetName): boolean {
  if (resolveViolationToResidentStreet(v) === street) return true;
  const loc = violationLocationForHeatmap(v);
  if (!loc) return false;
  for (const g of geoNamesForResidentStreet(street)) {
    if (loc === g) return true;
  }
  return false;
}

/** Active (warning + pending) counts aggregated per roster street (sums OSM alias strings). */
export function buildActiveViolationCountsByResidentForHeatmap(
  violations: Violation[],
): Map<ResidentStreetName, number> {
  const osm = buildActiveViolationCountsByHeatmapLocation(violations);
  const by = new Map<ResidentStreetName, number>();
  for (const street of RESIDENT_STREET_OPTIONS) {
    let n = 0;
    for (const g of geoNamesForResidentStreet(street)) {
      n += osm.get(g) ?? 0;
    }
    by.set(street, n);
  }
  return by;
}

/**
 * Warning + pending counts per roster street using the same attribution as the SVG historical layer
 * (`violationMatchesResidentStreet`), so live overlays align with clock-hour glow.
 */
export function buildLiveEnforcementCountsByResidentStreet(
  violations: Violation[],
): Map<ResidentStreetName, number> {
  const map = new Map<ResidentStreetName, number>();
  for (const s of RESIDENT_STREET_OPTIONS) map.set(s, 0);
  for (const v of violations) {
    if (!isActiveViolationForStreetHeat(v)) continue;
    for (const s of RESIDENT_STREET_OPTIONS) {
      if (violationMatchesResidentStreet(v, s)) {
        map.set(s, (map.get(s) ?? 0) + 1);
        break;
      }
    }
  }
  return map;
}

/** Mean open duration in minutes (detected → issued or now) for violations tied to the street. */
export function avgViolationOpenMinutesForStreet(
  violations: Violation[],
  street: ResidentStreetName,
): number | null {
  const matched = violations.filter((v) => violationMatchesResidentStreet(v, street));
  if (!matched.length) return null;
  const now = Date.now();
  const mins = matched.map((v) => {
    const t0 = new Date(v.timeDetected).getTime();
    const end = v.timeIssued ? new Date(v.timeIssued).getTime() : now;
    return Math.max(0, (end - t0) / 60000);
  });
  return Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
}
