import { cn } from '@/lib/utils';

export type InsightTooltipRow = {
  metric: string;
  value: string | number;
  /** Short comparison line, e.g. "+2 vs prior day" */
  comparison?: string | null;
};

export function formatDeltaComparison(delta: number, basisLabel: string): string {
  if (delta === 0) return `No change vs ${basisLabel} (0)`;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta} vs ${basisLabel}`;
}

/** Shared shell for dashboard analytics tooltips (date + metric + comparison). */
export function InsightTooltipShell({
  contextLabel,
  rows,
  className,
}: {
  contextLabel: string;
  rows: InsightTooltipRow[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid min-w-[11rem] max-w-[18rem] gap-2 rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs shadow-xl',
        className,
      )}
    >
      <p className="border-b border-border/50 pb-1.5 font-medium leading-snug text-foreground">{contextLabel}</p>
      <div className="grid gap-2">
        {rows.map((r) => (
          <div key={r.metric} className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">{r.metric}</span>
              <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">
                {typeof r.value === 'number' ? r.value.toLocaleString() : r.value}
              </span>
            </div>
            {r.comparison ? <p className="text-[11px] leading-snug text-muted-foreground">{r.comparison}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
