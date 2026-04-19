/** Shared defaults for configurable form dropdowns (server/runtime_config + client fallbacks). */

export const DEFAULT_VEHICLE_TYPE_OPTIONS = Object.freeze([
  { value: 'car', label: 'Car' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'truck', label: 'Truck' },
  { value: 'van', label: 'Van' },
  { value: 'suv', label: 'SUV' },
  { value: 'tricycle', label: 'Tricycle' },
  { value: 'other', label: 'Other' },
]);

export const DEFAULT_VISITOR_PURPOSES = Object.freeze([
  { label: 'Visit resident', category: 'guest' },
  { label: 'Barangay hall', category: 'guest' },
  { label: 'Reservation', category: 'rental' },
  { label: 'Drop-off', category: 'delivery' },
  { label: 'Delivery', category: 'delivery' },
]);

export const DEFAULT_RESIDENT_VISIT_PURPOSE_LABEL = 'Visit resident';

export const DEFAULT_RENTED_LOCATION_OPTIONS = Object.freeze([
  'Court',
  'Community Center',
  'Barangay Hall',
]);

export const DEFAULT_RESIDENT_STREETS = Object.freeze([
  'Twin Peaks Drive',
  'Milky Way Drive',
  'Moonlight Loop',
  "Comet's Loop",
  'Hillside Loop',
  'Starline Road',
  'Evening Glow Road',
  'Milky Way Lane',
  'Hillside Lane',
  'Starline Road Alley',
  'Promenade Lane',
  'Riverside Drive',
  'Riverview Drive',
  'Union Lane',
]);
