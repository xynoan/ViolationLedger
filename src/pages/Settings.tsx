import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare,
  XCircle,
  RefreshCw,
  ListTree,
  Car,
  Compass,
  Users,
  UserCog,
  Save,
  RotateCcw,
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
import {
  DropdownCatalogSettings,
  type DropdownCatalogSettingsHandle,
} from '@/components/settings/DropdownCatalogSettings';
import { cn } from '@/lib/utils';

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

const NAV = [
  { id: 'settings-general', label: 'General' },
  { id: 'settings-visitors', label: 'Visitors' },
  { id: 'settings-residents', label: 'Residents' },
  { id: 'settings-users', label: 'Users' },
  { id: 'settings-notifications', label: 'SMS' },
] as const;

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function Settings() {
  usePageTracking();
  const { user } = useAuth();
  const catalogRef = useRef<DropdownCatalogSettingsHandle>(null);
  const [catalogDirty, setCatalogDirty] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disableSmsDelayForDemo, setDisableSmsDelayForDemo] = useState(false);
  const [ownerSmsDelayMinutes, setOwnerSmsDelayMinutes] = useState(5);
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState(30);
  const [updatingSmsDelay, setUpdatingSmsDelay] = useState(false);
  const [savingRuntimeConfig, setSavingRuntimeConfig] = useState(false);

  const isAdmin = user?.role === 'admin';

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
        title: 'Failed to Load Health Status',
        description: error.message || 'Could not connect to health check endpoint',
        variant: 'destructive',
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
                effectiveDelayMinutes: Number(
                  updated?.effectiveDelayMinutes ?? (updatedDisabledState ? 0 : 5),
                ),
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

  const handleDiscardCatalog = useCallback(() => {
    catalogRef.current?.discard();
  }, []);

  const handleSaveCatalog = useCallback(() => {
    catalogRef.current?.saveAll();
  }, []);

  const handleResetCatalog = useCallback(() => {
    catalogRef.current?.resetCatalogToDefaults();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50/90">
        <Header title="Settings" subtitle="Forms, lists, and notifications" />
        <div className="p-6 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!healthStatus) {
    return (
      <div className="min-h-screen bg-slate-50/90">
        <Header title="Settings" subtitle="Forms, lists, and notifications" />
        <div className="p-6">
          <Card className="border border-border/80 bg-card shadow-none max-w-lg mx-auto">
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

  const navIcon = (id: string) => {
    switch (id) {
      case 'settings-general':
        return Car;
      case 'settings-visitors':
        return Compass;
      case 'settings-residents':
        return Users;
      case 'settings-users':
        return UserCog;
      default:
        return MessageSquare;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/90 text-foreground">
      <Header title="Settings" subtitle="Forms, lists, and notifications" />

      <div
        className={cn(
          'mx-auto flex w-full max-w-[1600px]',
          isAdmin && catalogDirty && 'pb-28',
          !isAdmin && 'pb-10',
        )}
      >
        {isAdmin ? (
          <aside className="sticky top-16 z-20 hidden h-[calc(100vh-4rem)] w-52 shrink-0 overflow-y-auto border-r border-border/80 bg-white/95 px-3 py-6 lg:block">
            <p className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Jump to
            </p>
            <nav className="space-y-0.5" aria-label="Settings sections">
              {NAV.map(({ id, label }) => {
                const Icon = navIcon(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => scrollToSection(id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors',
                      'hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                    {label}
                  </button>
                );
              })}
            </nav>
            <div className="mt-6 border-t border-border/60 pt-4 px-2">
              <p className="text-[11px] leading-snug text-muted-foreground">
                Tip: use <span className="font-medium text-foreground">Reset catalog</span> in the bar below if lists
                get out of hand—it restores built-in defaults.
              </p>
            </div>
          </aside>
        ) : null}

        <div className="min-w-0 flex-1">
          {isAdmin ? (
            <div className="sticky top-16 z-10 flex gap-2 overflow-x-auto border-b border-border/80 bg-slate-50/95 px-3 py-2.5 lg:hidden">
              {NAV.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => scrollToSection(id)}
                  className={cn(
                    'shrink-0 rounded-full border border-border/80 bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm',
                    'hover:bg-muted/80',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="space-y-10 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {isAdmin ? (
              <DropdownCatalogSettings ref={catalogRef} onDirtyChange={setCatalogDirty} />
            ) : (
              <Card className="border border-border/80 bg-card shadow-none">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ListTree className="h-5 w-5" />
                    Form options
                  </CardTitle>
                  <CardDescription>Catalog editing is limited to administrators.</CardDescription>
                </CardHeader>
              </Card>
            )}

            <section id="settings-notifications" className="scroll-mt-24">
              <Card className="border border-border/80 bg-card shadow-none">
                <CardHeader className="space-y-1 pb-4">
                  <CardTitle className="text-lg font-semibold tracking-tight flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-muted-foreground" />
                    SMS &amp; warning timers
                  </CardTitle>
                  <CardDescription className="text-sm leading-relaxed max-w-2xl">
                    Automation used after a vehicle is detected: owner SMS delay, then warning grace period. These
                    settings use the health API and save separately from form lists.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 pt-0">
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <Label htmlFor="owner-sms-delay-minutes" className="text-sm font-medium">
                          Owner SMS timer (minutes)
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Runs after detection before the owner SMS is sent.
                        </p>
                      </div>
                      <Input
                        id="owner-sms-delay-minutes"
                        type="number"
                        min={1}
                        className="h-10 w-full max-w-[8rem] sm:shrink-0"
                        value={ownerSmsDelayMinutes}
                        onChange={(event) => setOwnerSmsDelayMinutes(Math.max(1, Number(event.target.value || 1)))}
                        disabled={savingRuntimeConfig}
                      />
                    </div>
                    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <Label htmlFor="grace-period-minutes" className="text-sm font-medium">
                          Warning grace period (minutes)
                        </Label>
                        <p className="text-xs text-muted-foreground">After this, the warning escalates for Barangay.</p>
                      </div>
                      <Input
                        id="grace-period-minutes"
                        type="number"
                        min={1}
                        className="h-10 w-full max-w-[8rem] sm:shrink-0"
                        value={gracePeriodMinutes}
                        onChange={(event) => setGracePeriodMinutes(Math.max(1, Number(event.target.value || 1)))}
                        disabled={savingRuntimeConfig}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 rounded-lg border border-border/60 bg-muted/15 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1 pr-4">
                      <Label htmlFor="disable-sms-delay-demo" className="text-sm font-medium">
                        Disable owner SMS delay (demo mode)
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        When enabled, owner SMS is sent immediately instead of after the delay.
                      </p>
                    </div>
                    <Switch
                      id="disable-sms-delay-demo"
                      checked={disableSmsDelayForDemo}
                      disabled={updatingSmsDelay}
                      onCheckedChange={handleToggleSmsDelay}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      Effective owner SMS delay:{' '}
                      {disableSmsDelayForDemo ? '0 minute (immediate)' : `${ownerSmsDelayMinutes} minute(s)`}
                    </span>
                    <Badge variant={disableSmsDelayForDemo ? 'secondary' : 'outline'}>
                      {disableSmsDelayForDemo ? 'Demo Mode' : 'Standard Mode'}
                    </Badge>
                  </div>

                  <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      Order: Owner SMS ({disableSmsDelayForDemo ? 0 : ownerSmsDelayMinutes}m) → Grace period (
                      {gracePeriodMinutes}m)
                    </p>
                    <Button
                      size="sm"
                      onClick={handleSaveDemoTimers}
                      disabled={savingRuntimeConfig || updatingSmsDelay}
                    >
                      {savingRuntimeConfig ? 'Saving…' : 'Save timer settings'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>
          </div>
        </div>
      </div>

      {isAdmin && catalogDirty ? (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur-md supports-[backdrop-filter]:bg-background/85"
          role="region"
          aria-label="Unsaved catalog changes"
        >
          <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Unsaved changes</span> to form lists and labels. Discard
              restores the last saved catalog on this device session.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleResetCatalog}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset catalog
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleDiscardCatalog}>
                Discard
              </Button>
              <Button type="button" size="sm" onClick={handleSaveCatalog}>
                <Save className="h-4 w-4 mr-1" />
                Save all settings
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
