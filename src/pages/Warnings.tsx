import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, FlaskConical } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { WarningTimer } from '@/components/dashboard/WarningTimer';
import { Violation } from '@/types/parking';
import { violationsAPI } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

export default function Warnings() {
  usePageTracking();
  const [violations, setViolations] = useState<Violation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [testSeedLoading, setTestSeedLoading] = useState(false);
  const [testSeedUnregLoading, setTestSeedUnregLoading] = useState(false);
  const activeWarnings = violations
    .filter(v => v.status === 'warning')
    .sort((a, b) => {
      const aUrgent = a.unregisteredUrgent ? 1 : 0;
      const bUrgent = b.unregisteredUrgent ? 1 : 0;
      if (aUrgent !== bUrgent) return bUrgent - aUrgent;
      return new Date(b.timeDetected).getTime() - new Date(a.timeDetected).getTime();
    });

  const showTestWarningSeed =
    import.meta.env.DEV === true || import.meta.env.VITE_SHOW_TEST_WARNING_BUTTON === 'true';

  useEffect(() => {
    loadViolations();
    // Refresh every 30 seconds to get new warnings
    const interval = setInterval(loadViolations, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadViolations = async () => {
    try {
      setIsLoading(true);
      const data = await violationsAPI.getAll();
      // Convert date strings to Date objects
      const processedViolations = data.map((v: any) => ({
        ...v,
        timeDetected: new Date(v.timeDetected),
        timeIssued: v.timeIssued ? new Date(v.timeIssued) : undefined,
        warningExpiresAt: v.warningExpiresAt ? new Date(v.warningExpiresAt) : undefined,
        smsSentAt: v.smsSentAt ? new Date(v.smsSentAt) : undefined,
      }));
      setViolations(processedViolations);
    } catch (error) {
      console.error('Error loading violations:', error);
      toast({
        title: "Error",
        description: "Failed to load warnings. Make sure the backend server is running.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelWarning = async (id: string) => {
    try {
      await violationsAPI.update(id, { status: 'cleared' });
      toast({
        title: "Warning Cleared",
        description: "The warning has been cleared successfully",
      });
      await loadViolations();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to clear warning",
        variant: "destructive",
      });
    }
  };

  const handleIssueTicket = async (id: string) => {
    try {
      const violation = violations.find(v => v.id === id);
      if (!violation) return;

      const ticketId = `TICKET-${Date.now()}`;
      await violationsAPI.update(id, {
        status: 'issued',
        timeIssued: new Date().toISOString(),
        ticketId: ticketId,
      });
      
      toast({
        title: "Ticket Issued",
        description: `Ticket ${ticketId} has been issued for plate ${violation.plateNumber}`,
      });
      await loadViolations();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to issue ticket",
        variant: "destructive",
      });
    }
  };

  const handleSendSms = async (violationId: string) => {
    try {
      await violationsAPI.sendSms(violationId);
      toast({
        title: "SMS sent",
        description: "Reminder sent to the registered vehicle owner.",
      });
      await loadViolations();
    } catch (error: any) {
      toast({
        title: "SMS failed",
        description: error?.message || "Failed to send SMS",
        variant: "destructive",
      });
    }
  };

  const handleSeedTestWarning = async () => {
    setTestSeedLoading(true);
    try {
      const result = await violationsAPI.seedTestActiveWarning();
      toast({
        title: "Test warning added",
        description: `Plate ${result.plateNumber} at ${result.cameraLocationId} (~${result.elapsedMinutesSinceDetection} min since detection).`,
      });
      await loadViolations();
    } catch (error: any) {
      toast({
        title: "Test warning failed",
        description: error?.message || "Failed to add test warning",
        variant: "destructive",
      });
    } finally {
      setTestSeedLoading(false);
    }
  };

  const handleSeedUnregisteredWarning = async () => {
    setTestSeedUnregLoading(true);
    try {
      const result = await violationsAPI.seedTestUnregisteredWarning();
      toast({
        title: "Test unregistered warning added",
        description: `Plate ${result.plateNumber} at ${result.cameraLocationId} (urgent).`,
      });
      await loadViolations();
    } catch (error: any) {
      toast({
        title: "Test unregistered warning failed",
        description: error?.message || "Failed to add unregistered warning",
        variant: "destructive",
      });
    } finally {
      setTestSeedUnregLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Header title="Active Warnings" subtitle="Vehicles with pending violations" />
        <div className="p-4 sm:p-6 flex items-center justify-center min-h-[50vh]">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header 
        title="Active Warnings" 
        subtitle="Vehicles with pending violations"
      />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {activeWarnings.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-warning">
                <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="font-medium text-sm sm:text-base">{activeWarnings.length} active warnings</span>
              </div>
              {showTestWarningSeed && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSeedTestWarning}
                    disabled={testSeedLoading}
                    title="Random registered vehicle, random elapsed time since detection (dev / test only)"
                  >
                    <FlaskConical className="h-4 w-4 mr-1 shrink-0" />
                    {testSeedLoading ? "Adding…" : "Add test warning"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSeedUnregisteredWarning}
                    disabled={testSeedUnregLoading}
                    title="Random unregistered urgent warning (dev / test only)"
                  >
                    <FlaskConical className="h-4 w-4 mr-1 shrink-0" />
                    {testSeedUnregLoading ? "Adding…" : "Add test unregistered"}
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-3 sm:space-y-4">
              {activeWarnings.map((violation) => (
                <WarningTimer
                  key={violation.id}
                  violation={violation}
                  onCancel={handleCancelWarning}
                  onIssueTicket={handleIssueTicket}
                  onSendSms={handleSendSms}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center space-y-4">
            <CheckCircle className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-2">All Clear</h3>
            <p className="text-muted-foreground text-sm sm:text-base">No active parking warnings at this time</p>
            {showTestWarningSeed && (
              <div className="flex justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSeedTestWarning}
                  disabled={testSeedLoading}
                >
                  <FlaskConical className="h-4 w-4 mr-1 shrink-0" />
                  {testSeedLoading ? "Adding…" : "Add test warning"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSeedUnregisteredWarning}
                  disabled={testSeedUnregLoading}
                >
                  <FlaskConical className="h-4 w-4 mr-1 shrink-0" />
                  {testSeedUnregLoading ? "Adding…" : "Add test unregistered"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
