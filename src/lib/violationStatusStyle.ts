import type { CSSProperties } from 'react';
import type { LabeledValue } from '@/types/dropdownCatalog';

/** Normalize to `#rrggbb` or return undefined. */
export function sanitizeHexColor(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let s = raw.trim();
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

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

/** Default dot/badge colors by status code (matches prior Tailwind choices). */
export function defaultViolationStatusHex(code: string): string {
  const map: Record<string, string> = {
    all: '#94a3b8',
    warning: '#f59e0b',
    issued: '#dc2626',
    resolved: '#22c55e',
    cleared: '#059669',
    pending: '#3b82f6',
    cancelled: '#64748b',
  };
  return map[code] ?? '#64748b';
}

/** Resolved display color: saved catalog color, else built-in default for this code. */
export function resolvedViolationStatusHex(row: Pick<LabeledValue, 'value' | 'color'>): string {
  return sanitizeHexColor(row.color) ?? defaultViolationStatusHex(row.value);
}

export function rgbaFromHex(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Text that reads on top of a light tinted badge derived from `hex`. */
export function contrastBadgeText(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? '#0f172a' : '#f8fafc';
}

export function violationStatusBadgeSurface(hex: string): CSSProperties {
  return {
    backgroundColor: rgbaFromHex(hex, 0.18),
    borderColor: rgbaFromHex(hex, 0.5),
    color: contrastBadgeText(hex),
  };
}
