import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  Camera,
  ChevronDown,
  Clock,
  FileDown,
  Flag,
  Image as ImageIcon,
  Search,
  Trash2,
  ZoomIn,
} from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { SearchNoMatchesEmpty } from '@/components/search/SearchNoMatchesEmpty';
import {
  getDwellBadgeClasses,
  getDwellMinutes,
  getDwellStatus,
  getDwellToneLabel,
  formatDuration,
} from '@/lib/captureInsights';
import { camerasAPI, detectionsAPI, vehiclesAPI } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import type { Camera as CameraType, Vehicle } from '@/types/parking';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const SERVER_BASE_URL = API_BASE_URL.replace('/api', '');
const normPlate = (value: string) => String(value || '').replace(/\s+/g, '').toUpperCase();

type DetectionApiRow = {
  id?: string;
  cameraId: string;
  timestamp: string | Date;
  class_name?: string;
  plateNumber?: string;
  confidence?: number;
  bbox?: number[];
  imageUrl?: string | null;
  imageBase64?: string | null;
  thumbnail_url?: string | null;
  colorDetected?: string | null;
  vehicleColor?: string | null;
  reviewStatus?: string | null;
};

type CaptureResult = {
  key: string;
  cameraId: string;
  cameraName: string;
  locationId: string;
  timestamp: string;
  firstDetected: string;
  lastSeen: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  imageBase64: string | null;
  detectionIds: string[];
  reviewStatus?: string | null;
  detections: Array<{
    id?: string;
    class_name: string;
    bbox: number[];
    plateNumber?: string;
    confidence?: number | null;
    colorDetected?: string | null;
  }>;
};

export default function Tickets() {
  usePageTracking();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [violationsOnly, setViolationsOnly] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [captureResults, setCaptureResults] = useState<CaptureResult[]>([]);
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedImage, setSelectedImage] = useState<{ src: string; alt: string } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const knownKeysRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);

  const loadCaptureResults = useCallback(async () => {
    try {
      setIsLoading(true);
      const [cameraRows, vehicleRows] = await Promise.all([
        camerasAPI.getAll(),
        vehiclesAPI.getAll().catch(() => []),
      ]);
      setCameras(cameraRows);
      setVehicles(vehicleRows as Vehicle[]);

      const resultsMap = new Map<string, CaptureResult>();
      for (const camera of cameraRows) {
        let detections: DetectionApiRow[] = [];
        try {
          detections = (await detectionsAPI.getByCamera(camera.id)) as DetectionApiRow[];
        } catch (error) {
          console.error(`Error loading detections for camera ${camera.id}:`, error);
          continue;
        }
        if (!detections.length) continue;

        const groupedByTimestamp = new Map<string, DetectionApiRow[]>();
        for (const d of detections) {
          const timestamp =
            typeof d.timestamp === 'string'
              ? d.timestamp
              : d.timestamp instanceof Date
                ? d.timestamp.toISOString()
                : String(d.timestamp);
          if (!groupedByTimestamp.has(timestamp)) groupedByTimestamp.set(timestamp, []);
          groupedByTimestamp.get(timestamp)!.push(d);
        }

        const timestamps = Array.from(groupedByTimestamp.keys()).sort().reverse();
        for (const timestamp of timestamps) {
          const rows = groupedByTimestamp.get(timestamp) || [];
          const valid = rows.filter((d) => (d.class_name || '').toLowerCase() !== 'none');
          const withImage = rows.find((d) => d.thumbnail_url || d.imageUrl || d.imageBase64) || rows[0];
          const key = `${camera.id}-${timestamp}`;
          resultsMap.set(key, {
            key,
            cameraId: camera.id,
            cameraName: camera.name,
            locationId: camera.locationId,
            timestamp,
            firstDetected: timestamp,
            lastSeen: timestamp,
            thumbnailUrl: withImage?.thumbnail_url || withImage?.imageUrl || null,
            imageUrl: withImage?.imageUrl || null,
            imageBase64: withImage?.imageBase64 || null,
            reviewStatus: withImage?.reviewStatus || null,
            detectionIds: rows.map((x) => x.id).filter((x): x is string => !!x),
            detections: valid.map((d) => ({
              id: d.id,
              class_name: d.class_name || 'vehicle',
              bbox: d.bbox || [],
              plateNumber: d.plateNumber,
              confidence: typeof d.confidence === 'number' ? d.confidence : null,
              colorDetected: d.colorDetected || d.vehicleColor || null,
            })),
          });
        }
      }

      const sorted = [...resultsMap.values()].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      setCaptureResults(sorted);

      const newKeys = new Set(sorted.map((x) => x.key));
      if (!firstLoadRef.current && autoRefresh) {
        let fresh = 0;
        newKeys.forEach((k) => {
          if (!knownKeysRef.current.has(k)) fresh += 1;
        });
        if (fresh > 0) {
          toast({
            title: 'New Captures',
            description: `${fresh} new capture${fresh === 1 ? '' : 's'} received.`,
          });
        }
      }
      knownKeysRef.current = newKeys;
      firstLoadRef.current = false;
      setSelectedKeys((prev) => new Set([...prev].filter((k) => newKeys.has(k))));
    } finally {
      setIsLoading(false);
    }
  }, [autoRefresh, toast]);

  useEffect(() => {
    void loadCaptureResults();
  }, [loadCaptureResults]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      void loadCaptureResults();
    }, 8000);
    return () => clearInterval(id);
  }, [autoRefresh, loadCaptureResults]);

  const vehicleByPlate = useMemo(
    () => new Map(vehicles.map((v) => [normPlate(v.plateNumber), v])),
    [vehicles],
  );

  const filteredCaptureResults = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return captureResults
      .filter((result) => {
        if (!q) return true;
        const p = primaryPlate(result).toLowerCase();
        return (
          result.locationId.toLowerCase().includes(q) ||
          result.cameraName.toLowerCase().includes(q) ||
          p.includes(q)
        );
      })
      .filter((result) => (!violationsOnly ? true : getDwellMinutes(result.firstDetected, result.lastSeen) > 30));
  }, [captureResults, searchTerm, violationsOnly]);

  const selectedDetectionIds = useMemo(() => {
    const ids = new Set<string>();
    filteredCaptureResults.forEach((r) => {
      if (!selectedKeys.has(r.key)) return;
      r.detectionIds.forEach((id) => ids.add(id));
    });
    return [...ids];
  }, [filteredCaptureResults, selectedKeys]);

  const allVisibleSelected =
    filteredCaptureResults.length > 0 && filteredCaptureResults.every((r) => selectedKeys.has(r.key));

  function primaryPlate(result: CaptureResult): string {
    const p = result.detections.find((d) => {
      const value = normPlate(String(d.plateNumber || ''));
      return value && value !== 'NONE' && value !== 'BLUR';
    })?.plateNumber;
    return p ? normPlate(p) : 'UNREADABLE';
  }

  function imageSrc(result: CaptureResult): string | null {
    if (result.thumbnailUrl) {
      if (result.thumbnailUrl.startsWith('data:')) return result.thumbnailUrl;
      return `${SERVER_BASE_URL}/captured_images/${result.thumbnailUrl.split(/[/\\]/).pop()}`;
    }
    if (result.imageBase64) {
      if (result.imageBase64.startsWith('data:')) return result.imageBase64;
      return `data:image/jpeg;base64,${result.imageBase64}`;
    }
    if (result.imageUrl) return `${SERVER_BASE_URL}/captured_images/${result.imageUrl.split(/[/\\]/).pop()}`;
    return null;
  }

  const toggleRowSelection = (key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) filteredCaptureResults.forEach((r) => next.add(r.key));
      else filteredCaptureResults.forEach((r) => next.delete(r.key));
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (!selectedDetectionIds.length) return;
    const result = await detectionsAPI.bulkDelete(selectedDetectionIds);
    toast({ title: 'Deleted', description: `${result?.deleted || 0} detections deleted.` });
    setSelectedKeys(new Set());
    await loadCaptureResults();
  };

  const handleFlag = async () => {
    if (!selectedDetectionIds.length) return;
    const result = await detectionsAPI.flagForReview(selectedDetectionIds, 'Flagged from Capture Results');
    toast({ title: 'Flagged', description: `${result?.flagged || 0} detections flagged for review.` });
    setSelectedKeys(new Set());
    await loadCaptureResults();
  };

  const handleExportPdf = () => {
    const rows = filteredCaptureResults.filter((r) => selectedKeys.has(r.key));
    if (!rows.length) return;
    const html = `
      <html><body style="font-family: Arial; padding: 20px">
      <h2>Capture Audit Export</h2>
      <p>Generated ${new Date().toLocaleString()}</p>
      <table border="1" cellspacing="0" cellpadding="6" style="border-collapse: collapse; width:100%">
      <thead><tr><th>Plate</th><th>Camera</th><th>Lane</th><th>Timestamp</th></tr></thead>
      <tbody>
      ${rows
        .map(
          (r) =>
            `<tr><td>${primaryPlate(r)}</td><td>${r.cameraName}</td><td>${r.locationId}</td><td>${new Date(
              r.timestamp,
            ).toLocaleString()}</td></tr>`,
        )
        .join('')}
      </tbody></table></body></html>`;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const ownerBadge = (result: CaptureResult) => {
    const plate = primaryPlate(result);
    if (plate === 'UNREADABLE') return null;
    const matched = vehicleByPlate.get(plate);
    if (!matched) return <Badge variant="destructive" className="text-[10px]">Unregistered</Badge>;
    if (matched.residentId && String(matched.residentId).trim() !== '') {
      return <Badge className="text-[10px] border-transparent bg-blue-900 text-blue-200">Resident</Badge>;
    }
    return <Badge className="text-[10px] border-transparent bg-purple-900 text-purple-200">Visitor</Badge>;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Header title="Capture Results" subtitle="All vehicle capture records" />
        <div className="p-4 sm:p-6 flex items-center justify-center min-h-[50vh]">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Capture Results" subtitle="All vehicle capture records" />

      <div className="sticky top-16 z-20 border-b bg-background/95 backdrop-blur">
        <div className="p-4 sm:px-6 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="relative w-full md:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search plate, camera, or lane..."
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="violations-only" checked={violationsOnly} onCheckedChange={setViolationsOnly} />
              <Label htmlFor="violations-only">Violations Only</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="auto-refresh" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
              <Label htmlFor="auto-refresh">Auto-refresh</Label>
            </div>
          </div>
        </div>

        {filteredCaptureResults.length > 0 ? (
          <div className="px-4 sm:px-6 pb-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Checkbox checked={allVisibleSelected} onCheckedChange={(c) => toggleAllVisible(Boolean(c))} />
              <span className="text-xs text-muted-foreground">Select all visible</span>
            </div>
            {selectedKeys.size > 0 ? (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{selectedKeys.size} selected</Badge>
                <Button size="sm" variant="destructive" onClick={() => void handleBulkDelete()} disabled={!selectedDetectionIds.length}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete Selected
                </Button>
                <Button size="sm" variant="outline" onClick={handleExportPdf}>
                  <FileDown className="h-4 w-4 mr-1" />
                  Export as PDF
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleFlag()} disabled={!selectedDetectionIds.length}>
                  <Flag className="h-4 w-4 mr-1" />
                  Flag for Review
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {filteredCaptureResults.length > 0 ? (
          filteredCaptureResults.map((result) => {
            const captureDate = new Date(result.timestamp);
            const dwell = getDwellStatus(getDwellMinutes(result.firstDetected, result.lastSeen));
            const src = imageSrc(result);
            const plate = primaryPlate(result);
            const avgConfidence = result.detections.length
              ? result.detections.reduce((sum, d) => sum + (typeof d.confidence === 'number' ? d.confidence : 0), 0) /
                result.detections.length
              : null;
            return (
              <div key={result.key} className="glass-card rounded-xl overflow-hidden animate-slide-up">
                <Collapsible className="group">
                  <CollapsibleTrigger className="w-full">
                    <div className="w-full p-4 border-b border-border hover:bg-muted/50 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="pt-1">
                          <Checkbox
                            checked={selectedKeys.has(result.key)}
                            onCheckedChange={(checked) => toggleRowSelection(result.key, Boolean(checked))}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div
                          className="h-[58px] w-[58px] shrink-0 rounded-md overflow-hidden border border-border/70 bg-muted cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!src) return;
                            setSelectedImage({ src, alt: `Capture from ${result.cameraName}` });
                          }}
                        >
                          {src ? <img src={src} alt={result.cameraName} className="h-full w-full object-cover" /> : (
                            <div className="h-full w-full flex items-center justify-center"><ImageIcon className="h-4 w-4 text-muted-foreground/70" /></div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-base font-semibold text-foreground">{plate}</span>
                            {ownerBadge(result)}
                            {result.reviewStatus === 'flagged' ? (
                              <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600">Flagged</Badge>
                            ) : null}
                            <Badge variant="outline" className={cn('border text-[10px]', getDwellBadgeClasses(dwell.tone))}>
                              {dwell.label}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {result.cameraName} • {result.locationId}
                          </div>
                          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{captureDate.toLocaleDateString()}</span>
                            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{captureDate.toLocaleTimeString()}</span>
                          </div>
                        </div>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                      </div>
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="p-4 space-y-4">
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <p className="text-xs font-semibold text-foreground mb-2">AI Metadata</p>
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          <li>Confidence score: {avgConfidence != null ? `${(avgConfidence * 100).toFixed(1)}%` : 'N/A'}</li>
                          <li>
                            Color detection:{' '}
                            {result.detections.map((d) => d.colorDetected).filter(Boolean).join(', ') || 'N/A'}
                          </li>
                          <li>Dwell duration: {formatDuration(dwell.minutes)} ({getDwellToneLabel(dwell.tone)})</li>
                        </ul>
                      </div>

                      <div
                        className="relative rounded-lg overflow-hidden bg-muted aspect-video cursor-pointer group"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!src) return;
                          setSelectedImage({ src, alt: `Capture from ${result.cameraName}` });
                        }}
                      >
                        {src ? (
                          <>
                            <img src={src} alt={result.cameraName} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="flex items-center gap-2 text-white">
                                <ZoomIn className="h-5 w-5" />
                                <span className="text-sm font-medium">View high-res frame</span>
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                            <ImageIcon className="h-10 w-10 opacity-60" />
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/warnings?cameraId=${encodeURIComponent(result.cameraId)}&locationId=${encodeURIComponent(result.locationId)}`);
                          }}
                        >
                          Issue Warning
                        </Button>
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/violations?cameraId=${encodeURIComponent(result.cameraId)}&locationId=${encodeURIComponent(result.locationId)}`);
                          }}
                        >
                          File Violation
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            );
          })
        ) : captureResults.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center">
            <Camera className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No capture results yet</p>
          </div>
        ) : searchTerm.trim() ? (
          <SearchNoMatchesEmpty
            searchTerm={searchTerm}
            onClear={() => setSearchTerm('')}
            hint="Check spelling or try searching by camera/lane."
          />
        ) : (
          <div className="glass-card rounded-xl p-8 text-center">
            <Camera className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No captures match current filters</p>
          </div>
        )}
      </div>

      <Dialog open={!!selectedImage} onOpenChange={(open) => !open && setSelectedImage(null)}>
        <DialogContent className="max-w-4xl w-full p-0">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle>Detection Frame</DialogTitle>
            <DialogDescription>{selectedImage?.alt}</DialogDescription>
          </DialogHeader>
          {selectedImage ? (
            <div className="p-6 pt-0">
              <img src={selectedImage.src} alt={selectedImage.alt} className="w-full h-auto rounded-lg" />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

