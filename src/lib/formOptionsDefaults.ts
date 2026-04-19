/** Client fallbacks when runtime config is unavailable (matches server/form_options_defaults.js). */

import type { VehicleTypeOption, VisitorPurposeOption } from './formOptions';

export const DEFAULT_VEHICLE_TYPE_OPTIONS: VehicleTypeOption[] = [
  { value: 'car', label: 'Car' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'truck', label: 'Truck' },
  { value: 'van', label: 'Van' },
  { value: 'suv', label: 'SUV' },
  { value: 'tricycle', label: 'Tricycle' },
  { value: 'other', label: 'Other' },
];

export const DEFAULT_VISITOR_PURPOSES: VisitorPurposeOption[] = [
  { label: 'Visit resident', category: 'guest' },
  { label: 'Barangay hall', category: 'guest' },
  { label: 'Reservation', category: 'rental' },
  { label: 'Drop-off', category: 'delivery' },
  { label: 'Delivery', category: 'delivery' },
];

export const DEFAULT_RESIDENT_VISIT_PURPOSE_LABEL = 'Visit resident';

export const DEFAULT_RENTED_LOCATION_OPTIONS = [
  'Court',
  'Community Center',
  'Barangay Hall',
] as const;

export const DEFAULT_RESIDENT_STREETS = [
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
] as const;
