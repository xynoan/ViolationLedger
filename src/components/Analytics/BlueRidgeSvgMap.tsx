import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Violation } from '@/types/parking';
import type { ResidentStreetName } from '@/lib/residentStreets';
import { cn } from '@/lib/utils';
import {
  buildLiveEnforcementCountsByResidentStreet,
  mapGeoNameToResidentStreet,
} from '@/lib/residentStreetGeoAliases';
import { isActiveViolationForStreetHeat } from '@/lib/violationStreetAttribution';
import {
  avgViolationOpenMinutesForStreetInClockHour,
  buildViolationCountByStreetForClockHour,
  formatClockHHMM,
  hourIndexFromMinutes,
} from '@/lib/violationHourHistogram';
import { getStreetStyle } from '@/lib/blueRidgeMapStreetStyle';
import { BR_SVG_VIEWBOX, createBlueRidgeMercatorEngine } from '@/lib/blueRidgeMercatorMap';
import { Slider } from '@/components/ui/slider';
import boundaryGeo from '@/assets/blueRidgeBoundary.json';
import streetsGeo from '@/assets/blueRidgeStreets.json';
import type { Feature, FeatureCollection, Geometry, LineString, MultiLineString } from 'geojson';

const BOUNDARY_FC = boundaryGeo as FeatureCollection;
const STREETS_FC = streetsGeo as FeatureCollection;

const VIEW_W = BR_SVG_VIEWBOX.width;
const VIEW_H = BR_SVG_VIEWBOX.height;

function isLineGeometry(g: Geometry | null): g is LineString | MultiLineString {
  return g?.type === 'LineString' || g?.type === 'MultiLineString';
}

type StreetProps = { name?: string; ['@id']?: string };

function streetFeatureKey(f: Feature, index: number): string {
  const id = (f.properties as StreetProps | null)?.['@id'];
  return id ?? `street-${index}`;
}

const DECORATIVE_STYLE: CSSProperties = {
  stroke: '#334155',
  strokeWidth: 0.8,
  strokeOpacity: 0.22,
  filter: 'none',
};

/** Emerald accent on top of historical stroke; width scales with concurrent open enforcement. */
function liveEnforcementOverlayStyle(count: number): CSSProperties {
  const strokeWidth = count === 1 ? 2.25 : count <= 3 ? 3.25 : count <= 5 ? 4.5 : 6;
  return {
    stroke: '#34d399',
    strokeWidth,
    strokeOpacity: 0.9,
    filter: 'drop-shadow(0 0 5px rgb(52 211 153 / 0.55))',
  };
}

export type BlueRidgeSvgMapProps = {
  violations: Violation[];
  className?: string;
  selectedStreet?: ResidentStreetName | null;
  onStreetSelect?: (street: ResidentStreetName | null) => void;
};

export function BlueRidgeSvgMap({
  violations,
  className,
  selectedStreet = null,
  onStreetSelect,
}: BlueRidgeSvgMapProps) {
  const [timeSliderMinutes, setTimeSliderMinutes] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    label: string;
    count: number;
    liveCount: number;
    avgMins: number | null;
    timeLabel: string;
  } | null>(null);

  const totalViolations = violations.length;

  const { path, boundaryPolygon } = useMemo(
    () => createBlueRidgeMercatorEngine(BOUNDARY_FC, VIEW_W, VIEW_H, STREETS_FC),
    [],
  );

  const boundaryPathD = useMemo(() => path(boundaryPolygon) ?? '', [path, boundaryPolygon]);

  const streetPaths = useMemo(() => {
    const out: {
      key: string;
      d: string;
      osmName: string;
      resident: ResidentStreetName | null;
      decorative: boolean;
    }[] = [];
    STREETS_FC.features.forEach((f, index) => {
      if (!f.geometry || !isLineGeometry(f.geometry)) return;
      const d = path(f) ?? '';
      if (!d) return;
      const raw = ((f.properties as StreetProps | null)?.name ?? '').trim();
      const resident = raw ? mapGeoNameToResidentStreet(raw) : null;
      const decorative = resident == null;
      out.push({
        key: streetFeatureKey(f, index),
        d,
        osmName: raw || '—',
        resident,
        decorative,
      });
    });
    return out;
  }, [path]);

  const historicalByStreet = useMemo(
    () => buildViolationCountByStreetForClockHour(violations, timeSliderMinutes),
    [violations, timeSliderMinutes],
  );

  const liveByStreet = useMemo(
    () => buildLiveEnforcementCountsByResidentStreet(violations),
    [violations],
  );

  const liveOpenTotal = useMemo(
    () => violations.filter((v) => isActiveViolationForStreetHeat(v)).length,
    [violations],
  );

  const selectedHour = hourIndexFromMinutes(timeSliderMinutes);
  const hourRangeLabel = `${String(selectedHour).padStart(2, '0')}:00–${String(selectedHour).padStart(2, '0')}:59`;

  const clearTooltip = useCallback(() => setTooltip(null), []);

  const showTooltip = useCallback(
    (e: React.PointerEvent, label: string, resident: ResidentStreetName | null) => {
      const timeLabel = formatClockHHMM(timeSliderMinutes);
      if (!resident) {
        setTooltip({
          x: e.clientX,
          y: e.clientY,
          label,
          count: 0,
          liveCount: 0,
          avgMins: null,
          timeLabel,
        });
        return;
      }
      const count = historicalByStreet.get(resident) ?? 0;
      const liveCount = liveByStreet.get(resident) ?? 0;
      const avgMins = avgViolationOpenMinutesForStreetInClockHour(
        violations,
        resident,
        timeSliderMinutes,
      );
      setTooltip({
        x: e.clientX,
        y: e.clientY,
        label,
        count,
        liveCount,
        avgMins,
        timeLabel,
      });
    },
    [violations, historicalByStreet, liveByStreet, timeSliderMinutes],
  );

  useEffect(() => {
    const onScroll = () => setTooltip(null);
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, []);

  const headerTitle =
    selectedStreet != null ? `FOCUS: ${selectedStreet.toUpperCase()}` : 'BLUE RIDGE B';

  return (
    <div
      className={cn(
        'relative flex h-full min-h-[280px] w-full flex-col rounded-lg border border-border/80 bg-[#0f172a]',
        className,
      )}
    >
      <div className="border-b border-slate-800/90 px-3 py-2">
        <p
          className={cn(
            'text-center font-mono text-[11px] font-semibold tracking-[0.14em] text-slate-300',
            selectedStreet && 'text-sky-300',
          )}
        >
          {headerTitle}
        </p>
      </div>

      <div className="relative min-h-0 w-full flex-1 overflow-visible bg-[#0f172a]">
        <svg
          className="relative z-0 h-full w-full overflow-visible touch-none select-none"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Barangay Blue Ridge B street heatmap"
          onPointerLeave={clearTooltip}
        >
          <rect width={VIEW_W} height={VIEW_H} fill="#0f172a" />

          <path
            d={boundaryPathD}
            fill="none"
            stroke="#334155"
            strokeWidth={1.25}
            pointerEvents="none"
          />

          <g>
            {streetPaths.map(({ key, d, osmName, resident, decorative }) => {
              const heatCount = resident ? historicalByStreet.get(resident) ?? 0 : 0;
              const liveCount = resident ? liveByStreet.get(resident) ?? 0 : 0;
              const dimOthers = selectedStreet != null && resident != null && resident !== selectedStreet;
              const isSelected = resident != null && selectedStreet === resident;
              if (decorative) {
                return (
                  <path
                    key={key}
                    d={d}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                    style={DECORATIVE_STYLE}
                  />
                );
              }
              const { style, className: tierClass } = getStreetStyle(heatCount);
              const label = resident ?? osmName;
              const histAvg =
                resident != null
                  ? avgViolationOpenMinutesForStreetInClockHour(
                      violations,
                      resident,
                      timeSliderMinutes,
                    )
                  : null;
              return (
                <g
                  key={key}
                  className={cn(
                    'cursor-pointer transition-[opacity,stroke,filter] duration-200',
                    isSelected && 'brightness-110',
                  )}
                  style={{ opacity: dimOthers ? 0.38 : 1 }}
                >
                  <path
                    data-street-path=""
                    data-resident-street={resident ?? undefined}
                    d={d}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={cn(tierClass)}
                    style={style}
                    onPointerEnter={(e) => showTooltip(e, label, resident)}
                    onPointerMove={(e) => showTooltip(e, label, resident)}
                    onPointerLeave={clearTooltip}
                    onClick={() => {
                      if (!resident || !onStreetSelect) return;
                      onStreetSelect(selectedStreet === resident ? null : resident);
                    }}
                  >
                    <title>
                      {`${label} | ${heatCount} hist. @ ${hourRangeLabel} | Live open: ${liveCount} | Avg. in hour: ${histAvg ?? '—'} min`}
                    </title>
                  </path>
                  {liveCount > 0 ? (
                    <path
                      d={d}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pointerEvents="none"
                      className={cn(liveCount >= 3 && 'animate-pulse')}
                      style={liveEnforcementOverlayStyle(liveCount)}
                      aria-hidden
                    />
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>

        <div className="pointer-events-none absolute right-2 top-2 z-20 flex flex-wrap items-center justify-end gap-2">
          <div
            className="rounded border border-slate-600/50 bg-[#0f172a]/95 px-2 py-1 font-mono text-[9px] font-semibold tabular-nums text-slate-200 shadow-sm"
            aria-label={`Total violations: ${totalViolations}`}
          >
            Total <span className="text-sky-400">{totalViolations}</span>
          </div>
          <div
            className="flex items-center gap-1.5 rounded border border-emerald-500/25 bg-[#0f172a]/90 px-2 py-1 font-mono text-[9px] font-medium uppercase tracking-wider text-emerald-400/95 shadow-sm"
            title="Warning + pending violations in the loaded dataset"
          >
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
            <span>Live</span>
            <span className="tabular-nums text-emerald-300">{liveOpenTotal}</span>
            <span className="font-normal normal-case tracking-normal text-slate-500">open</span>
          </div>
        </div>

        <div
          className="pointer-events-none absolute bottom-2 left-2 z-20 max-w-[200px] rounded border border-slate-700/60 bg-[#0f172a]/95 px-2 py-1.5 font-mono text-[8px] leading-tight text-slate-400 shadow-sm backdrop-blur-[2px]"
          aria-hidden
        >
          <p className="mb-1 font-semibold uppercase tracking-wider text-slate-500">Legend</p>
          <ul className="space-y-0.5">
            <li className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 shrink-0 rounded bg-[#1e293b]" />
              Stable (0)
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 shrink-0 rounded bg-[#0ea5e9]" />
              Light (1–2)
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 shrink-0 rounded bg-[#f59e0b]" />
              Elevated (3–5)
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 shrink-0 rounded bg-[#ef4444]" />
              Critical (6+)
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 shrink-0 rounded bg-[#34d399] shadow-[0_0_4px_#34d399]" />
              Live ring (warning / pending now)
            </li>
          </ul>
          <p className="mt-1.5 border-t border-slate-700/50 pt-1 text-[7px] leading-tight text-slate-500">
            Base color = historical volume in the scrubbed clock-hour. Emerald overlay = open enforcement on
            that street right now.
          </p>
        </div>

        {tooltip ? (
          <div
            className="pointer-events-none fixed z-[220] max-w-[min(360px,92vw)] rounded-md border border-slate-600/80 bg-[#0f172a] px-3 py-2 font-mono text-[11px] leading-snug text-slate-100 shadow-lg"
            style={{
              left: tooltip.x + 12,
              top: tooltip.y + 12,
            }}
          >
            <span className="text-slate-300">{tooltip.label}</span>
            <span className="text-slate-500"> | </span>
            <span className="text-sky-400">
              {tooltip.count} hist. @ {tooltip.timeLabel} ({hourRangeLabel})
            </span>
            <span className="text-slate-500"> | </span>
            <span className="text-emerald-400">
              Live {tooltip.liveCount} open
            </span>
            <span className="text-slate-500"> | </span>
            <span className="text-amber-200/90">
              Avg. in hour: {tooltip.avgMins != null ? `${tooltip.avgMins} min` : '—'}
            </span>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-slate-800/90 bg-[#0b1220] px-3 py-3">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Time rewind
            </p>
            <p className="mt-0.5 max-w-[min(100%,420px)] text-[9px] leading-snug text-slate-500">
              Scrub local time for historical load by hour; emerald ring on a street = open warning or pending
              enforcement there now (independent of the slider).
            </p>
          </div>
          <div className="text-right font-mono text-sm font-semibold tabular-nums text-sky-400">
            {formatClockHHMM(timeSliderMinutes)}
            <span className="ml-1.5 text-[9px] font-normal text-slate-500">bucket {hourRangeLabel}</span>
          </div>
        </div>
        <Slider
          min={0}
          max={1439}
          step={1}
          value={[timeSliderMinutes]}
          onValueChange={(v) => setTimeSliderMinutes(v[0] ?? 0)}
          className="w-full py-1"
          aria-label="Time of day for historical street load"
        />
      </div>
    </div>
  );
}
