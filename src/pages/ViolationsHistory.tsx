import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { SearchNoMatchesEmpty } from '@/components/search/SearchNoMatchesEmpty';
import {
  FileText,
  Search,
  Filter,
  Download,
  MapPin,
  BarChart3,
  TrendingUp,
  Info,
  Home,
  X,
  ChevronDown,
  Eye,
  Shield,
} from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { trackAction } from '@/lib/auditTracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Violation, ViolationStatus } from '@/types/parking';
import { violationsAPI, camerasAPI, residentsAPI } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Camera } from '@/types/parking';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const SERVER_BASE_URL = API_BASE_URL.replace('/api', '');

const STATUS_OPTIONS: { value: ViolationStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'warning', label: 'Warning' },
  { value: 'issued', label: 'Issued' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'cleared', label: 'Cleared' },
  { value: 'pending', label: 'Pending' },
  { value: 'cancelled', label: 'Cancelled' },
];

interface ViolationStats {
  total: number;
  byStatus: Record<string, number>;
  byLocation: Array<{ cameraLocationId: string; count: number }>;
  byDate: Array<{ date: string; count: number }>;
}

type ViolationListFilters = {
  status?: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  plateNumber?: string;
  residentId?: string;
};

const URL_PRESETTABLE_STATUSES = new Set(
  STATUS_OPTIONS.filter((o) => o.value !== 'all').map((o) => o.value as string),
);

type PeriodFilter = 'day' | 'week' | 'month';

function periodRangeFromQuery(period: string | null): { startDate: string; endDate: string } | null {
  if (period !== 'day' && period !== 'week' && period !== 'month') return null;
  const end = new Date();
  const start = new Date(end);
  if (period === 'day') {
    // keep same calendar day window
  } else if (period === 'week') {
    start.setDate(start.getDate() - 6);
  } else {
    start.setDate(1);
  }
  const toYmd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return { startDate: toYmd(start), endDate: toYmd(end) };
}

function periodLabel(period: PeriodFilter, startDate?: string, endDate?: string): string {
  if (period === 'day') {
    if (startDate) {
      const d = new Date(`${startDate}T00:00:00`);
      return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    }
    return 'Today';
  }
  if (period === 'week') {
    if (startDate && endDate) {
      const s = new Date(`${startDate}T00:00:00`);
      const e = new Date(`${endDate}T00:00:00`);
      return `${s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    }
    return 'Last 7 days';
  }
  if (startDate) {
    const d = new Date(`${startDate}T00:00:00`);
    return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  }
  return new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function classifySeverity(status: ViolationStatus): 'infraction' | 'violation' {
  return status === 'warning' || status === 'pending' ? 'infraction' : 'violation';
}

function evidenceImageSrc(v: Violation): string | null {
  if (v.imageBase64) {
    if (v.imageBase64.startsWith('data:')) return v.imageBase64;
    return `data:image/jpeg;base64,${v.imageBase64}`;
  }
  if (v.imageUrl) {
    const name = v.imageUrl.split(/[/\\]/).pop();
    return `${SERVER_BASE_URL}/captured_images/${name}`;
  }
  return null;
}

type TimelineStep = {
  key: string;
  label: string;
  at: Date | null;
  done: boolean;
  detail?: string;
};

function buildTimeline(v: Violation): TimelineStep[] {
  const detectedAt = new Date(v.timeDetected);
  const hasWarning = ['warning', 'pending', 'issued', 'resolved', 'cleared'].includes(v.status);
  const hasTicket = ['issued', 'resolved', 'cleared'].includes(v.status);
  const isResolved = ['resolved', 'cleared', 'cancelled'].includes(v.status);
  return [
    { key: 'detected', label: 'Detected', at: detectedAt, done: true, detail: 'YOLO capture logged' },
    {
      key: 'warn',
      label: 'Warning Sent',
      at: v.smsSentAt ? new Date(v.smsSentAt) : hasWarning ? detectedAt : null,
      done: hasWarning,
      detail: v.smsSentAt ? 'Owner notified via SMS' : 'Queued for warning',
    },
    {
      key: 'issued',
      label: 'Ticket Issued',
      at: v.timeIssued ? new Date(v.timeIssued) : null,
      done: hasTicket,
      detail: v.ticketId ? `Ticket: ${v.ticketId}` : 'Awaiting issuance',
    },
    {
      key: 'resolved',
      label: 'Resolved',
      at: isResolved ? (v.timeIssued ? new Date(v.timeIssued) : detectedAt) : null,
      done: isResolved,
      detail: isResolved ? `Status: ${v.status}` : 'Open case',
    },
  ];
}

export default function ViolationsHistory() {
  usePageTracking();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const periodParam = searchParams.get('period');
  const periodPreset = periodRangeFromQuery(periodParam);
  const appliedPlatePresetRef = useRef(false);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [stats, setStats] = useState<ViolationStats | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  
  // Filters (initialize from URL when opening ledger links from the dashboard)
  const [statusFilter, setStatusFilter] = useState<ViolationStatus | 'all'>(() => {
    const s = searchParams.get('status')?.trim().toLowerCase();
    if (s && URL_PRESETTABLE_STATUSES.has(s)) return s as ViolationStatus;
    return 'all';
  });
  const [locationFilter, setLocationFilter] = useState<string>(() => {
    return searchParams.get('locationId')?.trim() || 'all';
  });
  const [startDate, setStartDate] = useState<string>(
    () => searchParams.get('startDate')?.trim() || periodPreset?.startDate || '',
  );
  const [endDate, setEndDate] = useState<string>(
    () => searchParams.get('endDate')?.trim() || periodPreset?.endDate || '',
  );
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>('');
  const [registryHasViolations, setRegistryHasViolations] = useState(false);
  const [expandedViolationId, setExpandedViolationId] = useState<string | null>(null);
  const [evidenceViolation, setEvidenceViolation] = useState<Violation | null>(null);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter | null>(() => {
    const p = searchParams.get('period');
    return p === 'day' || p === 'week' || p === 'month' ? p : null;
  });

  const multiPlateContext = useMemo(() => {
    const plates = (location.state as { relatedPlates?: string[] } | null)?.relatedPlates;
    if (!Array.isArray(plates) || plates.length < 2) return null;
    return plates;
  }, [location.state]);

  const highlightViolationId = searchParams.get('violationId')?.trim() ?? '';
  const residentFilterId = searchParams.get('residentId')?.trim() ?? '';
  const [residentFilterLabel, setResidentFilterLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!residentFilterId) {
      setResidentFilterLabel(null);
      return;
    }
    let cancelled = false;
    residentsAPI
      .getById(residentFilterId)
      .then((r: { name: string }) => {
        if (!cancelled) setResidentFilterLabel(r.name);
      })
      .catch(() => {
        if (!cancelled) setResidentFilterLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [residentFilterId]);

  useEffect(() => {
    const p = searchParams.get('period');
    if (p !== 'day' && p !== 'week' && p !== 'month') {
      setPeriodFilter(null);
      return;
    }
    setPeriodFilter(p);
    const qsStart = searchParams.get('startDate')?.trim();
    const qsEnd = searchParams.get('endDate')?.trim();
    if (qsStart || qsEnd) {
      setStartDate(qsStart || '');
      setEndDate(qsEnd || '');
      return;
    }
    const range = periodRangeFromQuery(p);
    if (!range) return;
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  }, [searchParams]);

  useEffect(() => {
    if (appliedPlatePresetRef.current) return;
    const fromQuery = searchParams.get('plate')?.trim();
    const fromState = (location.state as { presetPlate?: string } | null)?.presetPlate?.trim();
    const plate = fromQuery || fromState;
    if (plate) {
      setSearchTerm(plate);
      appliedPlatePresetRef.current = true;
    }
  }, [searchParams, location.state]);

  useEffect(() => {
    if (!highlightViolationId || violations.length === 0 || isRefreshing) return;
    const t = window.setTimeout(() => {
      document.getElementById(`violation-row-${highlightViolationId}`)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    }, 120);
    return () => clearTimeout(t);
  }, [highlightViolationId, violations, isRefreshing]);

  const loadCameras = async () => {
    try {
      const data = await camerasAPI.getAll();
      setCameras(data);
    } catch (error) {
      console.error('Error loading cameras:', error);
    }
  };

  const loadViolations = useCallback(async (initial = false) => {
    try {
      if (initial) {
        setIsInitialLoading(true);
      } else {
        setIsRefreshing(true);
      }
      const filters: ViolationListFilters = {};

      if (statusFilter !== 'all') {
        filters.status = statusFilter;
      }
      if (locationFilter !== 'all') {
        filters.locationId = locationFilter;
      }
      if (startDate) {
        filters.startDate = new Date(startDate).toISOString();
      }
      if (endDate) {
        filters.endDate = new Date(endDate).toISOString();
      }
      if (debouncedSearchTerm) {
        filters.plateNumber = debouncedSearchTerm;
      }
      if (residentFilterId) {
        filters.residentId = residentFilterId;
      }

      const data = (await violationsAPI.getAll(filters)) as Violation[];
      const processedViolations = data.map((v) => ({
        ...v,
        timeDetected: new Date(v.timeDetected),
        timeIssued: v.timeIssued ? new Date(v.timeIssued) : undefined,
        warningExpiresAt: v.warningExpiresAt ? new Date(v.warningExpiresAt) : undefined,
      }));
      setViolations(processedViolations);
    } catch (error) {
      console.error('Error loading violations:', error);
      toast({
        title: "Error",
        description: "Failed to load violations. Make sure the backend server is running.",
        variant: "destructive",
      });
    } finally {
      if (initial) {
        setIsInitialLoading(false);
      } else {
        setIsRefreshing(false);
      }
    }
  }, [statusFilter, locationFilter, startDate, endDate, debouncedSearchTerm, residentFilterId]);

  const loadStats = useCallback(async () => {
    try {
      setIsLoadingStats(true);
      const filters: { startDate?: string; endDate?: string; locationId?: string } = {};
      
      if (startDate) {
        filters.startDate = new Date(startDate).toISOString();
      }
      if (endDate) {
        filters.endDate = new Date(endDate).toISOString();
      }
      if (locationFilter !== 'all') {
        filters.locationId = locationFilter;
      }

      const data = await violationsAPI.getStats(filters);
      setStats(data);
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  }, [startDate, endDate, locationFilter]);

  useEffect(() => {
    loadCameras();
    loadViolations(true);
    loadStats();
    // Initial page bootstrap should run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 250);
    return () => clearTimeout(timeout);
  }, [searchTerm]);

  useEffect(() => {
    const broadest =
      statusFilter === 'all' &&
      locationFilter === 'all' &&
      !startDate &&
      !endDate &&
      debouncedSearchTerm.trim() === '' &&
      !residentFilterId;
    if (broadest) {
      setRegistryHasViolations(violations.length > 0);
    }
  }, [violations, statusFilter, locationFilter, startDate, endDate, debouncedSearchTerm, residentFilterId]);

  useEffect(() => {
    if (isInitialLoading) return;
    loadViolations(false);
    loadStats();
  }, [
    isInitialLoading,
    loadStats,
    loadViolations,
    statusFilter,
    locationFilter,
    startDate,
    endDate,
    debouncedSearchTerm,
    residentFilterId,
  ]);

  const getStatusBadge = (status: ViolationStatus) => {
    const severity = classifySeverity(status);
    const label = severity === 'violation' ? 'Violation' : 'Infraction';
    if (severity === 'infraction') {
      return (
        <Badge variant="outline" className="border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300">
          {label}
        </Badge>
      );
    }
    return (
      <Badge className="border-transparent bg-red-600 text-red-50">
        {label}
      </Badge>
    );
  };

  const exportToCSV = async () => {
    // Track export action
    await trackAction('export', 'violations', null, { format: 'csv', count: violations.length });
    
    const headers = ['ID', 'Ticket ID', 'Plate Number', 'Location', 'Status', 'Time Detected', 'Time Issued', 'Warning Expires At'];
    const rows = violations.map(v => [
      v.id,
      v.ticketId || '',
      v.plateNumber,
      v.cameraLocationId,
      v.status,
      v.timeDetected.toISOString(),
      v.timeIssued?.toISOString() || '',
      v.warningExpiresAt?.toISOString() || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `violations_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Export Successful",
      description: "Violations data exported to CSV",
    });
  };

  const exportToPDF = async () => {
    await trackAction('export', 'violations', null, { format: 'pdf', count: violations.length });
    const [{ jsPDF }] = await Promise.all([import('jspdf')]);
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const readImageAsDataUrl = async (src: string): Promise<string | null> => {
      try {
        const response = await fetch(src);
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        return dataUrl;
      } catch {
        return null;
      }
    };

    for (let i = 0; i < violations.length; i += 1) {
      const v = violations[i];
      if (i > 0) doc.addPage();

      doc.setFontSize(15);
      doc.text('Barangay Blue Ridge B Citation Report', 14, 14);
      doc.setFontSize(10);
      doc.text(`Reference: ${v.ticketId || v.id}`, 14, 21);
      doc.text(`Plate: ${v.plateNumber}`, 14, 27);
      doc.text(`Location: ${v.cameraLocationId}`, 14, 33);
      doc.text(`Detected: ${v.timeDetected.toLocaleString()}`, 14, 39);
      doc.text(`Status: ${classifySeverity(v.status).toUpperCase()} (${v.status})`, 14, 45);
      if (v.timeIssued) {
        doc.text(`Ticket Issued: ${v.timeIssued.toLocaleString()}`, 14, 51);
      }
      if (v.message) {
        const lines = doc.splitTextToSize(`Notes: ${v.message}`, pageW - 28);
        doc.text(lines, 14, 57);
      }

      const evidenceSrc = evidenceImageSrc(v);
      const y = 72;
      const h = 72;
      if (evidenceSrc) {
        const imageData = evidenceSrc.startsWith('data:') ? evidenceSrc : await readImageAsDataUrl(evidenceSrc);
        if (imageData) {
          doc.addImage(imageData, 'JPEG', 14, y, pageW - 28, h, undefined, 'FAST');
        } else {
          doc.rect(14, y, pageW - 28, h);
          doc.text('Evidence image unavailable', 18, y + 10);
        }
      } else {
        doc.rect(14, y, pageW - 28, h);
        doc.text('No CCTV evidence on file', 18, y + 10);
      }
      doc.setFontSize(9);
      doc.text(`Generated ${new Date().toLocaleString()}`, 14, pageH - 10);
    }

    doc.save(`barangay_citation_report_${new Date().toISOString().slice(0, 10)}.pdf`);
    toast({
      title: 'Export Successful',
      description: 'PDF citation report generated.',
    });
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setLocationFilter('all');
    setStartDate('');
    setEndDate('');
    setSearchTerm('');
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('plate');
        next.delete('violationId');
        next.delete('residentId');
        next.delete('period');
        return next;
      },
      { replace: true },
    );
    setPeriodFilter(null);
  };

  const clearResidentFilter = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('residentId');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const uniqueLocations = Array.from(new Set(cameras.map(c => c.locationId))).sort();

  if (isInitialLoading) {
    return (
      <div className="min-h-screen">
        <Header title="Violations History" subtitle="View and manage all parking violations" />
        <div className="p-4 sm:p-6 flex items-center justify-center min-h-[50vh]">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header 
        title="Violations History" 
        subtitle="View and manage all parking violations"
      />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {residentFilterId && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm">
            <div className="flex items-start gap-2 text-muted-foreground">
              <Home className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <p>
                Showing violations linked to{' '}
                <span className="font-medium text-foreground">
                  {residentFilterLabel ?? 'resident'}
                </span>
                {residentFilterLabel ? null : ' (loading name…)'}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={clearResidentFilter}>
              Show all violations
            </Button>
          </div>
        )}
        {multiPlateContext && !residentFilterId && (
          <div
            className="flex gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"
            role="status"
          >
            <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
            <p className="leading-relaxed">
              Showing violations for plate{' '}
              <span className="font-mono font-medium text-foreground">{multiPlateContext[0]}</span>. This resident has{' '}
              {multiPlateContext.length} linked plates — use Search Plate for others:{' '}
              <span className="font-mono text-foreground">
                {multiPlateContext.slice(1).join(', ')}
              </span>
            </p>
          </div>
        )}
        {/* Statistics Cards */}
        {stats && !isLoadingStats && !residentFilterId && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Violations</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{stats.total}</p>
                </div>
                <BarChart3 className="h-8 w-8 text-primary" />
              </div>
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Warnings</p>
                  <p className="text-2xl font-bold text-warning mt-1">{stats.byStatus.warning || 0}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-warning" />
              </div>
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Tickets Issued</p>
                  <p className="text-2xl font-bold text-destructive mt-1">{stats.byStatus.issued || 0}</p>
                </div>
                <FileText className="h-8 w-8 text-destructive" />
              </div>
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Resolved</p>
                  <p className="text-2xl font-bold text-success mt-1">{stats.byStatus.resolved || 0}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-success" />
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="glass-card rounded-xl p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">Filters</h3>
          </div>
          {periodFilter && (
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
              <span>Filtering by: {periodLabel(periodFilter, startDate, endDate)}</span>
              <button
                type="button"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/20"
                onClick={() => {
                  setPeriodFilter(null);
                  setStartDate('');
                  setEndDate('');
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.delete('period');
                    next.delete('startDate');
                    next.delete('endDate');
                    return next;
                  }, { replace: true });
                }}
                aria-label="Clear period filter"
                title="Clear period filter"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Status</label>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ViolationStatus | 'all')}>
                <SelectTrigger className="bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Location</label>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="bg-secondary">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {uniqueLocations.map(location => (
                    <SelectItem key={location} value={location}>
                      {location}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Start Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-secondary"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">End Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-secondary"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Search Plate</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Plate number..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-secondary pl-9"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <Button variant="outline" onClick={clearFilters} size="sm">
              Clear Filters
            </Button>
            <Button onClick={exportToPDF} size="sm" variant="outline" className="ml-auto">
              <Download className="h-4 w-4 mr-2" />
              Download PDF Report
            </Button>
            <Button onClick={exportToCSV} size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Violations Table */}
        {isRefreshing ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <p className="text-muted-foreground">Refreshing violations...</p>
          </div>
        ) : violations.length > 0 ? (
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground">
                  {violations.length} violation{violations.length !== 1 ? 's' : ''} found
                </h3>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Plate Number</TableHead>
                    <TableHead className="text-muted-foreground">Location</TableHead>
                    <TableHead className="text-muted-foreground">Current Status</TableHead>
                    <TableHead className="text-muted-foreground">Ticket ID</TableHead>
                    <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {violations.map((violation) => {
                    const isExpanded = expandedViolationId === violation.id;
                    const timeline = buildTimeline(violation);
                    return (
                      <Fragment key={violation.id}>
                        <TableRow
                          key={violation.id}
                          id={`violation-row-${violation.id}`}
                          className={cn(
                            'border-border',
                            highlightViolationId === violation.id && 'bg-primary/10 ring-2 ring-inset ring-primary/35',
                          )}
                        >
                          <TableCell className="font-mono font-medium">{violation.plateNumber}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              {violation.cameraLocationId}
                            </div>
                          </TableCell>
                          <TableCell>{getStatusBadge(violation.status)}</TableCell>
                          <TableCell className="font-mono text-sm">{violation.ticketId || '-'}</TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setExpandedViolationId((prev) => (prev === violation.id ? null : violation.id))
                              }
                            >
                              <Shield className="h-4 w-4 mr-1" />
                              Audit
                              <ChevronDown className={cn('h-4 w-4 ml-1 transition-transform', isExpanded && 'rotate-180')} />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEvidenceViolation(violation)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Evidence
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow className="border-border bg-muted/20">
                            <TableCell colSpan={5}>
                              <div className="py-2">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Audit Timeline</p>
                                <div className="space-y-3">
                                  {timeline.map((step) => (
                                    <div key={step.key} className="flex items-start gap-3">
                                      <div className={cn('mt-1 h-3 w-3 rounded-full', step.done ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium text-foreground">{step.label}</p>
                                        <p className="text-xs text-muted-foreground">
                                          {step.at ? step.at.toLocaleString() : 'Not yet recorded'}
                                        </p>
                                        {step.detail ? <p className="text-xs text-muted-foreground/90 mt-0.5">{step.detail}</p> : null}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-4">
                                  <Button variant="ghost" size="sm" onClick={() => setExpandedViolationId(null)}>
                                    View Details
                                  </Button>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : registryHasViolations && debouncedSearchTerm.trim() ? (
          <SearchNoMatchesEmpty
            searchTerm={debouncedSearchTerm}
            onClear={() => setSearchTerm('')}
            hint="Check your spelling or try searching for a different plate number."
          />
        ) : (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <FileText className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Violations Found</h3>
            <p className="text-muted-foreground">
              {residentFilterId
                ? `No violations on file for vehicles linked to ${residentFilterLabel ?? 'this resident'}.`
                : searchTerm || statusFilter !== 'all' || locationFilter !== 'all' || startDate || endDate
                  ? 'Try adjusting your filters'
                  : 'No violations recorded yet'}
            </p>
          </div>
        )}
      </div>
      <Dialog open={!!evidenceViolation} onOpenChange={(open) => !open && setEvidenceViolation(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Evidence Viewer</DialogTitle>
            <DialogDescription>
              Plate {evidenceViolation?.plateNumber} - {evidenceViolation?.cameraLocationId}
            </DialogDescription>
          </DialogHeader>
          {evidenceViolation ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/20 aspect-video overflow-hidden">
                {evidenceImageSrc(evidenceViolation) ? (
                  <img
                    src={evidenceImageSrc(evidenceViolation) || ''}
                    alt={`Evidence for ${evidenceViolation.plateNumber}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm">
                    CCTV evidence is not available for this entry.
                  </div>
                )}
              </div>
              <div className="rounded-lg border bg-muted/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">YOLOv8 Metadata</p>
                <ul className="space-y-1 text-sm">
                  <li><span className="text-muted-foreground">Detection ID:</span> <span className="font-mono">{evidenceViolation.detectionId || 'N/A'}</span></li>
                  <li><span className="text-muted-foreground">Class:</span> {evidenceViolation.vehicleType || 'vehicle'}</li>
                  <li><span className="text-muted-foreground">Timestamp:</span> {evidenceViolation.timeDetected.toLocaleString()}</li>
                  <li><span className="text-muted-foreground">Status:</span> {evidenceViolation.status}</li>
                  <li><span className="text-muted-foreground">Message:</span> {evidenceViolation.message || 'N/A'}</li>
                </ul>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

