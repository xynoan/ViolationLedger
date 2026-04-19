import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DROPDOWN_CONFIG_PATH = join(__dirname, 'dropdown_config.json');

const VEHICLE_TYPE_VALUE_RE = /^[a-z0-9_]{1,48}$/;

export const DEFAULT_DROPDOWN_CONFIG = Object.freeze({
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
});

const VIOLATION_STATUS_ORDER = ['all', 'warning', 'issued', 'resolved', 'cleared', 'pending', 'cancelled'];
const STANDING_ORDER = ['all', 'active_violations', 'clean'];
const ROLE_ORDER = ['encoder', 'barangay_user'];
const STATUS_ORDER = ['active', 'inactive'];
const OCC_ORDER = ['homeowner', 'tenant'];

function trimString(v, maxLen) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function sanitizeVehicleTypes(raw) {
  const fallback = DEFAULT_DROPDOWN_CONFIG.vehicleTypes.map((x) => ({ ...x }));
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0) return fallback;
  const out = [];
  const seen = new Set();
  for (const row of list) {
    if (out.length >= 40) break;
    const value = trimString(row?.value, 48).toLowerCase();
    const label = trimString(row?.label, 80);
    if (!value || !label || !VEHICLE_TYPE_VALUE_RE.test(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label });
  }
  if (!out.some((x) => x.value === 'other')) {
    const other = fallback.find((x) => x.value === 'other');
    if (other) out.push({ ...other });
  }
  if (out.length === 0) return fallback;
  return out;
}

function sanitizeStringList(raw, fallback, { maxItems = 120, maxLen = 160 } = {}) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (out.length >= maxItems) break;
    const s = trimString(item, maxLen);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.length ? out : [...fallback];
}

const LABELED_SLUG_RE = /^[a-z][a-z0-9_]{1,47}$/;

function normLabeledValueSlug(v) {
  const s = trimString(v, 48).toLowerCase();
  return s.replace(/[^a-z0-9_]/g, '');
}

function sanitizeHexColor(raw) {
  let s = trimString(raw, 8);
  if (!s) return undefined;
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    const a = s[1];
    const b = s[2];
    const c = s[3];
    s = `#${a}${a}${b}${b}${c}${c}`.toLowerCase();
  }
  if (!/^#[0-9a-f]{6}$/i.test(s)) return undefined;
  return s.toLowerCase();
}

/**
 * Ordered labeled list: known ids first (preferredOrder), then other valid rows in raw order.
 * requiredValues are always present (merged from fallback if missing).
 * @param {boolean} [preserveColor] When true, optional `color` (`#rrggbb`) is kept for violation status rows.
 */
function sanitizeLabeledDynamicList(
  raw,
  fallback,
  preferredOrder,
  requiredValues,
  maxLabelLen,
  maxItems,
  preserveColor = false,
) {
  const fallbackMap = new Map(fallback.map((x) => [x.value, { ...x }]));
  const list = Array.isArray(raw) ? raw : [];
  const required = new Set(requiredValues);
  const merged = new Map();

  for (const row of list) {
    const value = normLabeledValueSlug(row?.value);
    if (!LABELED_SLUG_RE.test(value)) continue;
    const label = trimString(row?.label, maxLabelLen);
    if (!label) continue;
    const entry = { value, label };
    if (preserveColor) {
      const color = sanitizeHexColor(row?.color);
      if (color) entry.color = color;
    }
    merged.set(value, entry);
  }

  for (const v of required) {
    if (!merged.has(v) && fallbackMap.has(v)) {
      merged.set(v, { ...fallbackMap.get(v) });
    }
  }

  const out = [];
  const seen = new Set();
  for (const v of preferredOrder) {
    if (!merged.has(v)) continue;
    out.push(merged.get(v));
    seen.add(v);
    if (out.length >= maxItems) return out;
  }
  for (const row of list) {
    const value = normLabeledValueSlug(row?.value);
    if (!value || seen.has(value) || !merged.has(value)) continue;
    if (!LABELED_SLUG_RE.test(value)) continue;
    out.push(merged.get(value));
    seen.add(value);
    if (out.length >= maxItems) break;
  }
  return out;
}

const VISITOR_PRESET_ID_RE = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_CUSTOM_VISITOR_PRESETS = 24;

function sanitizeVisitorPresets(raw) {
  const defaults = DEFAULT_DROPDOWN_CONFIG.visitorPurposePresets;
  const fallbackBuiltins = defaults.map((x) => ({ ...x }));
  const builtinIds = new Set(fallbackBuiltins.map((x) => x.id));
  const byId = new Map(fallbackBuiltins.map((x) => [x.id, { ...x }]));
  const list = Array.isArray(raw) ? raw : [];

  for (const row of list) {
    const id = trimString(row?.id, 64);
    if (!builtinIds.has(id) || !byId.has(id)) continue;
    const prev = byId.get(id);
    const label = trimString(row?.label, 120);
    const category =
      row?.category === 'delivery' || row?.category === 'rental' || row?.category === 'guest'
        ? row.category
        : prev.category;
    const rentedFieldMode =
      row?.rentedFieldMode === 'resident' || row?.rentedFieldMode === 'facility' || row?.rentedFieldMode === 'none'
        ? row.rentedFieldMode
        : prev.rentedFieldMode;
    byId.set(id, {
      id,
      storageValue: prev.storageValue,
      label: label || prev.label,
      category,
      rentedFieldMode,
    });
  }

  const builtinsOrdered = defaults.map((x) => ({ ...byId.get(x.id) }));
  const usedStorage = new Set(builtinsOrdered.map((x) => x.storageValue.toLowerCase()));
  const seenCustomIds = new Set();
  const customs = [];

  for (const row of list) {
    if (customs.length >= MAX_CUSTOM_VISITOR_PRESETS) break;
    const id = trimString(row?.id, 64);
    if (!id || builtinIds.has(id) || seenCustomIds.has(id)) continue;
    if (!VISITOR_PRESET_ID_RE.test(id)) continue;

    const label = trimString(row?.label, 120);
    if (!label) continue;

    let storageValue = trimString(row?.storageValue, 120) || label;
    const category =
      row?.category === 'delivery' || row?.category === 'rental' || row?.category === 'guest' ? row.category : 'guest';
    const rentedFieldMode =
      row?.rentedFieldMode === 'resident' || row?.rentedFieldMode === 'facility' || row?.rentedFieldMode === 'none'
        ? row.rentedFieldMode
        : 'none';

    let n = 0;
    while (usedStorage.has(storageValue.toLowerCase())) {
      n += 1;
      storageValue = `${label} (${n})`;
      if (storageValue.length > 120) storageValue = storageValue.slice(0, 120);
    }
    usedStorage.add(storageValue.toLowerCase());

    seenCustomIds.add(id);
    customs.push({ id, storageValue, label, category, rentedFieldMode });
  }

  return [...builtinsOrdered, ...customs];
}

function sanitizeDropdownConfig(raw) {
  return {
    vehicleTypes: sanitizeVehicleTypes(raw?.vehicleTypes),
    residentStreets: sanitizeStringList(raw?.residentStreets, [...DEFAULT_DROPDOWN_CONFIG.residentStreets]),
    rentedVenues: sanitizeStringList(raw?.rentedVenues, [...DEFAULT_DROPDOWN_CONFIG.rentedVenues], {
      maxItems: 60,
      maxLen: 120,
    }),
    residentOccupancyTypes: sanitizeLabeledDynamicList(
      raw?.residentOccupancyTypes,
      [...DEFAULT_DROPDOWN_CONFIG.residentOccupancyTypes],
      OCC_ORDER,
      OCC_ORDER,
      80,
      24,
    ),
    violationStatusFilters: sanitizeLabeledDynamicList(
      raw?.violationStatusFilters,
      [...DEFAULT_DROPDOWN_CONFIG.violationStatusFilters],
      VIOLATION_STATUS_ORDER,
      VIOLATION_STATUS_ORDER,
      120,
      24,
      true,
    ),
    residentStandingFilters: sanitizeLabeledDynamicList(
      raw?.residentStandingFilters,
      [...DEFAULT_DROPDOWN_CONFIG.residentStandingFilters],
      STANDING_ORDER,
      STANDING_ORDER,
      120,
      24,
    ),
    userRoles: sanitizeLabeledDynamicList(
      raw?.userRoles,
      [...DEFAULT_DROPDOWN_CONFIG.userRoles],
      ROLE_ORDER,
      ROLE_ORDER,
      80,
      24,
    ),
    userStatuses: sanitizeLabeledDynamicList(
      raw?.userStatuses,
      [...DEFAULT_DROPDOWN_CONFIG.userStatuses],
      STATUS_ORDER,
      STATUS_ORDER,
      80,
      24,
    ),
    visitorPurposePresets: sanitizeVisitorPresets(raw?.visitorPurposePresets),
  };
}

let dropdownConfigCache = null;

function loadDropdownConfig() {
  if (dropdownConfigCache) return dropdownConfigCache;
  try {
    if (fs.existsSync(DROPDOWN_CONFIG_PATH)) {
      const raw = fs.readJsonSync(DROPDOWN_CONFIG_PATH);
      dropdownConfigCache = sanitizeDropdownConfig(raw);
      return dropdownConfigCache;
    }
  } catch (error) {
    console.warn('⚠️  Failed to load dropdown config, using defaults:', error?.message || error);
  }
  dropdownConfigCache = sanitizeDropdownConfig({});
  return dropdownConfigCache;
}

function persistDropdownConfig(next) {
  dropdownConfigCache = sanitizeDropdownConfig(next);
  fs.writeJsonSync(DROPDOWN_CONFIG_PATH, dropdownConfigCache, { spaces: 2 });
  return dropdownConfigCache;
}

export function getDropdownConfig() {
  return { ...loadDropdownConfig() };
}

export function updateDropdownConfig(partial) {
  const current = loadDropdownConfig();
  return persistDropdownConfig({
    ...current,
    ...partial,
  });
}

export function resetDropdownConfigToDefaults() {
  return persistDropdownConfig({ ...DEFAULT_DROPDOWN_CONFIG });
}
