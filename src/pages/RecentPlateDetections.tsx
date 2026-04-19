import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { ScanLine, RefreshCw, FlaskConical } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { useAuth } from '@/hooks/useAuth';
import { detectionsAPI, violationsAPI } from '@/lib/api';
import type { RecentPlateEntry } from '@/lib/recentPlates';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';

const MINUTE_OPTIONS = [5, 15, 30, 60, 120] as const;

export default function RecentPlateDetections() {
  usePageTracking();
  const { user } = useAuth();
  const isEncoder = user?.role === 'encoder';

  const [minutes, setMinutes] = useState<number>(15);
  const [entries, setEntries] = useState<RecentPlateEntry[]>([]);
  const [meta, setMeta] = useState<{ since: string; lookbackMinutes: number; count: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [testSeedLoading, setTestSeedLoading] = useState(false);

  const showTestDetectionSeed =
    import.meta.env.DEV === true || import.meta.env.VITE_SHOW_TEST_WARNING_BUTTON === 'true';

  const load = useCallback(async () => {
    try {
      const data = (await detectionsAPI.getRecentPlates({ minutes })) as {
        entries?: RecentPlateEntry[];
        since?: string;
        lookbackMinutes?: number;
        count?: number;
      };
      setEntries(data.entries || []);
      setMeta({
        since: data.since || '',
        lookbackMinutes: data.lookbackMinutes ?? minutes,
        count: data.count ?? (data.entries?.length ?? 0),
      });
    } catch (e) {
      console.error(e);
      toast({
        title: 'Failed to load',
        description: 'Could not load recent plate detections.',
        variant: 'destructive',
      });
      setEntries([]);
      setMeta(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [minutes]);

  useEffect(() => {
    if (isEncoder) return;
    setLoading(true);
    load();
  }, [isEncoder, load]);

  useEffect(() => {
    if (isEncoder) return;
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [isEncoder, load]);

  if (isEncoder) {
    return <Navigate to="/vehicles" replace />;
  }

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleSeedTestDetection = async () => {
    setTestSeedLoading(true);
    try {
      let target: { plateNumber: string; locationId: string } | undefined;
      try {
        const warnings = (await violationsAPI.getAll({ status: 'warning', limit: 50 })) as Array<{
          plateNumber?: string;
          cameraLocationId?: string;
        }>;
        const w = warnings.find(
          (v) =>
            v.plateNumber &&
            v.plateNumber !== 'NONE' &&
            v.plateNumber !== 'BLUR' &&
            v.cameraLocationId,
        );
        if (w?.plateNumber && w.cameraLocationId) {
          target = { plateNumber: w.plateNumber, locationId: w.cameraLocationId };
        }
      } catch {
        /* fall back to random seed */
      }

      const result = (await detectionsAPI.seedTestRecentPlate(target)) as {
        plateNumber?: string;
        locationId?: string;
      };
      toast({
        title: 'Test detection added',
        description: target
          ? `Plate ${result.plateNumber} at ${result.locationId ?? 'location'} (matched an active warning).`
          : `Plate ${result.plateNumber} at ${result.locationId ?? 'location'}`,
      });
      setRefreshing(true);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to add test detection';
      toast({
        title: 'Test detection failed',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setTestSeedLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Header
        title="Recent plate detections"
        subtitle={
          meta
            ? `Readable plates in the last ${meta.lookbackMinutes} minutes (newest per plate and location). After a warning’s grace period ends, Barangay SMS is sent only if this plate is detected again here at or after that time.`
            : 'Readable plates in a rolling time window.'
        }
      />

      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ScanLine className="h-5 w-5 text-muted-foreground" aria-hidden />
            <span className="text-sm text-muted-foreground">Lookback</span>
            <Select
              value={String(minutes)}
              onValueChange={(v) => setMinutes(Number.parseInt(v, 10))}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MINUTE_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {meta?.since && (
              <span className="text-xs text-muted-foreground tabular-nums">
                Since {new Date(meta.since).toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showTestDetectionSeed && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testSeedLoading || refreshing}
                onClick={handleSeedTestDetection}
                title="Insert one synthetic detection (dev / test). If any active warning exists, uses that plate and location so post-grace Barangay SMS can be tested."
              >
                <FlaskConical className="h-4 w-4 mr-1 shrink-0" />
                {testSeedLoading ? 'Adding…' : 'Add test detection'}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={handleRefresh}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="glass-card overflow-hidden rounded-xl border border-border">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No readable plate detections in this window.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plate</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="hidden md:table-cell">Camera</TableHead>
                  <TableHead>Detected</TableHead>
                  <TableHead className="hidden lg:table-cell">Class</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={`${e.detectionId ?? e.plateNumber}-${e.locationId}-${e.timestamp}`}>
                    <TableCell className="font-mono font-medium">{e.plateNumber}</TableCell>
                    <TableCell className="max-w-[12rem] truncate">{e.locationId}</TableCell>
                    <TableCell className="hidden max-w-[10rem] truncate font-mono text-xs text-muted-foreground md:table-cell">
                      {e.cameraId ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {new Date(e.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs capitalize">
                      {e.vehicleClass && e.vehicleClass !== 'none' ? e.vehicleClass : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {!loading && meta && (
          <p className="text-xs text-muted-foreground">
            Showing {entries.length} distinct plate{entries.length === 1 ? '' : 's'} (location-scoped).
          </p>
        )}
      </div>
    </div>
  );
}
