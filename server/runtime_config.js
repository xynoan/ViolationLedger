import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  DEFAULT_VEHICLE_TYPE_OPTIONS,
  DEFAULT_VISITOR_PURPOSES,
  DEFAULT_RESIDENT_VISIT_PURPOSE_LABEL,
  DEFAULT_RENTED_LOCATION_OPTIONS,
  DEFAULT_RESIDENT_STREETS,
} from './form_options_defaults.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNTIME_CONFIG_PATH = join(__dirname, 'runtime_config.json');

export const DEFAULT_OWNER_SMS_DELAY_MINUTES = 5;
export const DEFAULT_GRACE_PERIOD_MINUTES = 30;
/** After grace ends, wait this long with no post-grace plate detection before auto-clearing the warning. */
export const DEFAULT_POST_GRACE_VERIFICATION_MINUTES = 5;

const ALLOWED_VISITOR_CATEGORIES = new Set(['guest', 'delivery', 'rental']);

function clampPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function sanitizeVehicleTypeOptions(raw) {
  const arr = Array.isArray(raw) ? raw : null;
  const fallback = [...DEFAULT_VEHICLE_TYPE_OPTIONS];
  if (!arr || arr.length === 0) return fallback;
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    let value;
    let label;
    if (typeof item === 'string') {
      label = item.trim();
      if (!label) continue;
      value = label
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
      if (!value) value = `type_${seen.size}`;
    } else if (item && typeof item === 'object') {
      label = String(item.label ?? '').trim();
      const rawVal = String(item.value ?? '').trim();
      value = rawVal
        ? rawVal.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
        : '';
      if (!label) continue;
      if (!value) {
        value = label
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9_]/g, '');
      }
      if (!value) value = `type_${seen.size}`;
    } else {
      continue;
    }
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label });
  }
  if (out.length === 0) return fallback;
  if (!out.some((x) => x.value === 'other')) {
    out.push({ value: 'other', label: 'Other' });
  }
  return out;
}

function sanitizeVisitorPurposes(raw) {
  const arr = Array.isArray(raw) ? raw : null;
  const fallback = [...DEFAULT_VISITOR_PURPOSES];
  if (!arr || arr.length === 0) return fallback;
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const label = String(item.label ?? '').trim();
    const category = String(item.category ?? '').toLowerCase().trim();
    if (!label || !ALLOWED_VISITOR_CATEGORIES.has(category)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, category });
  }
  return out.length > 0 ? out : fallback;
}

function sanitizeResidentVisitPurposeLabel(raw, purposes) {
  const labels = purposes.map((p) => p.label);
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (t && labels.includes(t)) return t;
  const guest = purposes.find((p) => p.category === 'guest');
  if (guest) return guest.label;
  return DEFAULT_RESIDENT_VISIT_PURPOSE_LABEL;
}

function sanitizeStringList(raw, fallback) {
  const arr = Array.isArray(raw) ? raw : null;
  const fb = [...fallback];
  if (!arr || arr.length === 0) return fb;
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const s = typeof item === 'string' ? item.trim() : String(item ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.length > 0 ? out : fb;
}

function sanitizeConfig(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const purposes = sanitizeVisitorPurposes(base.visitorPurposes);
  return {
    ownerSmsDelayMinutes: clampPositiveInteger(
      base.ownerSmsDelayMinutes,
      DEFAULT_OWNER_SMS_DELAY_MINUTES,
    ),
    ownerSmsDelayDisabledForDemo: Boolean(base.ownerSmsDelayDisabledForDemo),
    gracePeriodMinutes: clampPositiveInteger(
      base.gracePeriodMinutes,
      DEFAULT_GRACE_PERIOD_MINUTES,
    ),
    postGraceVerificationMinutes: clampPositiveInteger(
      base.postGraceVerificationMinutes,
      DEFAULT_POST_GRACE_VERIFICATION_MINUTES,
    ),
    vehicleTypeOptions: sanitizeVehicleTypeOptions(base.vehicleTypeOptions),
    visitorPurposes: purposes,
    residentVisitPurposeLabel: sanitizeResidentVisitPurposeLabel(
      base.residentVisitPurposeLabel,
      purposes,
    ),
    rentedLocationOptions: sanitizeStringList(
      base.rentedLocationOptions,
      [...DEFAULT_RENTED_LOCATION_OPTIONS],
    ),
    residentStreets: sanitizeStringList(base.residentStreets, [...DEFAULT_RESIDENT_STREETS]),
  };
}

let runtimeConfigCache = null;

function loadRuntimeConfig() {
  if (runtimeConfigCache) return runtimeConfigCache;
  try {
    if (fs.existsSync(RUNTIME_CONFIG_PATH)) {
      const raw = fs.readJsonSync(RUNTIME_CONFIG_PATH);
      runtimeConfigCache = sanitizeConfig(raw);
      return runtimeConfigCache;
    }
  } catch (error) {
    console.warn('⚠️  Failed to load runtime config, using defaults:', error?.message || error);
  }
  runtimeConfigCache = sanitizeConfig({});
  return runtimeConfigCache;
}

function persistRuntimeConfig(nextConfig) {
  runtimeConfigCache = sanitizeConfig(nextConfig);
  fs.writeJsonSync(RUNTIME_CONFIG_PATH, runtimeConfigCache, { spaces: 2 });
  return runtimeConfigCache;
}

export function getRuntimeConfig() {
  return loadRuntimeConfig();
}

export function updateRuntimeConfig(partial = {}) {
  const current = loadRuntimeConfig();
  const next = {
    ...current,
    ...partial,
  };
  return persistRuntimeConfig(next);
}

export function getResidentStreetOptions() {
  return getRuntimeConfig().residentStreets;
}

export function getOwnerSmsDelayConfig() {
  const config = getRuntimeConfig();
  return {
    delayMinutes: config.ownerSmsDelayMinutes,
    disabledForDemo: config.ownerSmsDelayDisabledForDemo,
    effectiveDelayMinutes: config.ownerSmsDelayDisabledForDemo ? 0 : config.ownerSmsDelayMinutes,
  };
}

export function setOwnerSmsDelayDisabledForDemo(disabled) {
  updateRuntimeConfig({ ownerSmsDelayDisabledForDemo: Boolean(disabled) });
  return getOwnerSmsDelayConfig();
}

export function setOwnerSmsDelayMinutes(delayMinutes) {
  updateRuntimeConfig({
    ownerSmsDelayMinutes: clampPositiveInteger(delayMinutes, DEFAULT_OWNER_SMS_DELAY_MINUTES),
  });
  return getOwnerSmsDelayConfig();
}

export function getGracePeriodMinutes() {
  return getRuntimeConfig().gracePeriodMinutes;
}

export function setGracePeriodMinutes(gracePeriodMinutes) {
  return updateRuntimeConfig({
    gracePeriodMinutes: clampPositiveInteger(gracePeriodMinutes, DEFAULT_GRACE_PERIOD_MINUTES),
  }).gracePeriodMinutes;
}

export function getPostGraceVerificationMinutes() {
  return getRuntimeConfig().postGraceVerificationMinutes;
}

export function setPostGraceVerificationMinutes(postGraceVerificationMinutes) {
  return updateRuntimeConfig({
    postGraceVerificationMinutes: clampPositiveInteger(
      postGraceVerificationMinutes,
      DEFAULT_POST_GRACE_VERIFICATION_MINUTES,
    ),
  }).postGraceVerificationMinutes;
}
