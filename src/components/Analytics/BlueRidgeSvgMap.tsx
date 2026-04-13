import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle, Flame, Pause, Play } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { BR_SVG_VIEWBOX, createBlueRidgeMercatorEngine } from '@/lib/blueRidgeMercatorMap';
import boundaryGeo from '@/assets/blueRidgeBoundary.json';
import streetsGeo from '@/assets/blueRidgeStreets.json';
import type { FeatureCollection, Geometry, LineString, MultiLineString } from 'geojson';
import type { Violation } from '@/types/parking';
import type { ResidentStreetName } from '@/lib/residentStreets';
import { mapGeoNameToResidentStreet, violationMatchesResidentStreet } from '@/lib/residentStreetGeoAliases';

const BOUNDARY_FC = boundaryGeo as FeatureCollection;
const STREETS_FC = streetsGeo as FeatureCollection;
const VIEW_W = BR_SVG_VIEWBOX.width;
const VIEW_H = BR_SVG_VIEWBOX.height;

function isLineGeometry(g: Geometry | null): g is LineString | MultiLineString {
  return g?.type === 'LineString' || g?.type === 'MultiLineString';
}

export type BlueRidgeSvgMapProps = {
  violations?: Violation[];
  className?: string;
};

type TemporalPeriod = 'day' | 'week' | 'month';
type StreetStatus = 'neutral' | 'compliant' | 'warning' | 'critical';
type StreetMetric = {
  streetId: string;
  name: ResidentStreetName;
  warnings: number;
  tickets: number;
  compliantMoves: number;
  status: StreetStatus;
  score: number;
};

const PERIOD_ORDER: TemporalPeriod[] = ['day', 'week', 'month'];

const STATUS_COLOR: Record<StreetStatus, string> = {
  neutral: '#2D3748',
  compliant: '#10B981',
  warning: '#F59E0B',
  critical: '#EF4444',
};

function periodCutoff(period: TemporalPeriod): number {
  const now = Date.now();
  if (period === 'day') return now - 24 * 60 * 60 * 1000;
  if (period === 'week') return now - 7 * 24 * 60 * 60 * 1000;
  return now - 30 * 24 * 60 * 60 * 1000;
}

function computeStreetStatus(warnings: number, tickets: number, compliantMoves: number): StreetStatus {
  if (tickets >= 3 || tickets > warnings) return 'critical';
  if (warnings >= 2) return 'warning';
  if (compliantMoves >= 2) return 'compliant';
  return 'neutral';
}

function adviceForStreet(street: StreetMetric, avgScore: number): string {
  const diffPct = avgScore > 0 ? Math.round(((street.score - avgScore) / avgScore) * 100) : 0;
  if (street.status === 'critical') {
    return `Warning triggers are ${Math.max(40, diffPct)}% higher than average on ${street.name}. Suggest deploying a "No Parking" sign and assigning tanod monitoring.`;
  }
  if (street.status === 'warning') {
    return `SMS alerts are trending upward on ${street.name}. Suggest a visible curbside reminder and 15-minute patrol checks.`;
  }
  if (street.status === 'compliant') {
    return `${street.name} has strong compliance flow. Keep current signage and rotate patrols to higher-risk streets.`;
  }
  return `${street.name} is stable for this period. Continue baseline monitoring and keep deterrence signage visible.`;
}

function glowFilterForStatus(status: StreetStatus): string | undefined {
  if (status === 'critical') return 'drop-shadow(0 0 8px #EF4444)';
  if (status === 'warning') return 'drop-shadow(0 0 6px #F59E0B)';
  return undefined;
}

function mockStreetMeta(metric: StreetMetric): { avgDuration: string; peakHour: string } {
  const avg = Math.max(3, Math.min(58, metric.warnings * 4 + metric.tickets * 9 + 2));
  const peak = (8 + (metric.warnings * 2 + metric.tickets * 3)) % 24;
  const hour12 = peak % 12 === 0 ? 12 : peak % 12;
  const suffix = peak >= 12 ? 'PM' : 'AM';
  return { avgDuration: `${avg} mins`, peakHour: `${hour12}:00 ${suffix}` };
}

export function BlueRidgeSvgMap({ violations = [], className }: BlueRidgeSvgMapProps) {
  const [period, setPeriod] = useState<TemporalPeriod>('day');
  const [selectedStreetId, setSelectedStreetId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [hoveredStreet, setHoveredStreet] = useState<{
    x: number;
    y: number;
    metric: StreetMetric;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const suppressClickRef = useRef(false);

  const { path, boundaryPolygon } = useMemo(
    () => createBlueRidgeMercatorEngine(BOUNDARY_FC, VIEW_W, VIEW_H, STREETS_FC),
    [],
  );

  const boundaryPathD = useMemo(() => path(boundaryPolygon) ?? '', [path, boundaryPolygon]);

  const streetPaths = useMemo(() => {
    const out: Array<{ key: string; d: string; resident: ResidentStreetName | null; decorative: boolean }> = [];
    for (const f of STREETS_FC.features) {
      if (!f.geometry || !isLineGeometry(f.geometry)) continue;
      const d = path(f) ?? '';
      if (!d) continue;
      const raw = String((f.properties as { name?: string } | null)?.name ?? '').trim();
      const resident = raw ? mapGeoNameToResidentStreet(raw) : null;
      out.push({
        key: String((f.properties as { ['@id']?: string } | null)?.['@id'] ?? `s-${out.length}`),
        d,
        resident,
        decorative: resident == null,
      });
    }
    return out;
  }, [path]);

  const metrics = useMemo(() => {
    const cutoff = periodCutoff(period);
    const residents = [...new Set(streetPaths.map((s) => s.resident).filter((s): s is ResidentStreetName => !!s))];
    const base = new Map<ResidentStreetName, StreetMetric>();
    for (const street of residents) {
      base.set(street, {
        streetId: street.toLowerCase().replace(/\s+/g, '-'),
        name: street,
        warnings: 0,
        tickets: 0,
        compliantMoves: 0,
        status: 'neutral',
        score: 0,
      });
    }

    const scoped = violations.filter((v) => new Date(v.timeDetected).getTime() >= cutoff);
    for (const v of scoped) {
      for (const street of residents) {
        if (!violationMatchesResidentStreet(v, street)) continue;
        const m = base.get(street);
        if (!m) break;
        if (v.status === 'warning' || v.status === 'pending') m.warnings += 1;
        const hasIssued = v.status === 'issued' && v.timeIssued;
        if (hasIssued) {
          const mins =
            (new Date(v.timeIssued as Date).getTime() - new Date(v.timeDetected).getTime()) / 60000;
          if (mins >= 30) m.tickets += 1;
          if (mins <= 2) m.compliantMoves += 1;
        }
        break;
      }
    }

    const out = [...base.values()].map((m) => {
      const status = computeStreetStatus(m.warnings, m.tickets, m.compliantMoves);
      const score = m.warnings + m.tickets * 2;
      return { ...m, status, score };
    });
    out.sort((a, b) => b.score - a.score || b.tickets - a.tickets || b.warnings - a.warnings);
    return out;
  }, [violations, period, streetPaths]);

  const previousPeriodMetrics = useMemo(() => {
    const now = Date.now();
    const span =
      period === 'day' ? 24 * 60 * 60 * 1000 : period === 'week' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    const prevStart = now - span * 2;
    const prevEnd = now - span;

    const residents = [...new Set(streetPaths.map((s) => s.resident).filter((s): s is ResidentStreetName => !!s))];
    const base = new Map<ResidentStreetName, StreetMetric>();
    for (const street of residents) {
      base.set(street, {
        streetId: street.toLowerCase().replace(/\s+/g, '-'),
        name: street,
        warnings: 0,
        tickets: 0,
        compliantMoves: 0,
        status: 'neutral',
        score: 0,
      });
    }

    for (const v of violations) {
      const t = new Date(v.timeDetected).getTime();
      if (t < prevStart || t >= prevEnd) continue;
      for (const street of residents) {
        if (!violationMatchesResidentStreet(v, street)) continue;
        const m = base.get(street);
        if (!m) break;
        if (v.status === 'warning' || v.status === 'pending') m.warnings += 1;
        const hasIssued = v.status === 'issued' && v.timeIssued;
        if (hasIssued) {
          const mins = (new Date(v.timeIssued as Date).getTime() - new Date(v.timeDetected).getTime()) / 60000;
          if (mins >= 30) m.tickets += 1;
          if (mins <= 2) m.compliantMoves += 1;
        }
        break;
      }
    }

    const out = new Map<string, number>();
    for (const m of base.values()) {
      out.set(m.streetId, m.warnings + m.tickets * 2);
    }
    return out;
  }, [violations, period, streetPaths]);

  const totalPeriodViolations = useMemo(
    () => metrics.reduce((sum, m) => sum + m.warnings + m.tickets, 0),
    [metrics],
  );
  const selectedMetric = metrics.find((m) => m.streetId === selectedStreetId) ?? null;
  const hottestStreet = metrics.find((m) => m.score > 0) ?? metrics[0] ?? null;
  const avgScore = metrics.length ? metrics.reduce((sum, m) => sum + m.score, 0) / metrics.length : 0;
  const previousPeriodTotal = useMemo(() => {
    const now = Date.now();
    const span = period === 'day' ? 24 * 60 * 60 * 1000 : period === 'week' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    const prevStart = now - span * 2;
    const prevEnd = now - span;
    return violations.filter((v) => {
      const t = new Date(v.timeDetected).getTime();
      return t >= prevStart && t < prevEnd;
    }).length;
  }, [violations, period]);
  const trendPct = previousPeriodTotal > 0
    ? Math.round(((totalPeriodViolations - previousPeriodTotal) / previousPeriodTotal) * 100)
    : 0;
  const adviceText = selectedMetric
    ? adviceForStreet(selectedMetric, avgScore)
    : hottestStreet
      ? `Across Blue Ridge B, violation rates are ${trendPct <= 0 ? `down ${Math.abs(trendPct)}%` : `up ${trendPct}%`} this ${period}. ${hottestStreet.name} remains the primary hotspot.`
      : `Across Blue Ridge B, there are no violations recorded this ${period}. Keep patrol visibility and compliance signage steady.`;
  const canZoomOut = zoom > 1;
  const canZoomIn = zoom < 2.6;
  const clampPan = useCallback((next: { x: number; y: number }) => {
    const maxX = ((zoom - 1) * VIEW_W) / 2;
    const maxY = ((zoom - 1) * VIEW_H) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }, [zoom]);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const z = Math.min(2.6, Math.max(1, Number((zoom + (e.deltaY < 0 ? 0.12 : -0.12)).toFixed(2))));
      setZoom(z);
      if (z === 1) {
        setPan({ x: 0, y: 0 });
      } else {
        setPan((p) => clampPan(p));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', onWheel, true);
  }, [zoom, clampPan]);
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setPeriod((prev) => PERIOD_ORDER[(PERIOD_ORDER.indexOf(prev) + 1) % PERIOD_ORDER.length]);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isPlaying]);
  const setZoomClamped = (next: number) => {
    const z = Math.min(2.6, Math.max(1, Number(next.toFixed(2))));
    setZoom(z);
    if (z === 1) {
      setPan({ x: 0, y: 0 });
    } else {
      setPan((p) => clampPan(p));
    }
  };

  return (
    <div
      className={cn(
        'relative w-full rounded-xl bg-[#0b1220] p-4 text-slate-100',
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-300">Temporal Filter</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPlaying((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium',
              isPlaying
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                : 'border-slate-700 bg-[#0f172a] text-slate-300 hover:bg-slate-800',
            )}
            aria-label={isPlaying ? 'Pause temporal playback' : 'Play temporal playback'}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <div className="inline-flex rounded-lg border border-slate-700 bg-[#0f172a] p-1">
            {(['day', 'week', 'month'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setPeriod(p);
                }}
                className={cn(
                  'rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors',
                  period === p ? 'bg-slate-100 text-slate-900' : 'text-slate-300 hover:bg-slate-800',
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div ref={viewportRef} className="relative rounded-xl border border-slate-800/80 bg-[#020617] p-0 [overscroll-behavior:contain]">
          <svg
            ref={svgRef}
            className="h-[min(62vh,520px)] w-full"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Blue Ridge B hotspot map"
            onWheel={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setZoomClamped(zoom + (e.deltaY < 0 ? 0.12 : -0.12));
            }}
            onPointerDown={(e) => {
              if (zoom <= 1) return;
              const svg = svgRef.current;
              if (!svg) return;
              dragRef.current = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                startPanX: pan.x,
                startPanY: pan.y,
              };
              suppressClickRef.current = false;
              setIsPanning(true);
              svg.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const drag = dragRef.current;
              if (!drag || e.pointerId !== drag.pointerId) return;
              const svg = svgRef.current;
              if (!svg) return;
              const rect = svg.getBoundingClientRect();
              const dxView = ((e.clientX - drag.startX) * VIEW_W) / Math.max(1, rect.width);
              const dyView = ((e.clientY - drag.startY) * VIEW_H) / Math.max(1, rect.height);
              if (Math.abs(dxView) > 1.2 || Math.abs(dyView) > 1.2) suppressClickRef.current = true;
              setPan(
                clampPan({
                  x: drag.startPanX + dxView,
                  y: drag.startPanY + dyView,
                }),
              );
            }}
            onPointerUp={(e) => {
              const drag = dragRef.current;
              if (!drag || e.pointerId !== drag.pointerId) return;
              const svg = svgRef.current;
              if (svg?.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
              dragRef.current = null;
              setIsPanning(false);
              window.setTimeout(() => {
                suppressClickRef.current = false;
              }, 0);
            }}
            onPointerCancel={(e) => {
              const drag = dragRef.current;
              if (!drag || e.pointerId !== drag.pointerId) return;
              const svg = svgRef.current;
              if (svg?.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
              dragRef.current = null;
              setIsPanning(false);
              suppressClickRef.current = false;
            }}
          >
            <defs>
              <clipPath id="br-boundary-clip">
                <path d={boundaryPathD} />
              </clipPath>
            </defs>
            <rect width={VIEW_W} height={VIEW_H} fill="#020617" />
            <g
              style={{
                transformOrigin: `${VIEW_W / 2}px ${VIEW_H / 2}px`,
                transformBox: 'fill-box',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transition: isPanning ? 'none' : 'transform 180ms ease-out',
              }}
            >
              <path d={boundaryPathD} fill="rgba(255,255,255,0.03)" stroke="none" pointerEvents="none" />
              <g clipPath="url(#br-boundary-clip)">
                {streetPaths.map((street) => {
                  const metric = street.resident
                    ? metrics.find((m) => m.name === street.resident) ?? null
                    : null;
                  const color = metric ? STATUS_COLOR[metric.status] : '#2D3748';
                  const isSelected = metric?.streetId === selectedStreetId;
                  return (
                    <motion.path
                      key={street.key}
                      d={street.d}
                      fill="none"
                      animate={{
                        stroke: isSelected ? '#ffffff' : color,
                        strokeWidth: isSelected ? 5 : street.decorative ? 1.4 : 4,
                      }}
                      transition={{ duration: 0.45, ease: 'easeInOut' }}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={street.decorative ? 0.35 : 1}
                      className={cn(!street.decorative && 'cursor-pointer')}
                      style={metric ? { filter: glowFilterForStatus(metric.status) } : undefined}
                      onClick={() => {
                        if (suppressClickRef.current) return;
                        if (!metric) return;
                        setSelectedStreetId((prev) => (prev === metric.streetId ? null : metric.streetId));
                      }}
                      onMouseEnter={(e) => {
                        if (!metric) return;
                        setHoveredStreet({ x: e.clientX, y: e.clientY, metric });
                      }}
                      onMouseMove={(e) => {
                        if (!metric) return;
                        setHoveredStreet({ x: e.clientX, y: e.clientY, metric });
                      }}
                      onMouseLeave={() => setHoveredStreet(null)}
                    />
                  );
                })}
              </g>
              <path
                d={boundaryPathD}
                fill="none"
                stroke="#06b6d4"
                strokeWidth={2}
                strokeDasharray="5,5"
                style={{ filter: 'drop-shadow(0 0 5px rgba(6,182,212,0.55))' }}
                pointerEvents="none"
              />
              <text
                x={56}
                y={38}
                fill="#67e8f9"
                fontSize={10}
                fontFamily="'JetBrains Mono', monospace"
                letterSpacing="0.08em"
                style={{ textTransform: 'uppercase' }}
              >
                ZONE: BLUE RIDGE B
              </text>
            </g>
          </svg>
          {hoveredStreet ? (
            <div
              className="pointer-events-none fixed z-[240] rounded-md border border-slate-600/70 bg-slate-900/80 px-3 py-2 text-xs text-slate-100 shadow-lg backdrop-blur-sm"
              style={{ left: hoveredStreet.x + 10, top: hoveredStreet.y + 10 }}
            >
              {(() => {
                const meta = mockStreetMeta(hoveredStreet.metric);
                return (
                  <>
                    <p className="font-semibold">{hoveredStreet.metric.name}</p>
                    <p>Average Duration: {meta.avgDuration}</p>
                    <p>Peak Hour: {meta.peakHour}</p>
                  </>
                );
              })()}
            </div>
          ) : null}
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              className="h-7 w-7 rounded border border-slate-600 text-sm text-slate-200 disabled:opacity-40"
              onClick={() => setZoomClamped(zoom - 0.2)}
              disabled={!canZoomOut}
              aria-label="Zoom out map"
            >
              -
            </button>
            <button
              type="button"
              className="rounded border border-slate-600 px-2 text-xs text-slate-300"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              aria-label="Reset zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="h-7 w-7 rounded border border-slate-600 text-sm text-slate-200 disabled:opacity-40"
              onClick={() => setZoomClamped(zoom + 0.2)}
              disabled={!canZoomIn}
              aria-label="Zoom in map"
            >
              +
            </button>
          </div>
        </div>

        <aside className="rounded-xl border border-slate-800 bg-[#0f172a] p-3">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">Top Streets</p>
          <p className="mb-3 text-xs text-slate-400">
            Ranked by enforcement pressure in the selected period (warnings + weighted tickets).
          </p>
          {selectedStreetId ? (
            <button
              type="button"
              className="mb-3 rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
              onClick={() => setSelectedStreetId(null)}
            >
              Clear selection
            </button>
          ) : null}
          {totalPeriodViolations === 0 ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              🎉 Great Job! No violations recorded this {period}. Blue Ridge B is maintaining a perfect street
              state.
            </div>
          ) : (
            <ul className="space-y-2">
              {metrics.slice(0, 8).map((m, idx) => (
                <li
                  key={m.streetId}
                  className={cn(
                    'flex items-center justify-between rounded-md border px-3 py-2 text-sm',
                    selectedStreetId === m.streetId
                      ? 'border-slate-400 bg-slate-700/40'
                      : 'border-slate-700 bg-slate-900/30',
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 text-left"
                    onClick={() => setSelectedStreetId((prev) => (prev === m.streetId ? null : m.streetId))}
                  >
                    <span className="w-5 shrink-0 text-slate-400">{idx + 1}</span>
                    <span className="truncate">{m.name}</span>
                  </button>
                  <span className="tabular-nums text-slate-200">{m.score}</span>
                  <span className="ml-2 inline-flex items-center gap-0.5 text-[11px]">
                    {(() => {
                      const prev = previousPeriodMetrics.get(m.streetId) ?? 0;
                      const pct = prev > 0 ? Math.round(((m.score - prev) / prev) * 100) : m.score > 0 ? 100 : 0;
                      const up = pct >= 0;
                      return (
                        <>
                          {up ? (
                            <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3 text-red-400" />
                          )}
                          <span className={up ? 'text-emerald-300' : 'text-red-300'}>
                            {up ? '+' : ''}
                            {pct}%
                          </span>
                        </>
                      );
                    })()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 rounded-md border border-slate-700 bg-slate-900/30 p-3 text-xs text-slate-300">
            <p className="mb-1 font-semibold">Legend</p>
            <div className="space-y-1.5">
              <p className="flex items-start gap-2"><span className="mt-0.5 h-3 w-3 rounded-full bg-[#2D3748]" /><span><strong>Slate Gray:</strong> Neutral - No violations or activity detected.</span></p>
              <p className="flex items-start gap-2"><span className="mt-0.5 h-3 w-3 rounded-full bg-[#10B981]" /><span><strong>Emerald:</strong> Compliant - High turnover; vehicles move within the 2-minute grace period.</span></p>
              <p className="flex items-start gap-2"><span className="mt-0.5 h-3 w-3 rounded-full bg-[#F59E0B]" /><span><strong>Amber:</strong> Warning Zone - High frequency of SMS warnings sent (2-30 min stay).</span></p>
              <p className="flex items-start gap-2"><span className="mt-0.5 h-3 w-3 rounded-full bg-[#EF4444]" /><span><strong>Crimson:</strong> Critical - Frequent illegal parking (Exceeding 30 mins).</span></p>
            </div>
          </div>
        </aside>
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-[#0f172a] p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
          {selectedMetric?.status === 'critical' ? (
            <AlertTriangle className="h-4 w-4 text-red-400" />
          ) : selectedMetric?.status === 'compliant' ? (
            <CheckCircle className="h-4 w-4 text-emerald-400" />
          ) : (
            <Flame className="h-4 w-4 text-amber-400" />
          )}
          Actionable Advice
        </p>
        <p className="text-sm leading-relaxed text-slate-300">{adviceText}</p>
      </div>
    </div>
  );
}
