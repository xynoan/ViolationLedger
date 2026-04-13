import type { ResidentStreetName } from '@/lib/residentStreets';
import { RESIDENT_STREET_OPTIONS } from '@/lib/residentStreets';

/**
 * Representative GPS per registered street (Barangay Blue Ridge B).
 * Kept in lockstep with {@link RESIDENT_STREET_OPTIONS}.
 */
export const STREET_COORDINATES = {
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
} as const satisfies Record<ResidentStreetName, readonly [number, number]>;

export function assertStreetCoordinatesComplete(): void {
  for (const s of RESIDENT_STREET_OPTIONS) {
    if (!(s in STREET_COORDINATES)) {
      throw new Error(`STREET_COORDINATES missing: ${s}`);
    }
  }
}

/** Ordered points for map + roster views (same order as resident street dropdown). */
export function getStreetMapPoints(): { street: ResidentStreetName; lat: number; lng: number }[] {
  return RESIDENT_STREET_OPTIONS.map((street) => {
    const [lat, lng] = STREET_COORDINATES[street];
    return { street, lat, lng };
  });
}
