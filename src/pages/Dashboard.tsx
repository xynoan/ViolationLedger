import { useState, useEffect, useCallback, useMemo } from 'react';
import { Car, AlertTriangle, CheckCircle, Camera, Plus, Pause, Play, FlaskConical } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { StatCard } from '@/components/dashboard/StatCard';
import { CameraFeed } from '@/components/dashboard/CameraFeed';
import { CaptureResults } from '@/components/dashboard/CaptureResults';
import { WarningTimer } from '@/components/dashboard/WarningTimer';
import Analytics from '@/pages/Analytics';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Vehicle, Camera as CameraType, Violation } from '@/types/parking';
import { vehiclesAPI, camerasAPI, violationsAPI, detectionsAPI, detectionAPI } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

export default function Dashboard() {
  usePageTracking();
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [allCaptures, setAllCaptures] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [detectionEnabled, setDetectionEnabled] = useState(true);
  const [detectionToggleLoading, setDetectionToggleLoading] = useState(false);
  const [testSeedLoading, setTestSeedLoading] = useState(false);
  const [testSeedUnregLoading, setTestSeedUnregLoading] = useState(false);

  const showTestWarningSeed =
    import.meta.env.DEV === true || import.meta.env.VITE_SHOW_TEST_WARNING_BUTTON === 'true';

  // Load detection enabled state on mount
  useEffect(() => {
    detectionAPI.getEnabled().then((r) => setDetectionEnabled(r?.enabled ?? true)).catch(() => {});
  }, []);

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

  // Load data from API (used on mount and by manual refresh)
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [vehiclesData, camerasData, violationsData, detectionsData] = await Promise.all([
        vehiclesAPI.getAll().catch(() => []),
        camerasAPI.getAll().catch(() => []),
        violationsAPI.getAll().catch(() => []),
        detectionsAPI.getAll().catch(() => []),
      ]);
      
      // Ensure deviceId is properly set for cameras
      const camerasWithDeviceId = camerasData.map((camera: any) => {
        const deviceIdValue = camera.deviceId && typeof camera.deviceId === 'string' && camera.deviceId.trim() 
          ? camera.deviceId.trim() 
          : undefined;
        return {
          ...camera,
          deviceId: deviceIdValue
        };
      });
      
      setVehicles(vehiclesData);
      setCameras(camerasWithDeviceId);
      setViolations(
        (violationsData || []).map((v: any) => ({
          ...v,
          timeDetected: new Date(v.timeDetected),
          timeIssued: v.timeIssued ? new Date(v.timeIssued) : undefined,
          warningExpiresAt: v.warningExpiresAt ? new Date(v.warningExpiresAt) : undefined,
          smsSentAt: v.smsSentAt ? new Date(v.smsSentAt) : undefined,
        })),
      );
      // Count all detections (captures) - filter out "none" detections
      const validDetections = Array.isArray(detectionsData) 
        ? detectionsData.filter((d: any) => d.class_name && d.class_name.toLowerCase() !== 'none')
        : [];
      setAllCaptures(validDetections.length);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load dashboard data';
      toast({
        title: "Connection Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
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

  const handleSeedTestWarning = useCallback(async () => {
    setTestSeedLoading(true);
    try {
      const result = await violationsAPI.seedTestActiveWarning();
      toast({
        title: 'Test warning added',
        description: `Plate ${result.plateNumber} at ${result.cameraLocationId} (~${result.elapsedMinutesSinceDetection} min since detection).`,
      });
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add test warning';
      toast({ title: 'Test warning failed', description: message, variant: 'destructive' });
    } finally {
      setTestSeedLoading(false);
    }
  }, [loadData]);

  const handleSeedUnregisteredWarning = useCallback(async () => {
    setTestSeedUnregLoading(true);
    try {
      const result = await violationsAPI.seedTestUnregisteredWarning();
      toast({
        title: 'Test unregistered warning added',
        description: `Plate ${result.plateNumber} at ${result.cameraLocationId} (urgent).`,
      });
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add unregistered warning';
      toast({ title: 'Test unregistered warning failed', description: message, variant: 'destructive' });
    } finally {
      setTestSeedUnregLoading(false);
    }
  }, [loadData]);

  const activeWarnings = violations
    .filter(v => v.status === 'warning')
    .sort((a, b) => {
      const aUrgent = a.unregisteredUrgent ? 1 : 0;
      const bUrgent = b.unregisteredUrgent ? 1 : 0;
      if (aUrgent !== bUrgent) return bUrgent - aUrgent;
      return new Date(b.timeDetected).getTime() - new Date(a.timeDetected).getTime();
    });
  const issuedTickets = violations.filter(v => v.status === 'issued');
  const clearedToday = violations.filter(v => v.status === 'cleared');
  const onlineCameras = cameras.filter((c) => c.status === 'online');
  const firstOnlineCamera = onlineCameras[0];
  const registeredPlates = vehicles.map((vehicle) => vehicle.plateNumber);
  const hasData = vehicles.length > 0 || cameras.length > 0 || violations.length > 0;
  const activeAlertStatuses = new Set<Violation['status']>(['warning', 'pending', 'issued']);
  const activeAlerts = violations.filter((v) => activeAlertStatuses.has(v.status));

  const topViolators = useMemo(() => {
    const vehicleByPlate = new Map(vehicles.map((v) => [v.plateNumber.toUpperCase(), v]));
    const grouped = new Map<string, { name: string; count: number; resident: boolean }>();

    for (const violation of activeAlerts) {
      const plateKey = violation.plateNumber.toUpperCase();
      const linkedVehicle = vehicleByPlate.get(plateKey);
      const name = linkedVehicle?.ownerName?.trim() || `Unknown (${violation.plateNumber})`;
      const key = linkedVehicle?.residentId ? `resident:${linkedVehicle.residentId}` : `name:${name.toLowerCase()}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        grouped.set(key, { name, count: 1, resident: Boolean(linkedVehicle?.residentId) });
      }
    }

    return [...grouped.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
  }, [activeAlerts, vehicles]);

  const frequentViolators = useMemo(() => {
    const residents = topViolators.filter((entry) => entry.resident).slice(0, 5);
    const nonResidents = topViolators.filter((entry) => !entry.resident).slice(0, 5);
    return { residents, nonResidents };
  }, [topViolators]);

  const goToCaptureResults = useCallback(() => {
    const section = document.getElementById('capture-results-section');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Header title="Dashboard" subtitle="Monitor parking violations in real-time" />
        <div className="p-4 sm:p-6 flex items-center justify-center min-h-[50vh]">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header 
        title="Dashboard" 
        subtitle="Monitor parking violations in real-time"
        autoRefreshNotifications={false}
      />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div className="flex justify-end items-center gap-2">
          {!detectionEnabled && (
            <Badge variant="secondary">Detection Paused</Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="hidden devtools-unhide-detection-toggle"
            onClick={handleToggleDetection}
            disabled={detectionToggleLoading}
          >
            {detectionEnabled ? (
              <>
                <Pause className="h-4 w-4 mr-2" />
                Pause Detection
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Resume Detection
              </>
            )}
          </Button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            title="Registered Vehicles"
            value={vehicles.length}
            icon={Car}
            ctaLabel="Go to Vehicles"
            onClick={() => navigate('/vehicles')}
          />
          <StatCard
            title="Active Warnings"
            value={activeWarnings.length}
            icon={AlertTriangle}
            variant="warning"
            ctaLabel="Go to Warnings"
            onClick={() => navigate('/warnings')}
          />
          <StatCard
            title="All Vehicle Captures"
            value={allCaptures}
            icon={Camera}
            variant="default"
            ctaLabel="Go to Capture Results"
            onClick={goToCaptureResults}
          />
          <StatCard
            title="Cleared Today"
            value={clearedToday.length}
            icon={CheckCircle}
            variant="success"
            ctaLabel="Go to Violations History"
            onClick={() => navigate('/violations')}
          />
        </div>

        {!hasData ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <div className="max-w-md mx-auto">
              <Camera className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Welcome to ViolationLedger</h3>
              <p className="text-muted-foreground mb-6">
                Get started by adding cameras and registering vehicles to begin monitoring parking violations
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
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
              {/* Active Warnings */}
              <div className="lg:col-span-2 space-y-4 sm:space-y-6">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base sm:text-lg font-semibold text-foreground flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-warning" />
                    Active Warnings
                    <span className="ml-2 px-2 py-0.5 rounded-full bg-warning/10 text-warning text-xs sm:text-sm">
                      {activeWarnings.length}
                    </span>
                  </h2>
                  {showTestWarningSeed && (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs sm:text-sm"
                        onClick={handleSeedTestWarning}
                        disabled={testSeedLoading}
                        title="Inserts a random registered vehicle as an active warning with a random elapsed time (dev / test only)"
                      >
                        <FlaskConical className="h-4 w-4 mr-1 shrink-0" />
                        {testSeedLoading ? 'Adding…' : 'Add test warning'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs sm:text-sm"
                        onClick={handleSeedUnregisteredWarning}
                        disabled={testSeedUnregLoading}
                        title="Inserts a random unregistered urgent warning (dev / test only)"
                      >
                        <FlaskConical className="h-4 w-4 mr-1 shrink-0" />
                        {testSeedUnregLoading ? 'Adding…' : 'Add test unregistered'}
                      </Button>
                    </div>
                  )}
                </div>

                {activeWarnings.length === 0 ? (
                  <div className="glass-card rounded-xl p-6 sm:p-8 text-center">
                    <CheckCircle className="h-10 w-10 sm:h-12 sm:w-12 text-success mx-auto mb-3" />
                    <p className="text-muted-foreground text-sm sm:text-base">No active warnings</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeWarnings.slice(0, 5).map((warning) => (
                      <WarningTimer
                        key={warning.id}
                        violation={warning}
                        onCancel={handleClearWarning}
                        onIssueTicket={handleMarkTicketed}
                        onSendSms={handleSendSms}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Capture Results */}
              <div className="space-y-4" id="capture-results-section">
                <h2 className="text-base sm:text-lg font-semibold text-foreground flex items-center gap-2">
                  <Camera className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                  Capture Results
                </h2>
                <CaptureResults />
              </div>
              </div>

              {/* Camera feed (tunneled stream.html when online + stream name) */}
              <div className="space-y-4">
                <h2 className="text-base sm:text-lg font-semibold text-foreground">Camera Feed</h2>
                {firstOnlineCamera ? (
                  <CameraFeed
                    camera={firstOnlineCamera}
                    registeredPlates={registeredPlates}
                    onRefresh={() => {
                      camerasAPI
                        .getAll()
                        .then((data) => {
                          const camerasWithDeviceId = data.map((camera: any) => {
                            const deviceIdValue =
                              camera.deviceId &&
                              typeof camera.deviceId === 'string' &&
                              camera.deviceId.trim()
                                ? camera.deviceId.trim()
                                : undefined;
                            return {
                              ...camera,
                              deviceId: deviceIdValue,
                            };
                          });
                          setCameras(camerasWithDeviceId);
                        })
                        .catch(console.error);
                    }}
                  />
                ) : (
                  <div className="glass-card rounded-xl p-6 text-center">
                    <Camera className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground text-sm mb-4">
                      {cameras.length > 0 ? 'No online cameras' : 'No cameras configured'}
                    </p>
                    <Button size="sm" onClick={() => navigate('/cameras')}>
                      <Plus className="h-4 w-4 mr-2" />
                      {cameras.length > 0 ? 'View Cameras' : 'Add Camera'}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <div className="glass-card rounded-xl p-4">
                <h3 className="text-base font-semibold mb-3">Top Violators</h3>
                {topViolators.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active violator records yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Violations</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topViolators.map((entry) => (
                        <TableRow key={`${entry.name}-${entry.resident ? 'r' : 'n'}`}>
                          <TableCell className="font-medium">{entry.name}</TableCell>
                          <TableCell className="text-right">{entry.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div className="glass-card rounded-xl p-4 space-y-4">
                <h3 className="text-base font-semibold">Frequent Violators</h3>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Residents</p>
                  {frequentViolators.residents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No resident violators in active records.</p>
                  ) : (
                    frequentViolators.residents.map((entry) => (
                      <div key={`resident-${entry.name}`} className="flex items-center justify-between text-sm">
                        <span>{entry.name}</span>
                        <Badge variant="secondary">{entry.count}</Badge>
                      </div>
                    ))
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Non-residents</p>
                  {frequentViolators.nonResidents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No non-resident violators in active records.</p>
                  ) : (
                    frequentViolators.nonResidents.map((entry) => (
                      <div key={`nonresident-${entry.name}`} className="flex items-center justify-between text-sm">
                        <span>{entry.name}</span>
                        <Badge variant="secondary">{entry.count}</Badge>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <Analytics embedded />
          </div>
        )}
      </div>
    </div>
  );
}
