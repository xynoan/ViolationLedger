import { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  Database, 
  Brain, 
  MessageSquare, 
  Activity,
  CheckCircle2, 
  AlertCircle, 
  XCircle,
  RefreshCw,
  Server,
  Clock,
  HardDrive
} from 'lucide-react';
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

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: any }> = {
    healthy: { variant: 'default', icon: CheckCircle2 },
    degraded: { variant: 'secondary', icon: AlertCircle },
    unhealthy: { variant: 'destructive', icon: XCircle },
    error: { variant: 'destructive', icon: XCircle },
    disabled: { variant: 'outline', icon: AlertCircle }
  };

  const config = variants[status] || variants.degraded;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="flex items-center gap-1">
      <Icon className="h-3 w-3" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function Settings() {
  usePageTracking();
  const { user } = useAuth();
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHealthStatus();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchHealthStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchHealthStatus();
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
        <Header title="System Health & Configuration" subtitle="System Health & Configuration" />
        <div className="p-6 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!healthStatus) {
    return (
      <div className="min-h-screen">
        <Header title="System Health & Configuration" subtitle="System Health & Configuration" />
        <div className="p-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
                <p className="text-muted-foreground">Failed to load health status</p>
                <Button onClick={handleRefresh} className="mt-4" variant="outline">
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
      <Header 
        title="Settings" 
        subtitle="System Health & Configuration"
        action={
          <Button onClick={handleRefresh} disabled={refreshing} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Overall Status */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Overall System Status
                </CardTitle>
                <CardDescription>
                  Last updated: {new Date(healthStatus.timestamp).toLocaleString()}
                </CardDescription>
              </div>
              <StatusBadge status={healthStatus.status} />
            </div>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* SMS Delay Demo Option */}
          <Card className="md:col-span-2">
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

          {/* Database Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Database
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <StatusBadge status={healthStatus.services.database?.status || 'error'} />
              </div>
              {healthStatus.services.database?.connected && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Tables</span>
                    <span className="text-sm font-medium">
                      {healthStatus.services.database.tables?.total || 0} / {healthStatus.services.database.tables?.required || 0}
                    </span>
                  </div>
                  {healthStatus.services.database.tables?.counts && (
                    <div className="pt-2 border-t space-y-1">
                      <p className="text-xs font-medium mb-2">Record Counts:</p>
                      {Object.entries(healthStatus.services.database.tables.counts).map(([table, count]) => (
                        <div key={table} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground capitalize">{table}</span>
                          <span className="font-mono">{count as number}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              <p className="text-xs text-muted-foreground pt-2 border-t">
                {healthStatus.services.database.message}
              </p>
            </CardContent>
          </Card>

          {/* AI Service Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                AI Service (Gemini)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <StatusBadge status={healthStatus.services.ai?.status || 'error'} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Python Available</span>
                <Badge variant={healthStatus.services.ai?.available ? 'default' : 'destructive'}>
                  {healthStatus.services.ai?.available ? 'Yes' : 'No'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">API Key</span>
                <Badge variant={healthStatus.services.ai?.apiKeyConfigured ? 'default' : 'destructive'}>
                  {healthStatus.services.ai?.apiKeyConfigured ? 'Configured' : 'Not Set'}
                </Badge>
              </div>
              {healthStatus.services.ai?.apiKeySource && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">API Key Source</span>
                  <Badge variant="outline" className="text-xs capitalize">
                    {healthStatus.services.ai.apiKeySource.replace('_', ' ')}
                  </Badge>
                </div>
              )}
              {healthStatus.services.ai?.pythonCommand && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Python Command</span>
                  <span className="text-xs font-mono">{healthStatus.services.ai.pythonCommand}</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground pt-2 border-t">
                {healthStatus.services.ai?.message || 'AI service information not available'}
              </p>
            </CardContent>
          </Card>

          {/* Monitoring Services */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Monitoring Services
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Monitoring Service */}
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-sm font-medium">Vehicle Monitoring</span>
                    <div className="text-xs text-muted-foreground pl-4">
                      Interval: {healthStatus.services.monitoring?.monitoring?.interval || 'N/A'}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <StatusBadge status={healthStatus.services.monitoring?.monitoring?.status || 'error'} />
                    <Badge variant={healthStatus.services.monitoring?.monitoring?.running ? 'default' : 'destructive'} className="text-xs">
                      {healthStatus.services.monitoring?.monitoring?.running ? 'Running' : 'Stopped'}
                    </Badge>
                  </div>
                </div>

                {/* SMS Retry Service */}
                {healthStatus.services.monitoring?.smsRetry && (
                  <div className="pt-2 border-t">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <span className="text-sm font-medium">SMS Retry</span>
                        <div className="text-xs text-muted-foreground pl-4">
                          Interval: {healthStatus.services.monitoring.smsRetry.interval || 'N/A'}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <StatusBadge status={healthStatus.services.monitoring.smsRetry.status || 'error'} />
                        <Badge variant={healthStatus.services.monitoring.smsRetry.running ? 'default' : 'destructive'} className="text-xs">
                          {healthStatus.services.monitoring.smsRetry.running ? 'Running' : 'Stopped'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                )}

                {/* SMS Polling Service */}
                {healthStatus.services.monitoring?.smsPolling && (
                  <div className="pt-2 border-t">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <span className="text-sm font-medium">SMS Polling</span>
                        <div className="text-xs text-muted-foreground pl-4">
                          Interval: {healthStatus.services.monitoring.smsPolling.interval || 'N/A'}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <StatusBadge status={healthStatus.services.monitoring.smsPolling.status || 'error'} />
                        <Badge variant={healthStatus.services.monitoring.smsPolling.enabled ? 'default' : 'outline'} className="text-xs">
                          {healthStatus.services.monitoring.smsPolling.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                )}

                {/* Cleanup Service */}
                {healthStatus.services.monitoring?.cleanup && (
                  <div className="pt-2 border-t">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <span className="text-sm font-medium">Cleanup Service</span>
                        <div className="text-xs text-muted-foreground pl-4">
                          Runs every: {healthStatus.services.monitoring.cleanup.interval || 'N/A'}
                        </div>
                        <div className="text-xs text-muted-foreground pl-4">
                          Deletes empty detections older than {healthStatus.services.monitoring.cleanup.retention || 'N/A'}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <StatusBadge status={healthStatus.services.monitoring.cleanup.status || 'error'} />
                        <Badge variant={healthStatus.services.monitoring.cleanup.running ? 'default' : 'destructive'} className="text-xs">
                          {healthStatus.services.monitoring.cleanup.running ? 'Running' : 'Stopped'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* System Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              System Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <HardDrive className="h-4 w-4" />
                  <span>Node.js</span>
                </div>
                <p className="text-sm font-medium">{healthStatus.system.nodeVersion}</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Server className="h-4 w-4" />
                  <span>Platform</span>
                </div>
                <p className="text-sm font-medium capitalize">{healthStatus.system.platform}</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>Uptime</span>
                </div>
                <p className="text-sm font-medium">{formatUptime(healthStatus.system.uptime)}</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <HardDrive className="h-4 w-4" />
                  <span>Memory</span>
                </div>
                <p className="text-sm font-medium">
                  {healthStatus.system.memory.used} / {healthStatus.system.memory.total} {healthStatus.system.memory.unit}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Environment</span>
                <Badge variant="outline" className="capitalize">
                  {healthStatus.system.environment}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

