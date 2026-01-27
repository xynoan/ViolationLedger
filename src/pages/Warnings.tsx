import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { WarningTimer } from '@/components/dashboard/WarningTimer';
import { Violation } from '@/types/parking';
import { violationsAPI } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

export default function Warnings() {
  usePageTracking();
  const [violations, setViolations] = useState<Violation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const activeWarnings = violations.filter(v => v.status === 'warning');

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

  return (
    <div className="min-h-screen">
      <Header 
        title="Active Warnings" 
        subtitle="Vehicles with pending violations"
      />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {isLoading ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <p className="text-muted-foreground">Loading warnings...</p>
          </div>
        ) : activeWarnings.length > 0 ? (
          <>
            <div className="flex items-center gap-2 text-warning">
              <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5" />
              <span className="font-medium text-sm sm:text-base">{activeWarnings.length} active warnings</span>
            </div>
            <div className="space-y-3 sm:space-y-4">
              {activeWarnings.map((violation) => (
                <WarningTimer
                  key={violation.id}
                  violation={violation}
                  onCancel={handleCancelWarning}
                  onIssueTicket={handleIssueTicket}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <CheckCircle className="h-12 w-12 sm:h-16 sm:w-16 text-success mx-auto mb-4" />
            <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-2">All Clear</h3>
            <p className="text-muted-foreground text-sm sm:text-base">No active parking warnings at this time</p>
          </div>
        )}
      </div>
    </div>
  );
}
