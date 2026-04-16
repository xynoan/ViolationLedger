import type { Violation } from '@/types/parking';
import type { ResidentStreetName } from '@/lib/residentStreets';
import { RESIDENT_STREET_OPTIONS, RESIDENT_STREET_SET } from '@/lib/residentStreets';
import { resolveHeatmapZone, type HeatmapZoneId } from '@/lib/blueRidgeGeofence';

const ZONE_TO_CANONICAL: Record<HeatmapZoneId, ResidentStreetName> = {
  twinPeaks: 'Twin Peaks Drive',
  moonlight: 'Moonlight Loop',
  riverview: 'Riverview Drive',
  comet: "Comet's Loop",
};

const STREET_ALIAS_TO_CANONICAL: [string, ResidentStreetName][] = [
  ['twin peaks dr', 'Twin Peaks Drive'],
  ['twin peaks drive', 'Twin Peaks Drive'],
  ['twin peaks', 'Twin Peaks Drive'],
  ['milky way drive', 'Milky Way Drive'],
  ['milky way lane', 'Milky Way Lane'],
  ['milky way', 'Milky Way Drive'],
  ['moonlight loop', 'Moonlight Loop'],
  ['moonlight', 'Moonlight Loop'],
  ["comet's loop", "Comet's Loop"],
  ['comet', "Comet's Loop"],
  ['hillside loop', 'Hillside Loop'],
  ['hillside lane', 'Hillside Lane'],
  ['starline road alley', 'Starline Road Alley'],
  ['starline road', 'Starline Road'],
  ['starline', 'Starline Road'],
  ['evening glow road', 'Evening Glow Road'],
  ['evening glow', 'Evening Glow Road'],
  ['promenade lane', 'Promenade Lane'],
  ['promenade', 'Promenade Lane'],
  ['riverview drive', 'Riverview Drive'],
  ['riverview dr', 'Riverview Drive'],
  ['riverview', 'Riverview Drive'],
  ['riverside drive', 'Riverside Drive'],
  ['riverside', 'Riverside Drive'],
  ['union lane', 'Union Lane'],
  ['union', 'Union Lane'],
];

export function isActiveViolationForStreetHeat(v: Violation): boolean {
  return v.status === 'warning' || v.status === 'pending';
}

export function resolveViolationToResidentStreet(v: Violation): ResidentStreetName | null {
  const z = resolveHeatmapZone(v.cameraLocationId || '');
  if (z) return ZONE_TO_CANONICAL[z];

  const raw = (v.cameraLocationId || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  for (const street of RESIDENT_STREET_OPTIONS) {
    if (lower === street.toLowerCase()) return street;
  }

  for (const [alias, street] of STREET_ALIAS_TO_CANONICAL) {
    if (lower === alias || lower.includes(alias)) return street;
  }

  if (lower.includes('twin') && lower.includes('peak')) return 'Twin Peaks Drive';
  if (lower.includes('hillside') && lower.includes('loop')) return 'Hillside Loop';
  if (lower.includes('hillside') && lower.includes('lane')) return 'Hillside Lane';
  if (lower.includes('starline') && lower.includes('alley')) return 'Starline Road Alley';
  if (lower.includes('starline')) return 'Starline Road';
  if (lower.includes('evening') && lower.includes('glow')) return 'Evening Glow Road';
  if (lower.includes('promenade')) return 'Promenade Lane';
  if (lower.includes('riverview')) return 'Riverview Drive';
  if (lower.includes('riverside')) return 'Riverside Drive';
  if (lower.includes('union') && lower.includes('lane')) return 'Union Lane';
  if (lower.includes('milky') && lower.includes('lane')) return 'Milky Way Lane';
  if (lower.includes('milky')) return 'Milky Way Drive';
  if (lower.includes('moonlight')) return 'Moonlight Loop';
  if (lower.includes('comet')) return "Comet's Loop";

  return null;
}

/** Value matched to OSM `properties.name` on SVG street paths (`location` if set, else `cameraLocationId`). */
export function violationLocationForHeatmap(v: Violation): string {
  return (v.location ?? v.cameraLocationId ?? '').trim();
}

/** One pass: active counts keyed by exact `violationLocationForHeatmap` string (match to GeoJSON `properties.name`). */
export function buildActiveViolationCountsByHeatmapLocation(violations: Violation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of violations) {
    if (!isActiveViolationForStreetHeat(v)) continue;
    const loc = violationLocationForHeatmap(v);
    if (!loc) continue;
    m.set(loc, (m.get(loc) ?? 0) + 1);
  }
  return m;
}

/** Counts active (warning + pending) violations per resident street only. */
export function countActiveViolationsByStreet(violations: Violation[]): Map<ResidentStreetName, number> {
  const byStreet = new Map<ResidentStreetName, number>();
  for (const v of violations) {
    if (!isActiveViolationForStreetHeat(v)) continue;
    const street = resolveViolationToResidentStreet(v);
    if (!street || !RESIDENT_STREET_SET.has(street)) continue;
    byStreet.set(street, (byStreet.get(street) || 0) + 1);
  }
  return byStreet;
}
