/**
 * In-memory state for detection enabled/disabled toggle.
 * Used by detection_service (to pause/resume workers) and detect routes (API).
 */
let detectionEnabled = true;

export function getDetectionEnabled() {
  return detectionEnabled;
}

export function setDetectionEnabled(enabled) {
  detectionEnabled = Boolean(enabled);
}
