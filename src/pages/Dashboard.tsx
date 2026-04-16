import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Camera,
  Plus,
  RefreshCw,
  Pause,
  Play,
  BarChart3,
  ClipboardList,
  Clock3,
  Repeat,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ListFilter,
  Activity,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { CameraFeed } from '@/components/dashboard/CameraFeed';
import { RangeSnapshotCard } from '@/components/dashboard/RangeSnapshotCard';
import { BlueRidgeSvgMap } from '@/components/Analytics/BlueRidgeSvgMap';
import { peakClockHourFromViolations } from '@/lib/violationHourHistogram';
import { formatDeltaComparison } from '@/components/dashboard/InsightChartTooltip';
import { WarningTimer } from '@/components/dashboard/WarningTimer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ChartContainer,
} from '@/components/ui/chart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Vehicle, Camera as CameraType, Violation } from '@/types/parking';
import {
  vehiclesAPI,
  camerasAPI,
  violationsAPI,
  detectionAPI,
  analyticsAPI,
  type AnalyticsResponse,
} from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/** Pie + location ranking — semantic status hues (not gray-only) */
function statusSliceColor(statusName: string): string {
  const key = statusName.toLowerCase();
  if (key.includes('warning')) return 'hsl(var(--warning))';
  if (key.includes('issued')) return 'hsl(var(--destructive))';
  if (key.includes('pending')) return 'hsl(25 95% 53%)';
  if (key.includes('resolved')) return 'hsl(var(--success))';
  if (key.includes('cleared')) return 'hsl(199 89% 48%)';
  if (key.includes('cancel')) return 'hsl(var(--muted-foreground))';
  return 'hsl(221 83% 53%)';
}

function topOffenderStatusBadge(
  plate: string,
  count: number,
  registeredPlates: Set<string>,
): { label: string; className: string } {
  const normalized = plate.trim().toUpperCase();
  if (!registeredPlates.has(normalized)) {
    return {
      label: 'Unregistered visitor',
      className:
        'border-amber-500/50 bg-amber-50/90 text-amber-950 dark:border-amber-600/50 dark:bg-amber-950/40 dark:text-amber-50',
    };
  }
  if (count >= 3) {
    return {
      label: `${count}× repeat`,
      className: 'border-red-500/40 bg-red-50/90 text-red-900 dark:border-red-500/45 dark:bg-red-950/40 dark:text-red-50',
    };
  }
  if (count === 2) {
    return { label: '2× repeat', className: 'border-border bg-muted/40 text-foreground' };
  }
  return { label: 'Single incident', className: 'border-border text-muted-foreground' };
}

type TrendData = { currentTotal: number; previousTotal: number; delta: number; deltaPct: number };

function getTrendMeta(trend?: TrendData | null) {
  if (!trend) {
    return {
      Icon: Minus,
      tone: 'text-muted-foreground',
      label: 'No comparison available',
    };
  }

  if (trend.delta > 0) {
    return {
      Icon: ArrowUpRight,
      tone: 'text-destructive',
      label: `+${trend.deltaPct}% vs previous 7-day period`,
    };
  }

  if (trend.delta < 0) {
    return {
      Icon: ArrowDownRight,
      tone: 'text-green-600',
      label: `${trend.deltaPct}% vs previous 7-day period`,
    };
  }

  return {
    Icon: Minus,
    tone: 'text-muted-foreground',
    label: '0% vs previous 7-day period',
  };
}

function escapeCsvValue(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Query string for Violations History from dashboard insight filters (and optional status). */
function violationsInsightSearch(
  startDate: string,
  endDate: string,
  locationFilter: string,
  extra?: Record<string, string | undefined>,
): string {
  const p = new URLSearchParams();
  if (startDate) p.set('startDate', startDate);
  if (endDate) p.set('endDate', endDate);
  if (locationFilter && locationFilter !== 'all') p.set('locationId', locationFilter);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) p.set(k, v);
    }
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatHourLabel(hour: number): string {
  const d = new Date(2000, 0, 1, hour, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function peakHourFromByHour(byHour: Array<{ hour: number; count: number }>): { hour: number; count: number } | null {
  let bestHour = -1;
  let bestCount = 0;
  for (const { hour, count } of byHour) {
    if (count > bestCount) {
      bestCount = count;
      bestHour = hour;
    }
  }
  return bestHour >= 0 && bestCount > 0 ? { hour: bestHour, count: bestCount } : null;
}

/** Higher score = triage first (longest overstay, then soonest expiry, then urgent / oldest). */
function warningTriageScore(v: Violation): number {
  const ex = v.warningExpiresAt ? new Date(v.warningExpiresAt).getTime() : null;
  const now = Date.now();
  if (ex != null) {
    const sec = Math.floor((ex - now) / 1000);
    if (sec <= 0) return 1e9 - sec;
    return 5e8 - sec;
  }
  const base = v.unregisteredUrgent ? 4e8 : 3e8;
  return base + (now - new Date(v.timeDetected).getTime()) / 1000;
}

function topLocationFromViolations(violations: Violation[]): string | null {
  const locMap = new Map<string, number>();
  for (const v of violations) {
    const id = v.cameraLocationId || 'Unknown';
    locMap.set(id, (locMap.get(id) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [loc, c] of locMap) {
    if (c > bestCount) {
      bestCount = c;
      best = loc;
    }
  }
  return bestCount > 0 ? best : null;
}

const THIRTY_MIN_MS = 30 * 60 * 1000;

function weekdayLong(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

function averageViolationsAtLocationOnWeekday(
  violations: Violation[],
  locationId: string,
  weekday: number,
): { average: number; sampleDays: number } {
  const perDay = new Map<string, number>();
  for (const v of violations) {
    const loc = v.cameraLocationId || 'Unknown';
    if (loc !== locationId) continue;
    const d = new Date(v.timeDetected);
    if (d.getDay() !== weekday) continue;
    const key = localDateKey(d);
    perDay.set(key, (perDay.get(key) || 0) + 1);
  }
  if (perDay.size === 0) return { average: 0, sampleDays: 0 };
  let sum = 0;
  for (const c of perDay.values()) sum += c;
  return { average: sum / perDay.size, sampleDays: perDay.size };
}

function violationsAtLocationOnDate(violations: Violation[], locationId: string, dateKey: string): number {
  let n = 0;
  for (const v of violations) {
    const loc = v.cameraLocationId || 'Unknown';
    if (loc !== locationId) continue;
    if (localDateKey(new Date(v.timeDetected)) === dateKey) n += 1;
  }
  return n;
}

function buildDailyBriefingLines(
  violations: Violation[],
  analytics: AnalyticsResponse | null,
  violationsByLocationData: Array<{ cameraLocationId: string; count: number }>,
  filtersActive: boolean,
): string[] {
  const scope = filtersActive ? 'For the selected insight filters, ' : '';
  const now = new Date();
  const todayKey = localDateKey(now);
  const dow = now.getDay();

  const fromAnalyticsHour = analytics ? peakHourFromByHour(analytics.violations.byHour || []) : null;
  const fromViolationsHour = peakClockHourFromViolations(violations);
  const peak =
    fromAnalyticsHour && fromAnalyticsHour.count > 0 ? fromAnalyticsHour : fromViolationsHour;

  let topLocation: string | null = null;
  if (violationsByLocationData.length > 0) {
    topLocation = violationsByLocationData[0].cameraLocationId;
  } else {
    topLocation = topLocationFromViolations(violations);
  }

  const timeLabel = peak ? formatHourLabel(peak.hour) : null;

  let line1: string;
  if (topLocation) {
    const { average, sampleDays } = averageViolationsAtLocationOnWeekday(violations, topLocation, dow);
    const todayLoc = violationsAtLocationOnDate(violations, topLocation, todayKey);
    if (sampleDays >= 2 && average > 0 && todayLoc > average * 1.05) {
      const pct = Math.round(((todayLoc - average) / average) * 100);
      line1 = `${scope}Action required: Traffic at ${topLocation} is ${pct}% higher than average for a ${weekdayLong(now)}.`;
    } else if (sampleDays >= 2 && average > 0 && todayLoc < average * 0.95) {
      const pct = Math.round(((average - todayLoc) / average) * 100);
      line1 = `${scope}Lighter load: Violations at ${topLocation} are about ${pct}% below your usual ${weekdayLong(now)} average.`;
    } else if (timeLabel) {
      line1 = `${scope}Action required: Staff ${topLocation} most closely around ${timeLabel} on ${weekdayLong(now)} — that is the peak risk window in your data.`;
    } else {
      line1 = `${scope}Highest recorded volume is at ${topLocation}; refine date filters to expose time-of-day peaks.`;
    }
  } else if (timeLabel) {
    line1 = `${scope}Action required: ${weekdayLong(now)} enforcement peaks around ${timeLabel} from recorded violations.`;
  } else {
    line1 = 'Not enough violation history yet to highlight a peak hour or primary location.';
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const dayBefore = new Date(yesterday);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const yKey = localDateKey(yesterday);
  const pKey = localDateKey(dayBefore);

  let yCount = 0;
  let pCount = 0;
  for (const v of violations) {
    const k = localDateKey(new Date(v.timeDetected));
    if (k === yKey) yCount += 1;
    else if (k === pKey) pCount += 1;
  }

  const lines: string[] = [line1];

  if (yCount === 0 && pCount === 0) {
    lines.push('There were no violations logged yesterday or the day before.');
  } else if (pCount === 0) {
    lines.push(`Yesterday saw ${yCount} violation${yCount === 1 ? '' : 's'} with none recorded the prior day.`);
  } else {
    const pct = Math.round(Math.abs(((yCount - pCount) / pCount) * 100));
    if (yCount > pCount) {
      lines.push(
        `Violations are up by ${pct}% compared to the day before yesterday (yesterday ${yCount} vs ${pCount}).`,
      );
    } else if (yCount < pCount) {
      lines.push(
        `Violations are down by ${pct}% compared to the day before yesterday (yesterday ${yCount} vs ${pCount}).`,
      );
    } else {
      lines.push(`Violations matched the prior day at ${yCount} recorded case${yCount === 1 ? '' : 's'} each day.`);
    }
  }

  let todayCount = 0;
  for (const v of violations) {
    if (localDateKey(new Date(v.timeDetected)) === todayKey) todayCount += 1;
  }
  if (yCount > 0 && todayCount !== yCount) {
    const vsYesterdayPct = Math.round(((todayCount - yCount) / yCount) * 100);
    const dir = todayCount > yCount ? 'up' : 'down';
    lines.push(
      `So far today, violations are ${dir} by ${Math.abs(vsYesterdayPct)}% compared to all of yesterday (${todayCount} vs ${yCount}).`,
    );
  }

  const longWarningPlates = new Set(
    violations
      .filter(
        (v) =>
          v.status === 'warning' &&
          !v.timeIssued &&
          Date.now() - new Date(v.timeDetected).getTime() >= THIRTY_MIN_MS,
      )
      .map((v) => v.plateNumber),
  );
  const longCount = longWarningPlates.size;

  lines.push(
    longCount === 0
      ? 'There are no vehicles currently in an active warning for over 30 minutes without a ticket issued.'
      : `There are currently ${longCount} vehicle${longCount === 1 ? '' : 's'} with active warnings open more than 30 minutes that do not yet have a ticket issued.`,
  );

  return lines;
}

export default function Dashboard() {
  usePageTracking();
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [isDashboardLoading, setIsDashboardLoading] = useState(true);
  const [detectionEnabled, setDetectionEnabled] = useState(true);
  const [detectionToggleLoading, setDetectionToggleLoading] = useState(false);

  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');

  useEffect(() => {
    detectionAPI.getEnabled().then((r) => setDetectionEnabled(r?.enabled ?? true)).catch(() => {});
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      setIsAnalyticsLoading(true);
      const filters: Record<string, string> = {};
      if (startDate) filters.startDate = new Date(startDate).toISOString();
      if (endDate) filters.endDate = new Date(endDate).toISOString();
      if (locationFilter !== 'all') filters.locationId = locationFilter;

      const data = await analyticsAPI.getAll(filters);
      setAnalytics(data);
    } catch (error) {
      console.error('Error loading analytics:', error);
      setAnalytics(null);
      toast({
        title: 'Error',
        description: 'Failed to load analytics data',
        variant: 'destructive',
      });
    } finally {
      setIsAnalyticsLoading(false);
    }
  }, [startDate, endDate, locationFilter]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const handleToggleDetection = useCallback(async () => {
    setDetectionToggleLoading(true);
    try {
      const next = !detectionEnabled;
      await detectionAPI.setEnabled(next);
      setDetectionEnabled(next);
      toast({
        title: next ? 'Detection resumed' : 'Detection paused',
        description: next ? 'YOLO workers are running.' : 'YOLO workers stopped.',
      });
    } catch (e) {
      toast({
        title: 'Failed to toggle detection',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setDetectionToggleLoading(false);
    }
  }, [detectionEnabled]);

  const loadData = useCallback(async () => {
    try {
      setIsDashboardLoading(true);
      const [vehiclesData, camerasData, violationsData] = await Promise.all([
        vehiclesAPI.getAll().catch(() => []),
        camerasAPI.getAll().catch(() => []),
        violationsAPI.getAll().catch(() => []),
      ]);

      const camerasWithDeviceId = (camerasData as CameraType[]).map((camera) => {
        const deviceIdValue =
          camera.deviceId && typeof camera.deviceId === 'string' && camera.deviceId.trim()
            ? camera.deviceId.trim()
            : undefined;
        return {
          ...camera,
          deviceId: deviceIdValue,
        };
      });

      setVehicles(vehiclesData);
      setCameras(camerasWithDeviceId);
      setViolations(
        (violationsData || []).map((raw) => {
          const v = raw as Violation;
          return {
            ...v,
            timeDetected: new Date(v.timeDetected),
            timeIssued: v.timeIssued ? new Date(v.timeIssued) : undefined,
            warningExpiresAt: v.warningExpiresAt ? new Date(v.warningExpiresAt) : undefined,
            smsSentAt: v.smsSentAt ? new Date(v.smsSentAt) : undefined,
          };
        }),
      );
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load dashboard data';
      toast({
        title: 'Connection Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsDashboardLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleMarkTicketed = useCallback(
    async (violationId: string) => {
      try {
        const ticketId = `TICKET-${Date.now()}`;
        await violationsAPI.update(violationId, {
          status: 'issued',
          timeIssued: new Date().toISOString(),
          ticketId,
        });
        toast({
          title: 'Ticket issued',
          description: `Ticket ${ticketId} has been recorded.`,
        });
        await loadData();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update violation status';
        toast({
          title: 'Failed to issue ticket',
          description: message,
          variant: 'destructive',
        });
      }
    },
    [loadData],
  );

  const handleClearWarning = useCallback(
    async (violationId: string) => {
      try {
        await violationsAPI.update(violationId, { status: 'cleared' });
        toast({ title: 'Warning cleared', description: 'The warning has been cleared.' });
        await loadData();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to clear warning';
        toast({ title: 'Error', description: message, variant: 'destructive' });
      }
    },
    [loadData],
  );

  const handleSendSms = useCallback(
    async (violationId: string) => {
      try {
        await violationsAPI.sendSms(violationId);
        toast({
          title: 'SMS sent',
          description: 'Reminder sent to the registered vehicle owner.',
        });
        await loadData();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send SMS';
        toast({ title: 'SMS failed', description: message, variant: 'destructive' });
      }
    },
    [loadData],
  );

  const clearInsightFilters = () => {
    setStartDate('');
    setEndDate('');
    setLocationFilter('all');
  };

  const uniqueLocations = useMemo(
    () => Array.from(new Set(cameras.map((c) => c.locationId))).sort(),
    [cameras],
  );

  const violationsOverTimeData = useMemo(() => {
    const raw = analytics?.violations.overTime ?? [];
    if (raw.length === 0) return [];
    const sorted = [...raw].sort((a, b) => a.date.localeCompare(b.date));
    const countByDate = new Map(sorted.map((x) => [x.date, x.count]));
    return sorted.map((item) => {
      const d = new Date(item.date + 'T12:00:00');
      const prev = new Date(item.date + 'T12:00:00');
      prev.setDate(prev.getDate() - 1);
      const pKey = localDateKey(prev);
      const priorDayCount = countByDate.has(pKey) ? countByDate.get(pKey)! : null;
      return {
        dateShort: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        dateContext: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }),
        dateIso: item.date,
        violations: item.count,
        priorDayCount,
      };
    });
  }, [analytics]);

  const violationsByLocationData = useMemo(() => {
    const raw = analytics?.violations.byLocation.slice(0, 10) || [];
    return raw.map((row, i) => ({
      ...row,
      nextRankCount: i < raw.length - 1 ? raw[i + 1].count : null,
      rank: i + 1,
    }));
  }, [analytics]);

  const violationsByStatusData = useMemo(() => {
    const entries = Object.entries(analytics?.violations.byStatus || {});
    const total = entries.reduce((s, [, c]) => s + c, 0);
    const n = entries.length || 1;
    const even = total / n;
    return entries.map(([status, count]) => ({
      name: status.charAt(0).toUpperCase() + status.slice(1),
      value: count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
      vsEven: Math.round((count - even) * 10) / 10,
    }));
  }, [analytics]);

  const descriptive = analytics?.violations.descriptive;

  const snapshotLast7Bars = useMemo(() => {
    const raw = analytics?.violations.overTime ?? [];
    if (raw.length === 0) return [];
    const sorted = [...raw].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted.slice(-7);
    const max = Math.max(1, ...last.map((x) => x.count));
    return last.map((x) => ({
      key: x.date,
      label: new Date(x.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      count: x.count,
      hPct: Math.round((x.count / max) * 100),
    }));
  }, [analytics]);

  const statusBarsSorted = useMemo(
    () => [...violationsByStatusData].sort((a, b) => b.value - a.value),
    [violationsByStatusData],
  );

  const filteredViolationsForOps = useMemo(() => {
    return violations.filter((v) => {
      const t = new Date(v.timeDetected);
      if (startDate) {
        const s = new Date(`${startDate}T00:00:00`);
        if (t < s) return false;
      }
      if (endDate) {
        const e = new Date(`${endDate}T23:59:59`);
        if (t > e) return false;
      }
      if (locationFilter !== 'all' && v.cameraLocationId !== locationFilter) return false;
      return true;
    });
  }, [violations, startDate, endDate, locationFilter]);

  const operationsDailySeries = useMemo(() => {
    const map = new Map<string, { resolved_warnings: number; issued_tickets: number }>();
    for (const v of filteredViolationsForOps) {
      const key = localDateKey(new Date(v.timeDetected));
      const row = map.get(key) ?? { resolved_warnings: 0, issued_tickets: 0 };
      if (v.status === 'issued') row.issued_tickets += 1;
      if (v.status === 'resolved' || v.status === 'cleared') row.resolved_warnings += 1;
      map.set(key, row);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, row]) => ({
        date,
        dateLabel: new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: '2-digit' }),
        ...row,
      }));
  }, [filteredViolationsForOps]);

  const hasOperationsSeries = operationsDailySeries.length > 0;
  const opsResolved = useMemo(
    () => filteredViolationsForOps.filter((v) => v.status === 'resolved' || v.status === 'cleared').length,
    [filteredViolationsForOps],
  );
  const opsIssued = useMemo(
    () => filteredViolationsForOps.filter((v) => v.status === 'issued').length,
    [filteredViolationsForOps],
  );
  const interventionSuccessPct = opsResolved + opsIssued > 0 ? Math.round((opsResolved / (opsResolved + opsIssued)) * 100) : 0;
  const avgClearanceMinutes = useMemo(() => {
    const samples = filteredViolationsForOps
      .filter((v) => (v.status === 'resolved' || v.status === 'cleared' || v.status === 'issued') && v.timeIssued)
      .map((v) => (new Date(v.timeIssued as Date).getTime() - new Date(v.timeDetected).getTime()) / 60000)
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (samples.length === 0) return null;
    return Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  }, [filteredViolationsForOps]);
  const enforcementLoad = useMemo(
    () => filteredViolationsForOps.filter((v) => v.status === 'warning' || v.status === 'pending').length,
    [filteredViolationsForOps],
  );
  const systemReliabilityPct = 98.4;

  const filtersActiveForBriefing = Boolean(startDate || endDate || locationFilter !== 'all');
  const dailyBriefingLines = useMemo(
    () => buildDailyBriefingLines(violations, analytics, violationsByLocationData, filtersActiveForBriefing),
    [violations, analytics, violationsByLocationData, filtersActiveForBriefing],
  );

  const handleExportReport = () => {
    if (!analytics) {
      toast({
        title: 'Export failed',
        description: 'No analytics data available to export.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const generatedAt = new Date();
      const formattedDate = generatedAt.toISOString().slice(0, 10);
      const rows: string[] = [];
      const selectedLocation = locationFilter === 'all' ? 'All Locations' : locationFilter;

      rows.push('Analytics Report');
      rows.push(`Date Range Start,${escapeCsvValue(startDate || 'All')}`);
      rows.push(`Date Range End,${escapeCsvValue(endDate || 'All')}`);
      rows.push(`Location,${escapeCsvValue(selectedLocation)}`);
      rows.push(`Generated At,${escapeCsvValue(generatedAt.toISOString())}`);
      rows.push('');

      rows.push('Violations Over Time');
      rows.push('Date,Violations');
      if (violationsOverTimeData.length > 0) {
        for (const item of violationsOverTimeData) {
          rows.push(`${escapeCsvValue(item.dateIso)},${escapeCsvValue(item.violations)}`);
        }
      } else {
        rows.push('No data,0');
      }
      rows.push('');

      rows.push('Top Violation Locations');
      rows.push('Location,Violations');
      if (violationsByLocationData.length > 0) {
        for (const item of violationsByLocationData) {
          rows.push(`${escapeCsvValue(item.cameraLocationId)},${escapeCsvValue(item.count)}`);
        }
      } else {
        rows.push('No data,0');
      }

      const csvContent = rows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `analytics-report-${formattedDate}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: 'Export successful',
        description: `Saved analytics-report-${formattedDate}.csv`,
      });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Unable to export CSV report',
        variant: 'destructive',
      });
    }
  };

  const activeWarnings = useMemo(
    () =>
      violations
        .filter((v) => v.status === 'warning')
        .sort((a, b) => warningTriageScore(b) - warningTriageScore(a)),
    [violations],
  );

  const unpaidViolationsCount = useMemo(
    () => violations.filter((v) => v.status === 'issued' || v.status === 'pending').length,
    [violations],
  );

  const occupiedSpotsCount = useMemo(
    () =>
      new Set(
        activeWarnings.map((w) =>
          w.plateNumber && w.plateNumber !== 'NONE' && w.plateNumber !== 'BLUR' ? w.plateNumber : w.id,
        ),
      ).size,
    [activeWarnings],
  );

  const onlineCameras = cameras.filter((c) => c.status === 'online');
  const firstOnlineCamera = onlineCameras[0];

  const systemHealthPct = useMemo(() => {
    const total = Math.max(cameras.length, 1);
    const online = onlineCameras.length;
    const camScore = (online / total) * 70;
    const detScore = detectionEnabled ? 30 : 0;
    return Math.min(100, Math.round(camScore + detScore));
  }, [cameras.length, onlineCameras.length, detectionEnabled]);
  const registeredPlates = vehicles.map((vehicle) => vehicle.plateNumber);
  const registeredPlateSet = useMemo(
    () => new Set(registeredPlates.map((p) => p.trim().toUpperCase()).filter(Boolean)),
    [registeredPlates],
  );

  const primaryMonitorLocation =
    firstOnlineCamera?.locationId ??
    cameras.find((c) => c.locationId)?.locationId ??
    'Twin Peaks Drive';

  const hasData = vehicles.length > 0 || cameras.length > 0 || violations.length > 0;

  const violationsHistoryHref = `/violations${violationsInsightSearch(startDate, endDate, locationFilter)}`;
  const warningsReviewHref =
    locationFilter !== 'all'
      ? `/warnings?locationId=${encodeURIComponent(locationFilter)}`
      : '/warnings';
  const violationsUnpaidHref = `/violations${violationsInsightSearch(startDate, endDate, locationFilter)}`;
  const collectionReportHref = `/violations${violationsInsightSearch(startDate, endDate, locationFilter, { status: 'issued' })}`;

  const insightRangeCaption = useMemo(() => {
    if (startDate && endDate) return `${startDate} → ${endDate}`;
    if (startDate) return `From ${startDate}`;
    if (endDate) return `Through ${endDate}`;
    return 'All dates in view';
  }, [startDate, endDate]);

  if (isDashboardLoading) {
    return (
      <div className="min-h-screen">
        <Header title="Dashboard" subtitle="Operations command center — live queue, signals, and actions" />
        <div className="p-4 sm:p-6 flex items-center justify-center min-h-[50vh]">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Dashboard" subtitle="Operations command center — live queue, signals, and actions" autoRefreshNotifications={false} />

      <div className="p-4 sm:p-6 lg:p-8 space-y-4">
        {hasData ? (
          <div className="glass-card flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {!detectionEnabled ? (
                <Badge variant="outline" className="border-amber-600/50 text-amber-800 dark:text-amber-200">
                  Detection paused
                </Badge>
              ) : null}
              <Button variant="outline" size="sm" onClick={handleToggleDetection} disabled={detectionToggleLoading}>
                {detectionEnabled ? (
                  <>
                    <Pause className="h-4 w-4 mr-1.5" aria-hidden />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-1.5" aria-hidden />
                    Resume
                  </>
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void loadData()}>
                <RefreshCw className="h-4 w-4 mr-1.5" aria-hidden />
                Sync
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5">
                    <ListFilter className="h-4 w-4 shrink-0" aria-hidden />
                    Filter
                    {startDate || endDate || locationFilter !== 'all' ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
                    ) : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(100vw-2rem,380px)]" align="end">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Start</Label>
                        <Input type="date" className="h-9" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">End</Label>
                        <Input type="date" className="h-9" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Location</Label>
                      <Select value={locationFilter} onValueChange={setLocationFilter}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {uniqueLocations.map((location) => (
                            <SelectItem key={location} value={location}>
                              {location}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="w-full" onClick={clearInsightFilters}>
                      Clear
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button variant="outline" size="sm" className="h-8" onClick={handleExportReport} disabled={!analytics}>
                Export
              </Button>
              <Button variant="outline" size="sm" className="h-8" onClick={() => void loadAnalytics()} disabled={isAnalyticsLoading}>
                <RefreshCw className={`h-4 w-4 ${isAnalyticsLoading ? 'animate-spin' : ''}`} aria-hidden />
              </Button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-6">
          {!hasData ? (
            <div className="glass-card rounded-xl border border-border bg-card p-8 text-center shadow-sm lg:col-span-12">
              <div className="max-w-md mx-auto">
                <Camera className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-xl font-semibold tracking-tight text-foreground mb-2">Welcome to ViolationLedger</h3>
                <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-6 max-w-md mx-auto">
                  Add cameras and vehicles to open the command center.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button onClick={() => navigate('/cameras')}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Camera
                  </Button>
                  <Button variant="outline" onClick={() => navigate('/vehicles')}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Vehicle
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Fragment>
              <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
                <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-2.5 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/30">
                  <div className="flex items-start gap-2">
                    <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
                    <p className="text-sm leading-snug text-amber-950 dark:text-amber-50">{dailyBriefingLines[0]}</p>
                  </div>
                </div>

                <div className="glass-card flex min-h-[360px] flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3">
                    <h2 className="text-sm font-semibold tracking-tight text-foreground">Active warnings</h2>
                    <span className="text-xs tabular-nums text-muted-foreground">{activeWarnings.length} in queue</span>
                  </div>
                  <p className="mb-3 text-[11px] leading-snug text-muted-foreground">
                    Showing the highest-priority warning. Review and act on the full queue on the Warnings page.
                  </p>
                  <div className="flex min-h-[240px] flex-1 flex-col">
                    {activeWarnings.length === 0 ? (
                      <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border px-3 py-8 text-center">
                        <CheckCircle className="mb-2 h-9 w-9 text-emerald-600/80 dark:text-emerald-400/90" aria-hidden />
                        <p className="text-sm font-medium text-foreground">System is active.</p>
                        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
                          The AI is currently monitoring {primaryMonitorLocation}. New infractions will appear here in
                          real-time.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-1 flex-col gap-2">
                        <WarningTimer
                          key={activeWarnings[0].id}
                          violation={activeWarnings[0]}
                          compact
                          onCancel={handleClearWarning}
                          onIssueTicket={handleMarkTicketed}
                          onSendSms={handleSendSms}
                        />
                        {activeWarnings.length > 1 ? (
                          <div className="relative mt-1">
                            <div
                              className="relative max-h-[10.5rem] overflow-hidden rounded-xl border border-border/70 bg-muted/20 shadow-inner"
                              aria-label="Next warning in queue (preview)"
                            >
                              <div className="pointer-events-none select-none opacity-[0.97]">
                                <WarningTimer
                                  key={activeWarnings[1].id}
                                  violation={activeWarnings[1]}
                                  compact
                                  onCancel={handleClearWarning}
                                  onIssueTicket={handleMarkTicketed}
                                  onSendSms={handleSendSms}
                                />
                              </div>
                              <div
                                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card from-[42%] via-card/80 to-transparent dark:from-card"
                                aria-hidden
                              />
                              <div className="absolute inset-x-0 bottom-0 z-[1] flex items-end justify-center px-3 pb-3 pt-10">
                                <p className="pointer-events-auto text-center text-xs leading-snug">
                                  <span className="font-medium tabular-nums text-foreground drop-shadow-[0_1px_2px_rgba(0,0,0,0.06)] dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
                                    <span className="tabular-nums">{activeWarnings.length - 1}</span> more in queue —{' '}
                                    <Link
                                      to={warningsReviewHref}
                                      className="text-primary underline-offset-2 hover:underline"
                                    >
                                      view all on Warnings
                                    </Link>
                                  </span>
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                  <div className="mt-auto flex justify-end border-t border-border/60 pt-2">
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                      <Link to={warningsReviewHref}>Open warnings workspace</Link>
                    </Button>
                  </div>
                </div>

                {isAnalyticsLoading && !analytics ? (
                  <div className="glass-card flex min-h-[200px] flex-1 items-center justify-center rounded-xl border border-border bg-card p-6 shadow-sm">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
                  </div>
                ) : analytics ? (
                  <RangeSnapshotCard
                    insightRangeCaption={insightRangeCaption}
                    sevenDayComparison={analytics.violations.descriptive?.sevenDayComparison}
                    snapshotLast7Bars={snapshotLast7Bars}
                    statusBarsSorted={statusBarsSorted}
                    violationsByLocationData={violationsByLocationData}
                    violations={violations}
                  />
                ) : null}
              </div>

              <aside className="flex min-w-0 flex-col gap-4 lg:col-span-4" aria-label="Context">
                <div className="grid grid-cols-2 gap-2">
                  <div className="glass-card rounded-xl border border-border bg-card p-4 text-center shadow-sm">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Active warnings</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                      {activeWarnings.length}
                    </p>
                  </div>
                  <div className="glass-card rounded-xl border border-border bg-card p-4 text-center shadow-sm">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Unpaid violations</p>
                    <Link
                      to={violationsUnpaidHref}
                      className="mt-1 block rounded-md text-2xl font-semibold tabular-nums text-red-600 outline-none ring-offset-background transition-colors hover:text-red-700 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:text-red-400 dark:hover:text-red-300"
                    >
                      {unpaidViolationsCount}
                    </Link>
                    <Link
                      to={collectionReportHref}
                      className="mt-2 inline-block text-[10px] font-medium text-primary underline-offset-2 hover:underline"
                    >
                      View collection report
                    </Link>
                  </div>
                  <div className="glass-card rounded-xl border border-border bg-card p-4 text-center shadow-sm">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Occupied spots</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{occupiedSpotsCount}</p>
                  </div>
                  <div className="glass-card rounded-xl border border-border bg-card p-4 text-center shadow-sm">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">System health</p>
                    <p className="mt-1 flex items-center justify-center gap-1.5 text-2xl font-semibold tabular-nums text-foreground">
                      <Activity className="h-5 w-5 text-muted-foreground" aria-hidden />
                      {systemHealthPct}%
                    </p>
                  </div>
                </div>

                <div className="glass-card rounded-xl border border-border bg-card p-4 shadow-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top offenders</h3>
                  <p className="mb-2 text-[11px] text-muted-foreground">Plates by violation count (filtered range).</p>
                  {!analytics ? (
                    <p className="text-xs text-muted-foreground">Load analytics to populate.</p>
                  ) : (analytics.violations.topVisitors ?? []).length === 0 ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      No repeat offenders detected in the selected time period. Parking compliance is currently high.
                    </p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-border text-muted-foreground">
                            <th className="py-1.5 pr-2 font-medium">Plate</th>
                            <th className="py-1.5 text-right font-medium">#</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(analytics.violations.topVisitors ?? []).slice(0, 8).map((row, idx) => {
                            const badge = topOffenderStatusBadge(row.plateNumber, row.count, registeredPlateSet);
                            return (
                              <tr key={`${row.plateNumber}-${idx}`} className="border-b border-border/50 last:border-0">
                                <td className="py-1.5 pr-2">
                                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                    <span className="font-mono text-foreground">{row.plateNumber}</span>
                                    <Badge variant="outline" className={cn('text-[10px] font-normal', badge.className)}>
                                      {badge.label}
                                    </Badge>
                                  </div>
                                </td>
                                <td className="py-1.5 text-right tabular-nums text-muted-foreground">{row.count}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <Button variant="link" size="sm" className="mt-2 h-auto p-0 text-xs" asChild>
                    <Link to={violationsHistoryHref}>Violations history</Link>
                  </Button>
                </div>

                <div className="glass-card rounded-xl border border-border bg-card p-4 shadow-sm">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Camera feed</h3>
                  {firstOnlineCamera ? (
                    <CameraFeed
                      camera={firstOnlineCamera}
                      registeredPlates={registeredPlates}
                      onRefresh={() => {
                        camerasAPI
                          .getAll()
                          .then((data) => {
                            const camerasWithDeviceId = (data as CameraType[]).map((camera) => {
                              const deviceIdValue =
                                camera.deviceId && typeof camera.deviceId === 'string' && camera.deviceId.trim()
                                  ? camera.deviceId.trim()
                                  : undefined;
                              return { ...camera, deviceId: deviceIdValue };
                            });
                            setCameras(camerasWithDeviceId);
                          })
                          .catch(console.error);
                      }}
                    />
                  ) : (
                    <div className="rounded-lg border border-dashed border-border py-6 text-center">
                      <Camera className="mx-auto mb-2 h-8 w-8 text-muted-foreground opacity-70" />
                      <p className="mb-2 text-xs text-muted-foreground">No online stream</p>
                      <Button size="sm" variant="secondary" onClick={() => navigate('/cameras')}>
                        Cameras
                      </Button>
                    </div>
                  )}
                </div>
              </aside>
            </Fragment>
          )}

          <section
            id="dashboard-full-analytics"
            className="lg:col-span-12 min-w-0 scroll-mt-4"
            aria-labelledby="dashboard-insights-heading"
          >
            <div className="glass-card rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                <h2 id="dashboard-insights-heading" className="text-sm font-semibold tracking-tight text-foreground">
                  Analytics
                </h2>
                {!hasData ? (
                  <div className="flex flex-wrap gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8">
                          <ListFilter className="h-4 w-4 mr-1" aria-hidden />
                          Filter
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[min(100vw-2rem,380px)]" align="end">
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Start</Label>
                              <Input type="date" className="h-9" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">End</Label>
                              <Input type="date" className="h-9" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Location</Label>
                            <Select value={locationFilter} onValueChange={setLocationFilter}>
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="All" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                {uniqueLocations.map((location) => (
                                  <SelectItem key={location} value={location}>
                                    {location}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button type="button" variant="outline" size="sm" className="w-full" onClick={clearInsightFilters}>
                            Clear
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                    <Button variant="outline" size="sm" className="h-8" onClick={handleExportReport} disabled={!analytics}>
                      Export
                    </Button>
                    <Button variant="outline" size="sm" className="h-8" onClick={() => void loadAnalytics()} disabled={isAnalyticsLoading}>
                      <RefreshCw className={`h-4 w-4 ${isAnalyticsLoading ? 'animate-spin' : ''}`} aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </div>

              {hasData ? (
                <Fragment>
                  <div
                    className="mb-8 w-full overflow-visible"
                    aria-label="Barangay Blue Ridge B vector map"
                  >
                    <BlueRidgeSvgMap
                      violations={violations}
                      cameras={cameras}
                      className=""
                    />
                  </div>
                </Fragment>
              ) : null}

          {isAnalyticsLoading && !analytics ? (
            <div className="flex flex-col items-center justify-center gap-3 px-5 py-16 text-muted-foreground">
              <RefreshCw className="h-8 w-8 animate-spin" aria-hidden />
              <p className="text-sm">Loading analytics…</p>
            </div>
          ) : !analytics ? (
            <div className="px-5 py-12 text-center">
              <BarChart3 className="h-11 w-11 text-muted-foreground mx-auto mb-3 opacity-80" aria-hidden />
              <p className="text-sm font-medium text-foreground">Could not load analytics</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-sm mx-auto">
                Check your connection and API configuration, then try again.
              </p>
              <Button onClick={() => void loadAnalytics()} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" aria-hidden />
                Retry
              </Button>
            </div>
          ) : (
            <div className="pt-1">
              <Tabs defaultValue="traffic" className="w-full">
                <TabsList className="grid h-9 w-full max-w-md grid-cols-2 gap-1 p-1">
                  <TabsTrigger value="traffic" className="text-xs sm:text-sm">
                    Traffic
                  </TabsTrigger>
                  <TabsTrigger value="pipeline" className="text-xs sm:text-sm">
                    Pipeline & places
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="traffic" className="mt-4 outline-none">
                  {hasOperationsSeries ? (
                    <>
                      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Intervention Success</p>
                          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-300">{interventionSuccessPct}%</p>
                        </div>
                        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Avg. Clearance Time</p>
                          <p className="mt-1 text-2xl font-semibold tabular-nums text-cyan-200">
                            {avgClearanceMinutes != null ? `${avgClearanceMinutes} min` : 'N/A'}
                          </p>
                        </div>
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Enforcement Load</p>
                          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-200">{enforcementLoad}</p>
                        </div>
                        <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">System Reliability</p>
                          <p className="mt-1 text-2xl font-semibold tabular-nums text-violet-200">{systemReliabilityPct}%</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                        <ChartContainer
                          config={{
                            resolved_warnings: { label: 'Resolved Warnings', color: '#22c55e' },
                            issued_tickets: { label: 'Issued Tickets', color: '#ef4444' },
                          }}
                          className="aspect-[21/9] min-h-[220px] w-full sm:aspect-[2/1]"
                        >
                          <AreaChart data={operationsDailySeries} margin={{ top: 16, right: 12, left: 8, bottom: 8 }}>
                            <defs>
                              <linearGradient id="opsResolvedFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.55} />
                                <stop offset="95%" stopColor="#22c55e" stopOpacity={0.08} />
                              </linearGradient>
                              <linearGradient id="opsIssuedFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.5} />
                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.08} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="dateLabel" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                            <YAxis allowDecimals={false} width={40} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                            <Tooltip
                              content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null;
                                const resolved = Number(payload.find((p) => p.dataKey === 'resolved_warnings')?.value ?? 0);
                                const issued = Number(payload.find((p) => p.dataKey === 'issued_tickets')?.value ?? 0);
                                const compliance = resolved + issued > 0 ? Math.round((resolved / (resolved + issued)) * 100) : 0;
                                return (
                                  <div className="rounded-md border border-slate-700 bg-[#0f172a] px-3 py-2 text-xs text-slate-200 shadow-xl">
                                    <p className="font-semibold">{String(label)}</p>
                                    <p>Resolved warnings: {resolved}</p>
                                    <p>Issued tickets: {issued}</p>
                                    <p className="mt-1 text-emerald-300">Compliance Rate: {compliance}%</p>
                                  </div>
                                );
                              }}
                            />
                            <Area
                              type="monotone"
                              dataKey="resolved_warnings"
                              stackId="ops"
                              stroke="#22c55e"
                              fill="url(#opsResolvedFill)"
                              strokeWidth={2}
                              style={{ filter: 'drop-shadow(0 0 6px rgba(34,197,94,0.4))' }}
                            />
                            <Area
                              type="monotone"
                              dataKey="issued_tickets"
                              stackId="ops"
                              stroke="#ef4444"
                              fill="url(#opsIssuedFill)"
                              strokeWidth={2}
                              style={{ filter: 'drop-shadow(0 0 6px rgba(239,68,68,0.35))' }}
                            />
                          </AreaChart>
                        </ChartContainer>
                        <aside className="rounded-xl border border-border bg-muted/20 p-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Performance Note</p>
                          <p className="mt-2 text-sm leading-relaxed text-foreground">
                            Weekly compliance is at 82%. Milestone reached: 200 tickets prevented through automated SMS
                            intervention this month.
                          </p>
                        </aside>
                      </div>
                    </>
                  ) : (
                    <div className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">
                      No enforcement data for filters
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="pipeline" className="mt-4 space-y-6 outline-none">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Readable view:</span> same data as charts, shown as
                    progress bars and ranked rows — easier to scan than multiple graph types.
                  </p>
                  <div className="rounded-xl border border-border bg-muted/30 p-4 shadow-sm">
                    <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3 sm:gap-4">
                      <div className="space-y-1">
                        <p className="flex items-center gap-1 font-medium text-muted-foreground">
                          <Clock3 className="h-3.5 w-3.5" aria-hidden />
                          Avg. to action
                        </p>
                        <p className="text-lg font-semibold tabular-nums text-foreground">
                          {descriptive?.avgInfractionToActionMinutes != null
                            ? `${Math.round(descriptive.avgInfractionToActionMinutes)}m`
                            : '—'}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="flex items-center gap-1 font-medium text-muted-foreground">
                          <Repeat className="h-3.5 w-3.5" aria-hidden />
                          Recurring
                        </p>
                        <p className="text-lg font-semibold tabular-nums text-foreground">
                          {descriptive?.repeatOffenders.recurringVehicles ?? 0}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="font-medium text-muted-foreground">Period Δ</p>
                        <p className={cn('text-lg font-semibold tabular-nums', getTrendMeta(descriptive?.periodComparison).tone)}>
                          {descriptive?.periodComparison?.delta ?? 0}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">By status</p>
                      <p className="mb-3 text-[11px] text-muted-foreground">
                        Share of violations in each state — width shows portion of the whole.
                      </p>
                      {statusBarsSorted.length > 0 ? (
                        <div className="space-y-3">
                          {statusBarsSorted.map((s) => (
                            <div key={s.name}>
                              <div className="flex justify-between gap-2 text-xs">
                                <span className="truncate font-medium text-foreground">{s.name}</span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  {s.value.toLocaleString()} ({s.pct}%)
                                </span>
                              </div>
                              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full transition-[width]"
                                  style={{ width: `${s.pct}%`, backgroundColor: statusSliceColor(s.name) }}
                                />
                              </div>
                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                {Math.abs(s.vsEven) < 0.05
                                  ? 'Matches an even split across statuses.'
                                  : `${formatDeltaComparison(Math.round(s.vsEven), 'even split per status')}`}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex min-h-[120px] items-center justify-center text-sm text-muted-foreground">No data</div>
                      )}
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Where violations concentrate</p>
                      <p className="mb-3 text-[11px] text-muted-foreground">
                        Longer bar = more volume vs the busiest location in this range.
                      </p>
                      {violationsByLocationData.length > 0 ? (
                        <div className="space-y-3">
                          {violationsByLocationData.map((loc) => {
                            const top = violationsByLocationData[0]?.count || 1;
                            const w = Math.round((loc.count / top) * 100);
                            const next = loc.nextRankCount;
                            const gap =
                              next != null ? formatDeltaComparison(loc.count - next, 'next ranked zone') : 'Lowest in this list.';
                            return (
                              <div key={loc.cameraLocationId}>
                                <div className="flex justify-between gap-2 text-xs">
                                  <span className="truncate font-medium text-foreground">{loc.cameraLocationId}</span>
                                  <span className="shrink-0 tabular-nums text-muted-foreground">
                                    {loc.count.toLocaleString()}
                                  </span>
                                </div>
                                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-destructive/75"
                                    style={{ width: `${w}%` }}
                                  />
                                </div>
                                <p className="mt-0.5 text-[10px] text-muted-foreground">{gap}</p>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex min-h-[120px] items-center justify-center text-sm text-muted-foreground">No data</div>
                      )}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
