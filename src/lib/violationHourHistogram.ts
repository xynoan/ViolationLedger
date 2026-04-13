import type { Violation } from '@/types/parking';
import type { ResidentStreetName } from '@/lib/residentStreets';
import { RESIDENT_STREET_OPTIONS } from '@/lib/residentStreets';
import { violationMatchesResidentStreet } from '@/lib/residentStreetGeoAliases';

/** Format `minutes` (0–1439) as `HH:MM` 24h. */
export function formatClockHHMM(minutes: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(minutes)));
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Calendar hour 0–23 containing `minutes` since midnight (e.g. 17:42 → 17). */
export function hourIndexFromMinutes(minutes: number): number {
  return Math.min(23, Math.max(0, Math.floor(minutes / 60)));
}

/**
 * Count violations per roster street whose `timeDetected` falls in the same local **clock hour**
 * as `sliderMinutes` (e.g. any 5:xx PM event rolls into hour 17). Aggregates across all loaded dates
 * so barangay can see recurring hot hours.
 */
export function buildViolationCountByStreetForClockHour(
  violations: Violation[],
  sliderMinutes: number,
): Map<ResidentStreetName, number> {
  const targetHour = hourIndexFromMinutes(sliderMinutes);
  const map = new Map<ResidentStreetName, number>();
  for (const s of RESIDENT_STREET_OPTIONS) map.set(s, 0);

  for (const v of violations) {
    const d = new Date(v.timeDetected);
    if (d.getHours() !== targetHour) continue;
    for (const s of RESIDENT_STREET_OPTIONS) {
      if (violationMatchesResidentStreet(v, s)) {
        map.set(s, (map.get(s) ?? 0) + 1);
        break;
      }
    }
  }
  return map;
}

/** Mean open duration (minutes) for violations on `street` in that clock hour. */
export function avgViolationOpenMinutesForStreetInClockHour(
  violations: Violation[],
  street: ResidentStreetName,
  sliderMinutes: number,
): number | null {
  const targetHour = hourIndexFromMinutes(sliderMinutes);
  const matched = violations.filter((v) => {
    const d = new Date(v.timeDetected);
    return d.getHours() === targetHour && violationMatchesResidentStreet(v, street);
  });
  if (!matched.length) return null;
  const now = Date.now();
  const mins = matched.map((v) => {
    const t0 = new Date(v.timeDetected).getTime();
    const end = v.timeIssued ? new Date(v.timeIssued).getTime() : now;
    return Math.max(0, (end - t0) / 60000);
  });
  return Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
}

/** Local clock hour (0–23) with the most `timeDetected` events in `violations`. */
export function peakClockHourFromViolations(
  violations: Violation[],
): { hour: number; count: number } | null {
  const hourCounts = new Array(24).fill(0);
  for (const v of violations) {
    hourCounts[new Date(v.timeDetected).getHours()] += 1;
  }
  let bestHour = -1;
  let bestCount = 0;
  for (let h = 0; h < 24; h++) {
    if (hourCounts[h] > bestCount) {
      bestCount = hourCounts[h];
      bestHour = h;
    }
  }
  return bestHour >= 0 && bestCount > 0 ? { hour: bestHour, count: bestCount } : null;
}

/** e.g. 17 → "5:00 PM" in the user's locale. */
export function formatLocalHourShort(hour: number): string {
  const d = new Date(2000, 0, 1, hour, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
