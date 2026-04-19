import { useState, useEffect } from 'react';
import { MessageSquare, XCircle, RefreshCw } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { healthAPI } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'error';
  timestamp: string;
  services: {
    database: any;
    ai: any;
    sms: any;
    monitoring: {
      monitoring: any;
      smsRetry: any;
      smsPolling: any;
      cleanup?: any;
      ownerSmsDelay?: {
        delayMinutes: number;
        disabledForDemo: boolean;
        effectiveDelayMinutes: number;
      };
      gracePeriodMinutes?: number;
    };
  };
  system: {
    nodeVersion: string;
    platform: string;
    uptime: number;
    memory: {
      used: number;
      total: number;
      unit: string;
    };
    environment: string;
  };
}

export default function Settings() {
  usePageTracking();
  const { user } = useAuth();
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disableSmsDelayForDemo, setDisableSmsDelayForDemo] = useState(false);
  const [ownerSmsDelayMinutes, setOwnerSmsDelayMinutes] = useState(5);
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState(30);
  const [updatingSmsDelay, setUpdatingSmsDelay] = useState(false);
  const [savingRuntimeConfig, setSavingRuntimeConfig] = useState(false);

  if (user?.role === 'barangay_user') {
    return <Navigate to="/" replace />;
  }

  const fetchHealthStatus = async () => {
    try {
      const data = await healthAPI.getStatus();
      setHealthStatus(data);
      const ownerSmsDelayConfig = data?.services?.monitoring?.ownerSmsDelay;
      const disabledForDemo = Boolean(ownerSmsDelayConfig?.disabledForDemo);
      setDisableSmsDelayForDemo(disabledForDemo);
      setOwnerSmsDelayMinutes(Number(ownerSmsDelayConfig?.delayMinutes ?? 5));
      setGracePeriodMinutes(Number(data?.services?.monitoring?.gracePeriodMinutes ?? 30));
    } catch (error: any) {
      console.error('Failed to fetch health status:', error);
      toast({
        title: "Failed to Load Health Status",
        description: error.message || "Could not connect to health check endpoint",
        variant: "destructive",
      });
      setHealthStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealthStatus();
    const interval = setInterval(fetchHealthStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRetryLoad = async () => {
    setLoading(true);
    await fetchHealthStatus();
  };

  const handleToggleSmsDelay = async (checked: boolean) => {
    setUpdatingSmsDelay(true);
    try {
      const updated = await healthAPI.setOwnerSmsDelay({ disabledForDemo: checked });
      const updatedDisabledState = Boolean(updated?.disabledForDemo);
      setDisableSmsDelayForDemo(updatedDisabledState);
      setHealthStatus((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          services: {
            ...prev.services,
            monitoring: {
              ...prev.services.monitoring,
              ownerSmsDelay: {
                delayMinutes: Number(updated?.delayMinutes ?? 5),
                disabledForDemo: updatedDisabledState,
                effectiveDelayMinutes: Number(updated?.effectiveDelayMinutes ?? (updatedDisabledState ? 0 : 5)),
              },
            },
          },
        };
      });
      toast({
        title: updatedDisabledState ? 'Demo mode enabled' : 'Standard delay restored',
        description: updatedDisabledState
          ? 'Owner SMS will be sent immediately for active warnings.'
          : 'Owner SMS will use the normal 5-minute delay.',
      });
    } catch (error: any) {
      toast({
        title: 'Failed to update SMS delay setting',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setUpdatingSmsDelay(false);
    }
  };

  const handleSaveDemoTimers = async () => {
    const smsDelay = Number.parseInt(String(ownerSmsDelayMinutes), 10);
    const graceDelay = Number.parseInt(String(gracePeriodMinutes), 10);
    if (!Number.isFinite(smsDelay) || smsDelay <= 0) {
      toast({
        title: 'Invalid SMS timer',
        description: 'SMS delay must be a positive number of minutes.',
        variant: 'destructive',
      });
      return;
    }
    if (!Number.isFinite(graceDelay) || graceDelay <= 0) {
      toast({
        title: 'Invalid grace period',
        description: 'Grace period must be a positive number of minutes.',
        variant: 'destructive',
      });
      return;
    }

    setSavingRuntimeConfig(true);
    try {
      await healthAPI.updateRuntimeConfig({
        ownerSmsDelayMinutes: smsDelay,
        ownerSmsDelayDisabledForDemo: disableSmsDelayForDemo,
        gracePeriodMinutes: graceDelay,
      });
      toast({
        title: 'Demo timers saved',
        description: 'Updated timer settings are now active and persisted.',
      });
      await fetchHealthStatus();
    } catch (error: any) {
      toast({
        title: 'Failed to save demo timers',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSavingRuntimeConfig(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <Header title="Settings" subtitle="SMS and warning timing" />
        <div className="p-6 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!healthStatus) {
    return (
      <div className="min-h-screen">
        <Header title="Settings" subtitle="SMS and warning timing" />
        <div className="p-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
                <p className="text-muted-foreground">Failed to load settings</p>
                <Button onClick={handleRetryLoad} className="mt-4" variant="outline">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Settings" subtitle="SMS and warning timing" />

      <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              SMS Behavior
            </CardTitle>
            <CardDescription>
              Configure the warning flow for demos: owner SMS timer first, then warning grace period.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="owner-sms-delay-minutes">Owner SMS timer (minutes)</Label>
                <Input
                  id="owner-sms-delay-minutes"
                  type="number"
                  min={1}
                  value={ownerSmsDelayMinutes}
                  onChange={(event) => setOwnerSmsDelayMinutes(Math.max(1, Number(event.target.value || 1)))}
                  disabled={savingRuntimeConfig}
                />
                <p className="text-xs text-muted-foreground">
                  This runs first after detection before owner SMS is sent.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="grace-period-minutes">Warning grace period (minutes)</Label>
                <Input
                  id="grace-period-minutes"
                  type="number"
                  min={1}
                  value={gracePeriodMinutes}
                  onChange={(event) => setGracePeriodMinutes(Math.max(1, Number(event.target.value || 1)))}
                  disabled={savingRuntimeConfig}
                />
                <p className="text-xs text-muted-foreground">
                  After this expires, the warning escalates for Barangay action.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-4">
              <div className="space-y-1 pr-4">
                <Label htmlFor="disable-sms-delay-demo" className="text-sm font-medium">
                  Disable owner SMS delay (demo mode)
                </Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, owner SMS reminders are sent immediately instead of after 5 minutes.
                </p>
              </div>
              <Switch
                id="disable-sms-delay-demo"
                checked={disableSmsDelayForDemo}
                disabled={updatingSmsDelay}
                onCheckedChange={handleToggleSmsDelay}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Effective owner SMS delay:
                {' '}
                {disableSmsDelayForDemo ? '0 minute (immediate)' : `${ownerSmsDelayMinutes} minute(s)`}
              </span>
              <Badge variant={disableSmsDelayForDemo ? 'secondary' : 'outline'}>
                {disableSmsDelayForDemo ? 'Demo Mode' : 'Standard Mode'}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              <span>
                Order of timers: Owner SMS timer ({disableSmsDelayForDemo ? 0 : ownerSmsDelayMinutes}m)
                {' '}→ Warning grace period ({gracePeriodMinutes}m)
              </span>
              <Button size="sm" onClick={handleSaveDemoTimers} disabled={savingRuntimeConfig || updatingSmsDelay}>
                {savingRuntimeConfig ? 'Saving…' : 'Save demo timers'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
