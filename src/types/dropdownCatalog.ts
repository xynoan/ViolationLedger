/**
 * Catalog of selectable lists used across the app.
 * Keep in sync with `server/dropdown_config.js` defaults.
 */
export type VehicleTypeOption = { value: string; label: string };

/** Optional `color` is `#rrggbb` — used for violation status dots/badges when set. */
export type LabeledValue = { value: string; label: string; color?: string };

export type VisitorPurposePreset = {
  id: string;
  storageValue: string;
  label: string;
  category: 'guest' | 'delivery' | 'rental';
  rentedFieldMode: 'none' | 'resident' | 'facility';
};

export type DropdownCatalog = {
  vehicleTypes: VehicleTypeOption[];
  residentStreets: string[];
  rentedVenues: string[];
  residentOccupancyTypes: LabeledValue[];
  violationStatusFilters: LabeledValue[];
  residentStandingFilters: LabeledValue[];
  userRoles: LabeledValue[];
  userStatuses: LabeledValue[];
  visitorPurposePresets: VisitorPurposePreset[];
};

export const DEFAULT_DROPDOWN_CATALOG: DropdownCatalog = {
  vehicleTypes: [
    { value: 'car', label: 'Car' },
    { value: 'motorcycle', label: 'Motorcycle' },
    { value: 'truck', label: 'Truck' },
    { value: 'van', label: 'Van' },
    { value: 'suv', label: 'SUV' },
    { value: 'tricycle', label: 'Tricycle' },
    { value: 'other', label: 'Other' },
  ],
  residentStreets: [
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
  ],
  rentedVenues: ['Court', 'Community Center', 'Barangay Hall'],
  residentOccupancyTypes: [
    { value: 'homeowner', label: 'Homeowner' },
    { value: 'tenant', label: 'Tenant' },
  ],
  violationStatusFilters: [
    { value: 'all', label: 'All Statuses' },
    { value: 'warning', label: 'Warning' },
    { value: 'issued', label: 'Issued' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'cleared', label: 'Cleared' },
    { value: 'pending', label: 'Pending' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  residentStandingFilters: [
    { value: 'all', label: 'All' },
    { value: 'active_violations', label: 'Active Violations' },
    { value: 'clean', label: 'Clean Record' },
  ],
  userRoles: [
    { value: 'encoder', label: 'Encoder' },
    { value: 'barangay_user', label: 'Barangay User' },
  ],
  userStatuses: [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
  ],
  visitorPurposePresets: [
    {
      id: 'visit_resident',
      storageValue: 'Visit resident',
      label: 'Visit resident',
      category: 'guest',
      rentedFieldMode: 'resident',
    },
    {
      id: 'barangay_hall',
      storageValue: 'Barangay hall',
      label: 'Barangay hall',
      category: 'guest',
      rentedFieldMode: 'facility',
    },
    {
      id: 'reservation',
      storageValue: 'Reservation',
      label: 'Reservation',
      category: 'rental',
      rentedFieldMode: 'facility',
    },
    {
      id: 'drop_off',
      storageValue: 'Drop-off',
      label: 'Drop-off',
      category: 'guest',
      rentedFieldMode: 'none',
    },
    {
      id: 'delivery',
      storageValue: 'Delivery',
      label: 'Delivery',
      category: 'delivery',
      rentedFieldMode: 'none',
    },
  ],
};
