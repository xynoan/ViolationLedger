import type { CSSProperties } from 'react';

export type StreetPathStyle = {
  style: CSSProperties;
  /** CSS class for tier 6+ pulse (stroke / glow animation). */
  className?: string;
};

/**
 * Variable stroke intensity by violation count (e.g. historical volume in the selected clock-hour).
 */
export function getStreetStyle(count: number): StreetPathStyle {
  if (count <= 0) {
    return {
      style: {
        stroke: '#1e293b',
        strokeWidth: 1.5,
        filter: 'none',
      },
    };
  }
  if (count <= 2) {
    return {
      style: {
        stroke: '#0ea5e9',
        strokeWidth: 3,
        filter: 'none',
      },
    };
  }
  if (count <= 5) {
    return {
      style: {
        stroke: '#f59e0b',
        strokeWidth: 5,
        filter: 'drop-shadow(0 0 5px #f59e0b)',
      },
    };
  }
  return {
    style: {
      stroke: '#ef4444',
      strokeWidth: 8,
      filter: 'drop-shadow(0 0 12px #ef4444)',
    },
    className: 'br-map-tier-pulse',
  };
}
