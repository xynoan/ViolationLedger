import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNTIME_CONFIG_PATH = join(__dirname, 'runtime_config.json');

export const DEFAULT_OWNER_SMS_DELAY_MINUTES = 5;
export const DEFAULT_GRACE_PERIOD_MINUTES = 30;
/** After grace ends, wait this long with no post-grace plate detection before auto-clearing the warning. */
export const DEFAULT_POST_GRACE_VERIFICATION_MINUTES = 5;

const DEFAULT_CONFIG = Object.freeze({
  ownerSmsDelayMinutes: DEFAULT_OWNER_SMS_DELAY_MINUTES,
  ownerSmsDelayDisabledForDemo: false,
  gracePeriodMinutes: DEFAULT_GRACE_PERIOD_MINUTES,
  postGraceVerificationMinutes: DEFAULT_POST_GRACE_VERIFICATION_MINUTES,
});

function clampPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function sanitizeConfig(raw) {
  return {
    ownerSmsDelayMinutes: clampPositiveInteger(
      raw?.ownerSmsDelayMinutes,
      DEFAULT_OWNER_SMS_DELAY_MINUTES,
    ),
    ownerSmsDelayDisabledForDemo: Boolean(raw?.ownerSmsDelayDisabledForDemo),
    gracePeriodMinutes: clampPositiveInteger(
      raw?.gracePeriodMinutes,
      DEFAULT_GRACE_PERIOD_MINUTES,
    ),
    postGraceVerificationMinutes: clampPositiveInteger(
      raw?.postGraceVerificationMinutes,
      DEFAULT_POST_GRACE_VERIFICATION_MINUTES,
    ),
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
  runtimeConfigCache = { ...DEFAULT_CONFIG };
  return runtimeConfigCache;
}

function persistRuntimeConfig(nextConfig) {
  runtimeConfigCache = sanitizeConfig(nextConfig);
  fs.writeJsonSync(RUNTIME_CONFIG_PATH, runtimeConfigCache, { spaces: 2 });
  return runtimeConfigCache;
}

export function getRuntimeConfig() {
  const config = loadRuntimeConfig();
  return {
    ownerSmsDelayMinutes: config.ownerSmsDelayMinutes,
    ownerSmsDelayDisabledForDemo: config.ownerSmsDelayDisabledForDemo,
    gracePeriodMinutes: config.gracePeriodMinutes,
    postGraceVerificationMinutes: config.postGraceVerificationMinutes,
  };
}

export function updateRuntimeConfig(partial = {}) {
  const current = loadRuntimeConfig();
  const next = {
    ...current,
    ...partial,
  };
  return persistRuntimeConfig(next);
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
