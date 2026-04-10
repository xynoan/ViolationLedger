export interface DwellStatus {
  minutes: number;
  label: string;
  tone: 'normal' | 'warning' | 'violation';
}

export function getDwellMinutes(firstDetected: string, lastSeen?: string): number {
  const firstMs = new Date(firstDetected).getTime();
  const lastMs = new Date(lastSeen || firstDetected).getTime();
  if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) return 0;
  return Math.max(0, Math.round((Math.max(firstMs, lastMs) - firstMs) / 60000));
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

export function getDwellStatus(minutes: number): DwellStatus {
  if (minutes < 15) {
    return { minutes, label: formatDuration(minutes), tone: 'normal' };
  }
  if (minutes <= 30) {
    return { minutes, label: formatDuration(minutes), tone: 'warning' };
  }
  return { minutes, label: formatDuration(minutes), tone: 'violation' };
}

export function getDwellBadgeClasses(tone: DwellStatus['tone']): string {
  if (tone === 'normal') {
    return 'bg-green-500/10 text-green-700 border-green-500/30';
  }
  if (tone === 'warning') {
    return 'bg-amber-500/10 text-amber-700 border-amber-500/30';
  }
  return 'bg-red-500/10 text-red-700 border-red-500/30';
}

export function getDwellToneLabel(tone: DwellStatus['tone']): string {
  if (tone === 'normal') return 'Normal';
  if (tone === 'warning') return 'Warning';
  return 'Potential Violation';
}
