import { Fragment, useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Clock,
  Download,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { AnalyticsResponse } from '@/lib/api';
import type { Violation } from '@/types/parking';

type SnapshotBar = { key: string; label: string; count: number; hPct: number };
type StatusRow = { name: string; value: number; pct: number; vsEven: number };
type LocationRow = { cameraLocationId: string; count: number; nextRankCount: number | null; rank: number };

type SevenDay = NonNullable<AnalyticsResponse['violations']['descriptive']>['sevenDayComparison'];

type Locale = 'en' | 'fil';

const COPY: Record<
  Locale,
  {
    title: string;
    rangeLabel: string;
    trendUp: (pct: number) => string;
    trendDown: (pct: number) => string;
    trendFlat: string;
    rollingLine: (cur: number, prev: number, delta: number, dir: 'up' | 'down' | 'flat') => string;
    violationsSpark: (n: number) => string;
    noDaily: string;
    pipelineHeading: string;
    zonesHeading: string;
    highPriority: string;
    rank: string;
    violationsLabel: string;
    noZones: string;
    downloadPdfBtn: string;
    printTitle: string;
    generated: string;
    period: string;
    zonesTable: string;
    pipelineSection: string;
    otherStatuses: string;
    linkFullCharts: string;
  }
> = {
  en: {
    title: 'Weekly performance report',
    rangeLabel: 'Reporting period',
    trendUp: (pct) => `↑ ${pct}% increase`,
    trendDown: (pct) => `↓ ${pct}% decrease`,
    trendFlat: 'No change vs prior week',
    rollingLine: (cur, prev, delta, dir) => {
      if (dir === 'flat') return `Rolling 7 days: ${cur.toLocaleString()} violations (same as prior week ${prev.toLocaleString()}).`;
      const w = dir === 'up' ? 'up' : 'down';
      return `Rolling 7 days: ${cur.toLocaleString()} violations (${w} ${Math.abs(delta)} vs prior week’s ${prev.toLocaleString()}).`;
    },
    violationsSpark: (n) => `Violations (last ${n} days in range)`,
    noDaily: 'No daily totals for this filter.',
    noZones: 'No zone data for this filter.',
    pipelineHeading: 'Enforcement pipeline',
    zonesHeading: 'Zone leaderboard',
    highPriority: 'High priority',
    rank: 'Rank',
    violationsLabel: 'Violations',
    downloadPdfBtn: 'Download PDF for Barangay meeting',
    printTitle: 'Weekly performance report — Barangay',
    generated: 'Generated',
    period: 'Period',
    zonesTable: 'Zone leaderboard (violations)',
    pipelineSection: 'Pipeline (counts)',
    otherStatuses: 'Other statuses',
    linkFullCharts: 'Full traffic chart & export',
  },
  fil: {
    title: 'Lingguhang ulat ng pagganap',
    rangeLabel: 'Saklaw ng ulat',
    trendUp: (pct) => `↑ ${pct}% na pagtaas`,
    trendDown: (pct) => `↓ ${pct}% na pagbaba`,
    trendFlat: 'Walang pagbabago kumpara noong nakaraang linggo',
    rollingLine: (cur, prev, delta, dir) => {
      if (dir === 'flat')
        return `Huling 7 araw: ${cur.toLocaleString()} na paglabag (pareho sa nakaraang linggo na ${prev.toLocaleString()}).`;
      const w = dir === 'up' ? 'tumaas nang' : 'bumaba nang';
      return `Huling 7 araw: ${cur.toLocaleString()} na paglabag (${w} ${Math.abs(delta)} kumpara sa nakaraang linggo na ${prev.toLocaleString()}).`;
    },
    violationsSpark: (n) => `Mga paglabag (huling ${n} araw sa saklaw)`,
    noDaily: 'Walang pang-araw-araw na datos sa filter na ito.',
    noZones: 'Walang datos ng sona sa filter na ito.',
    pipelineHeading: 'Daloy ng pagpapatupad',
    zonesHeading: 'Ranking ng mga sona',
    highPriority: 'Mataas na prayoridad',
    rank: 'Ranggo',
    violationsLabel: 'Mga paglabag',
    downloadPdfBtn: 'I-download ang PDF para sa pulong ng Barangay',
    printTitle: 'Lingguhang ulat — Barangay',
    generated: 'Nilikha',
    period: 'Saklaw',
    zonesTable: 'Ranking ng sona (mga paglabag)',
    pipelineSection: 'Daloy (bilang)',
    otherStatuses: 'Iba pang estado',
    linkFullCharts: 'Buong tsart ng trapiko at export',
  },
};

const PIPELINE_STEPS: Array<{
  id: string;
  match: (name: string) => boolean;
  icon: LucideIcon;
  labelEn: string;
  labelFil: string;
}> = [
  {
    id: 'warning',
    match: (n) => n.toLowerCase() === 'warning',
    icon: AlertTriangle,
    labelEn: 'Warning',
    labelFil: 'Babala',
  },
  {
    id: 'pending',
    match: (n) => n.toLowerCase() === 'pending',
    icon: Clock,
    labelEn: 'Pending',
    labelFil: 'Nakabinbin',
  },
  {
    id: 'issued',
    match: (n) => n.toLowerCase() === 'issued',
    icon: Clipboard,
    labelEn: 'Issued',
    labelFil: 'Inisyu',
  },
  {
    id: 'resolved',
    match: (n) => n.toLowerCase() === 'resolved',
    icon: CheckCircle2,
    labelEn: 'Resolved',
    labelFil: 'Naresolba',
  },
];

function autoTableFinalY(doc: import('jspdf').jsPDF): number {
  const last = (doc as import('jspdf').jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return last?.finalY ?? 40;
}

function formatRollingLine(
  c: SevenDay | undefined,
  t: Locale,
): string | null {
  if (!c) return null;
  const dir = c.delta > 0 ? 'up' : c.delta < 0 ? 'down' : 'flat';
  return COPY[t].rollingLine(c.currentTotal, c.previousTotal, c.delta, dir);
}

function trendBadgeContent(c: SevenDay | undefined, t: Locale): { text: string; className: string } | null {
  if (!c) return null;
  const pct = Math.round(Math.abs(c.deltaPct));
  if (c.deltaPct > 0) {
    return { text: COPY[t].trendUp(pct), className: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-100' };
  }
  if (c.deltaPct < 0) {
    return {
      text: COPY[t].trendDown(pct),
      className: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-50',
    };
  }
  return { text: COPY[t].trendFlat, className: 'border-border bg-muted/60 text-muted-foreground' };
}

export function RangeSnapshotCard({
  insightRangeCaption,
  sevenDayComparison,
  snapshotLast7Bars,
  statusBarsSorted,
  violationsByLocationData,
  violations,
}: {
  insightRangeCaption: string;
  sevenDayComparison: SevenDay | undefined;
  snapshotLast7Bars: SnapshotBar[];
  statusBarsSorted: StatusRow[];
  violationsByLocationData: LocationRow[];
  violations: Violation[];
}) {
  const [locale, setLocale] = useState<Locale>('en');
  const t = COPY[locale];
  const rolling = formatRollingLine(sevenDayComparison, locale);
  const trend = trendBadgeContent(sevenDayComparison, locale);

  const pipelineSteps = useMemo(() => {
    return PIPELINE_STEPS.map((def) => {
      const row = statusBarsSorted.find((s) => def.match(s.name));
      return {
        ...def,
        count: row?.value ?? 0,
        label: locale === 'fil' ? def.labelFil : def.labelEn,
      };
    });
  }, [statusBarsSorted, locale]);

  const otherStatuses = useMemo(
    () => statusBarsSorted.filter((s) => !PIPELINE_STEPS.some((p) => p.match(s.name))),
    [statusBarsSorted],
  );

  const zones = violationsByLocationData.slice(0, 5);

  const handleDownloadBarangayPdf = useCallback(async () => {
    try {
      const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const autoTable = autoTableMod.default;
      const tt = COPY[locale];
      const roll = formatRollingLine(sevenDayComparison, locale);
      const tr = trendBadgeContent(sevenDayComparison, locale);
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const margin = 14;
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      let y = 18;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(tt.title, margin, y);
      y += 10;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`${tt.generated}: ${new Date().toLocaleString()}`, margin, y);
      y += 5;
      doc.text(`${tt.period}: ${insightRangeCaption}`, margin, y);
      y += 6;

      if (tr) {
        doc.setFont('helvetica', 'bold');
        doc.text(tr.text, margin, y);
        doc.setFont('helvetica', 'normal');
        y += 6;
      }

      if (roll) {
        const lines = doc.splitTextToSize(roll, pageW - margin * 2);
        doc.text(lines, margin, y);
        y += lines.length * 4.5 + 4;
      }

      autoTable(doc, {
        startY: y,
        head: [[locale === 'fil' ? 'Araw' : 'Day', tt.violationsLabel]],
        body:
          snapshotLast7Bars.length > 0
            ? snapshotLast7Bars.map((b) => [b.label, String(b.count)])
            : [['—', '0']],
        margin: { left: margin, right: margin },
        styles: { fontSize: 9, cellPadding: 1.2 },
        headStyles: { fillColor: [51, 65, 85] },
      });
      y = autoTableFinalY(doc) + 8;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(tt.pipelineSection, margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);

      autoTable(doc, {
        startY: y,
        head: [[locale === 'fil' ? 'Hakbang' : 'Step', locale === 'fil' ? 'Bilang' : 'Count']],
        body: pipelineSteps.map((p) => [p.label, String(p.count)]),
        margin: { left: margin, right: margin },
        styles: { fontSize: 9 },
        headStyles: { fillColor: [51, 65, 85] },
      });
      y = autoTableFinalY(doc) + 6;

      if (otherStatuses.length > 0) {
        const line = `${tt.otherStatuses}: ${otherStatuses.map((s) => `${s.name} ${s.value}`).join(' · ')}`;
        const wrapped = doc.splitTextToSize(line, pageW - margin * 2);
        doc.text(wrapped, margin, y);
        y += wrapped.length * 4.5 + 6;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(tt.zonesTable, margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');

      autoTable(doc, {
        startY: y,
        head: [['#', locale === 'fil' ? 'Sona' : 'Zone', tt.violationsLabel]],
        body: zones.map((z, i) => [
          String(i + 1),
          i === 0 ? `${z.cameraLocationId} (${tt.highPriority})` : z.cameraLocationId,
          String(z.count),
        ]),
        margin: { left: margin, right: margin },
        styles: { fontSize: 9 },
        headStyles: { fillColor: [51, 65, 85] },
        columnStyles: { 0: { cellWidth: 14 } },
      });
      y = autoTableFinalY(doc) + 6;

      const footerLines = doc.splitTextToSize(`${tt.printTitle} — ${insightRangeCaption}`, pageW - margin * 2);
      doc.setFontSize(8);
      doc.setTextColor(80);
      doc.text(footerLines, margin, Math.min(y + 4, pageH - 12));
      doc.setTextColor(0);

      const fname = `barangay-weekly-${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(fname);
      toast({ title: 'PDF downloaded', description: fname });
    } catch (e) {
      console.error(e);
      toast({
        title: 'PDF export failed',
        description: e instanceof Error ? e.message : 'Could not build PDF.',
        variant: 'destructive',
      });
    }
  }, [
    insightRangeCaption,
    locale,
    otherStatuses,
    pipelineSteps,
    sevenDayComparison,
    snapshotLast7Bars,
    zones,
  ]);

  return (
    <div className="glass-card flex flex-1 flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-border/60 pb-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{t.title}</h2>
            {trend ? (
              <Badge variant="outline" className={cn('text-[10px] font-semibold tabular-nums', trend.className)}>
                {trend.text}
              </Badge>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/90">{t.rangeLabel}:</span> {insightRangeCaption}
          </p>
          {rolling ? <p className="text-xs leading-relaxed text-foreground">{rolling}</p> : null}
        </div>
        <div
          className="flex shrink-0 rounded-md border border-border bg-muted/40 p-0.5"
          role="group"
          aria-label="Language"
        >
          <button
            type="button"
            onClick={() => setLocale('en')}
            className={cn(
              'rounded px-2 py-1 text-[10px] font-medium transition-colors',
              locale === 'en' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => setLocale('fil')}
            className={cn(
              'rounded px-2 py-1 text-[10px] font-medium transition-colors',
              locale === 'fil' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            FIL
          </button>
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t.violationsSpark(snapshotLast7Bars.length || 0)}
        </p>
        {snapshotLast7Bars.length > 0 ? (
          <div className="flex h-24 items-end justify-between gap-1.5 border-b border-border/40 pb-1">
            {snapshotLast7Bars.map((b) => (
              <div key={b.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span
                  className="w-full max-w-[2.5rem] rounded-t-sm bg-primary/80 transition-all dark:bg-primary/70"
                  style={{ height: `${Math.max(6, Math.round((b.hPct / 100) * 72))}px` }}
                  title={`${b.label}: ${b.count}`}
                />
                <span className="text-[10px] tabular-nums text-muted-foreground">{b.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t.noDaily}</p>
        )}
      </div>

      <div className="mb-4">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t.pipelineHeading}</p>
        <div className="flex flex-wrap items-stretch justify-between gap-2">
          {pipelineSteps.map((step, i) => (
            <Fragment key={step.id}>
              <div className="flex min-w-[4.5rem] flex-1 flex-col items-center gap-1.5 text-center">
                <div
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-background shadow-sm',
                    step.count > 0 ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground/50',
                  )}
                >
                  <step.icon className="h-4 w-4" aria-hidden />
                </div>
                <span className="text-[10px] font-medium leading-tight text-foreground">{step.label}</span>
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">{step.count}</span>
              </div>
              {i < pipelineSteps.length - 1 ? (
                <div
                  className="hidden min-h-[2.5rem] flex-1 items-center self-center sm:flex"
                  aria-hidden
                  style={{ maxWidth: '3rem' }}
                >
                  <div className="h-px w-full bg-border" />
                </div>
              ) : null}
            </Fragment>
          ))}
        </div>
        {otherStatuses.length > 0 ? (
          <p className="mt-2 text-[10px] text-muted-foreground">
            {t.otherStatuses}:{' '}
            {otherStatuses.map((s) => (
              <span key={s.name} className="mr-2 inline">
                {s.name} {s.value}
              </span>
            ))}
          </p>
        ) : null}
      </div>

      <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
        Street-trace map lives in{' '}
        <a href="#dashboard-full-analytics" className="font-medium text-primary underline-offset-2 hover:underline">
          Dashboard → Analytics
        </a>
        .
      </p>

      <div className="mt-auto flex flex-col gap-2 border-t border-border/60 pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-full gap-2 text-xs"
          onClick={handleDownloadBarangayPdf}
        >
          <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t.downloadPdfBtn}
        </Button>
        <a
          href="#dashboard-full-analytics"
          className="text-center text-[10px] font-medium text-primary underline-offset-2 hover:underline"
        >
          {t.linkFullCharts}
        </a>
      </div>
    </div>
  );
}
