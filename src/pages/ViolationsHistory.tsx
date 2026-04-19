import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { SearchNoMatchesEmpty } from '@/components/search/SearchNoMatchesEmpty';
import {
  FileText,
  Search,
  Filter,
  Calendar,
  MapPin,
  BarChart3,
  TrendingUp,
  CheckCircle,
  Info,
  Home,
} from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
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

const STATUS_OPTIONS: { value: ViolationStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'warning', label: 'Warning' },
  { value: 'issued', label: 'Issued' },
  { value: 'cleared', label: 'Cleared' },
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

function errMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function ViolationsHistory() {
  usePageTracking();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const appliedPlatePresetRef = useRef(false);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [stats, setStats] = useState<ViolationStats | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  
  // Filters
  const [statusFilter, setStatusFilter] = useState<ViolationStatus | 'all'>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>('');
  const [registryHasViolations, setRegistryHasViolations] = useState(false);
  const [clearingId, setClearingId] = useState<string | null>(null);

  const visibleViolations = useMemo(
    () =>
      violations.filter((v) => {
        if (statusFilter === 'all') {
          return v.status === 'warning' || v.status === 'issued' || v.status === 'cleared';
        }
        return v.status === statusFilter;
      }),
    [violations, statusFilter],
  );

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
    if (!highlightViolationId || visibleViolations.length === 0 || isRefreshing) return;
    const t = window.setTimeout(() => {
      document.getElementById(`violation-row-${highlightViolationId}`)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    }, 120);
    return () => clearTimeout(t);
  }, [highlightViolationId, visibleViolations, isRefreshing]);

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
      setRegistryHasViolations(
        violations.some(
          (v) => v.status === 'warning' || v.status === 'issued' || v.status === 'cleared',
        ),
      );
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

  const handleClearViolation = async (id: string) => {
    try {
      setClearingId(id);
      await violationsAPI.update(id, { status: 'cleared' });
      toast({
        title: "Violation Cleared",
        description: "The violation has been marked as cleared.",
      });
      await loadViolations();
      await loadStats();
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: errMessage(error, "Failed to clear violation"),
        variant: "destructive",
      });
    } finally {
      setClearingId(null);
    }
  };

  const getStatusBadge = (status: ViolationStatus) => {
    const configs: Record<ViolationStatus, { variant: 'default' | 'secondary' | 'destructive' | 'warning' | 'success'; label: string }> = {
      warning: { variant: 'warning', label: 'Warning' },
      issued: { variant: 'destructive', label: 'Issued' },
      resolved: { variant: 'success', label: 'Resolved' },
      cleared: { variant: 'secondary', label: 'Cleared' },
      pending: { variant: 'default', label: 'Pending' },
      cancelled: { variant: 'secondary', label: 'Cancelled' },
    };
    const config = configs[status] || { variant: 'default', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
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
        return next;
      },
      { replace: true },
    );
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
        <Header
          title="Violations History"
          subtitle="Warnings, issued tickets, and cleared violations (auto or manual clear)"
        />
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
        subtitle="Warnings, issued tickets, and cleared violations (auto or manual clear)"
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
                  <p className="text-sm text-muted-foreground">Cleared</p>
                  <p className="text-2xl font-bold text-muted-foreground mt-1">{stats.byStatus.cleared || 0}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-muted-foreground" />
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
          </div>
        </div>

        {/* Violations Table */}
        {isRefreshing ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <p className="text-muted-foreground">Refreshing violations...</p>
          </div>
        ) : visibleViolations.length > 0 ? (
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground">
                  {visibleViolations.length} violation{visibleViolations.length !== 1 ? 's' : ''} found
                </h3>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Plate Number</TableHead>
                    <TableHead className="text-muted-foreground">Location</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-muted-foreground">Time Detected</TableHead>
                    <TableHead className="text-muted-foreground">Time Issued</TableHead>
                    <TableHead className="text-muted-foreground">Ticket ID</TableHead>
                    <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleViolations.map((violation) => (
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
                      <TableCell className="text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          {violation.timeDetected.toLocaleString()}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {violation.timeIssued ? violation.timeIssued.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {violation.ticketId || '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {violation.status === 'warning' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleClearViolation(violation.id)}
                            disabled={clearingId === violation.id}
                          >
                            {clearingId === violation.id ? (
                              <>Clearing...</>
                            ) : (
                              <>
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Clear
                              </>
                            )}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : violations.length > 0 ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <FileText className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No active violations</h3>
            <p className="text-muted-foreground">
              {debouncedSearchTerm.trim()
                ? 'No violations match your search or filters for this status.'
                : statusFilter === 'cleared'
                  ? 'No cleared violations in this view. Try All Statuses or adjust filters.'
                  : 'There are no warnings, issued tickets, or cleared records in this view. Other statuses are hidden.'}
            </p>
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
    </div>
  );
}

