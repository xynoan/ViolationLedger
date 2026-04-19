import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, XCircle, RefreshCw, ListOrdered, Plus, Trash2 } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { healthAPI } from '@/lib/api';
import { useFormOptions } from '@/hooks/useFormOptions';
import type { VehicleTypeOption, VisitorPurposeOption } from '@/lib/formOptions';
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
      postGraceVerificationMinutes?: number;
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
  const [postGraceVerificationMinutes, setPostGraceVerificationMinutes] = useState(5);
  const [updatingSmsDelay, setUpdatingSmsDelay] = useState(false);
  const [savingRuntimeConfig, setSavingRuntimeConfig] = useState(false);

  const { config: formOpts, reload: reloadFormOpts } = useFormOptions();
  const [vehicleTypesDraft, setVehicleTypesDraft] = useState<VehicleTypeOption[]>([]);
  const [visitorPurposesDraft, setVisitorPurposesDraft] = useState<VisitorPurposeOption[]>([]);
  const [residentVisitLabelDraft, setResidentVisitLabelDraft] = useState('');
  const [rentedDraft, setRentedDraft] = useState<string[]>([]);
  const [streetsDraft, setStreetsDraft] = useState<string[]>([]);
  const [savingFormOptions, setSavingFormOptions] = useState(false);

  useEffect(() => {
    setVehicleTypesDraft(formOpts.vehicleTypeOptions.map((x) => ({ ...x })));
    setVisitorPurposesDraft(formOpts.visitorPurposes.map((x) => ({ ...x })));
    setResidentVisitLabelDraft(formOpts.residentVisitPurposeLabel);
    setRentedDraft([...formOpts.rentedLocationOptions]);
    setStreetsDraft([...formOpts.residentStreets]);
  }, [formOpts]);

  const fetchHealthStatus = useCallback(async () => {
    try {
      const data = await healthAPI.getStatus();
      setHealthStatus(data);
      const ownerSmsDelayConfig = data?.services?.monitoring?.ownerSmsDelay;
      const disabledForDemo = Boolean(ownerSmsDelayConfig?.disabledForDemo);
      setDisableSmsDelayForDemo(disabledForDemo);
      setOwnerSmsDelayMinutes(Number(ownerSmsDelayConfig?.delayMinutes ?? 5));
      setGracePeriodMinutes(Number(data?.services?.monitoring?.gracePeriodMinutes ?? 30));
      setPostGraceVerificationMinutes(
        Number(data?.services?.monitoring?.postGraceVerificationMinutes ?? 5),
      );
    } catch (error: unknown) {
      console.error('Failed to fetch health status:', error);
      const message = error instanceof Error ? error.message : 'Could not connect to health check endpoint';
      toast({
        title: "Failed to Load Health Status",
        description: message,
        variant: "destructive",
      });
      setHealthStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealthStatus();
    const interval = setInterval(fetchHealthStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchHealthStatus]);

  if (user?.role === 'barangay_user') {
    return <Navigate to="/" replace />;
  }

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
    const postGraceVerify = Number.parseInt(String(postGraceVerificationMinutes), 10);
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
    if (!Number.isFinite(postGraceVerify) || postGraceVerify <= 0) {
      toast({
        title: 'Invalid post-grace verification',
        description: 'Post-grace verification must be a positive number of minutes.',
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
        postGraceVerificationMinutes: postGraceVerify,
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

  const handleSaveFormOptions = async () => {
    const purposeLabels = visitorPurposesDraft.map((p) => p.label.trim()).filter(Boolean);
    const uniquePurpose = new Set(purposeLabels.map((l) => l.toLowerCase()));
    if (uniquePurpose.size !== purposeLabels.length) {
      toast({
        title: 'Duplicate purpose labels',
        description: 'Each purpose of visit must have a distinct label.',
        variant: 'destructive',
      });
      return;
    }
    if (visitorPurposesDraft.length === 0) {
      toast({
        title: 'Purpose list required',
        description: 'Add at least one purpose of visit.',
        variant: 'destructive',
      });
      return;
    }
    if (!vehicleTypesDraft.some((v) => v.value.trim().toLowerCase() === 'other')) {
      toast({
        title: 'Vehicle types',
        description: 'Include exactly one type with value "other" (used for custom types).',
        variant: 'destructive',
      });
      return;
    }
    const streetLines = streetsDraft.map((s) => s.trim()).filter(Boolean);
    if (streetLines.length === 0) {
      toast({
        title: 'Streets required',
        description: 'Add at least one street for the resident registry.',
        variant: 'destructive',
      });
      return;
    }
    const visitLabel = residentVisitLabelDraft.trim();
    if (!visitLabel || !purposeLabels.includes(visitLabel)) {
      toast({
        title: 'Resident visit purpose',
        description: 'Choose a purpose label that exists in your list (typically a guest visit).',
        variant: 'destructive',
      });
      return;
    }

    setSavingFormOptions(true);
    try {
      await healthAPI.updateRuntimeConfig({
        vehicleTypeOptions: vehicleTypesDraft.map((v) => ({
          value: v.value.trim(),
          label: v.label.trim() || v.value.trim(),
        })),
        visitorPurposes: visitorPurposesDraft.map((p) => ({
          label: p.label.trim(),
          category: p.category,
        })),
        residentVisitPurposeLabel: visitLabel,
        rentedLocationOptions: rentedDraft.map((s) => s.trim()).filter(Boolean),
        residentStreets: streetLines,
      });
      toast({
        title: 'Form options saved',
        description: 'Dropdown lists are updated for vehicles, visitors, residents, and cameras.',
      });
      await reloadFormOpts();
    } catch (error: unknown) {
      toast({
        title: 'Failed to save form options',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSavingFormOptions(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <Header title="Settings" subtitle="Timers, SMS, and form dropdowns" />
        <div className="p-6 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!healthStatus) {
    return (
      <div className="min-h-screen">
        <Header title="Settings" subtitle="Timers, SMS, and form dropdowns" />
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
      <Header title="Settings" subtitle="Timers, SMS, and form dropdowns" />

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
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="post-grace-verification-minutes">
                  Post-grace verification (minutes)
                </Label>
                <Input
                  id="post-grace-verification-minutes"
                  type="number"
                  min={1}
                  value={postGraceVerificationMinutes}
                  onChange={(event) =>
                    setPostGraceVerificationMinutes(Math.max(1, Number(event.target.value || 1)))
                  }
                  disabled={savingRuntimeConfig}
                />
                <p className="text-xs text-muted-foreground">
                  After grace ends, wait this long for a new plate capture at this spot. If none appears,
                  the warning auto-clears (vehicle treated as gone). If the plate is seen again after grace,
                  the warning escalates as before.
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
                {' '}→ Post-grace verification ({postGraceVerificationMinutes}m)
              </span>
              <Button size="sm" onClick={handleSaveDemoTimers} disabled={savingRuntimeConfig || updatingSmsDelay}>
                {savingRuntimeConfig ? 'Saving…' : 'Save demo timers'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              On active warnings, the main countdown follows that order: SMS delay first (unless demo mode is on), then time
              until grace ends, then a final verification countdown. The first two are not stacked full-length timers; the
              verification window runs only after grace.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListOrdered className="h-5 w-5" />
              Form dropdowns
            </CardTitle>
            <CardDescription>
              Lists used when registering vehicles, visitors, residents, and camera street zones. The server validates
              resident streets on save.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="space-y-3">
              <Label className="text-base">Vehicle types</Label>
              <p className="text-xs text-muted-foreground">
                Stored value is lowercase (e.g. car, motorcycle). Keep one row with value <code className="text-xs">other</code>{' '}
                for free-text types.
              </p>
              <div className="space-y-2">
                {vehicleTypesDraft.map((row, i) => (
                  <div key={`vt-${i}`} className="flex flex-wrap gap-2 items-end">
                    <div className="grid grid-cols-2 gap-2 flex-1 min-w-[200px]">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Value</Label>
                        <Input
                          value={row.value}
                          onChange={(e) => {
                            const v = e.target.value;
                            setVehicleTypesDraft((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, value: v } : x)),
                            );
                          }}
                          className="bg-secondary font-mono text-sm"
                          disabled={savingFormOptions}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Label</Label>
                        <Input
                          value={row.label}
                          onChange={(e) => {
                            const v = e.target.value;
                            setVehicleTypesDraft((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, label: v } : x)),
                            );
                          }}
                          className="bg-secondary"
                          disabled={savingFormOptions}
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      disabled={savingFormOptions || vehicleTypesDraft.length <= 1}
                      onClick={() => setVehicleTypesDraft((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Remove vehicle type"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingFormOptions}
                  onClick={() =>
                    setVehicleTypesDraft((prev) => [...prev, { value: 'new_type', label: 'New type' }])
                  }
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add vehicle type
                </Button>
              </div>
            </div>

            <div className="space-y-3 border-t pt-6">
              <Label className="text-base">Purpose of visit</Label>
              <p className="text-xs text-muted-foreground">
                Category drives visitor tabs and API grouping: guest (visit / general), delivery, rental (needs facility).
              </p>
              <div className="space-y-2">
                {visitorPurposesDraft.map((row, i) => (
                  <div key={`vp-${i}`} className="flex flex-wrap gap-2 items-end">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1 min-w-[200px]">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Label</Label>
                        <Input
                          value={row.label}
                          onChange={(e) => {
                            const v = e.target.value;
                            setVisitorPurposesDraft((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, label: v } : x)),
                            );
                          }}
                          className="bg-secondary"
                          disabled={savingFormOptions}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Category</Label>
                        <Select
                          value={row.category}
                          onValueChange={(v: VisitorPurposeOption['category']) => {
                            setVisitorPurposesDraft((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, category: v } : x)),
                            );
                          }}
                          disabled={savingFormOptions}
                        >
                          <SelectTrigger className="bg-secondary">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="guest">guest</SelectItem>
                            <SelectItem value="delivery">delivery</SelectItem>
                            <SelectItem value="rental">rental</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      disabled={savingFormOptions || visitorPurposesDraft.length <= 1}
                      onClick={() => setVisitorPurposesDraft((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Remove purpose"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingFormOptions}
                  onClick={() =>
                    setVisitorPurposesDraft((prev) => [
                      ...prev,
                      { label: 'New purpose', category: 'guest' },
                    ])
                  }
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add purpose
                </Button>
              </div>

              <div className="space-y-2 pt-2">
                <Label htmlFor="resident-visit-purpose">Purpose that uses resident picker</Label>
                <p className="text-xs text-muted-foreground">
                  When this label is selected, the visitor form asks which resident is being visited (not a facility).
                </p>
                <Select
                  value={residentVisitLabelDraft}
                  onValueChange={setResidentVisitLabelDraft}
                  disabled={savingFormOptions}
                >
                  <SelectTrigger id="resident-visit-purpose" className="bg-secondary max-w-md">
                    <SelectValue placeholder="Select label" />
                  </SelectTrigger>
                  <SelectContent>
                    {visitorPurposesDraft.map((p) =>
                      p.label.trim() ? (
                        <SelectItem key={p.label} value={p.label.trim()}>
                          {p.label.trim()}
                        </SelectItem>
                      ) : null,
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3 border-t pt-6">
              <Label className="text-base">Rented / location (facilities)</Label>
              <p className="text-xs text-muted-foreground">Searchable list for rental and facility visits on the Visitors page.</p>
              <div className="space-y-2">
                {rentedDraft.map((line, i) => (
                  <div key={`r-${i}`} className="flex gap-2">
                    <Input
                      value={line}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRentedDraft((prev) => prev.map((x, j) => (j === i ? v : x)));
                      }}
                      className="bg-secondary"
                      disabled={savingFormOptions}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={savingFormOptions || rentedDraft.length <= 1}
                      onClick={() => setRentedDraft((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Remove facility"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingFormOptions}
                  onClick={() => setRentedDraft((prev) => [...prev, ''])}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add facility
                </Button>
              </div>
            </div>

            <div className="space-y-3 border-t pt-6">
              <Label className="text-base">Resident streets</Label>
              <p className="text-xs text-muted-foreground">
                Allowed street names for new residents and camera location zones. Must match exactly what you store in the
                database.
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {streetsDraft.map((line, i) => (
                  <div key={`s-${i}`} className="flex gap-2">
                    <Input
                      value={line}
                      onChange={(e) => {
                        const v = e.target.value;
                        setStreetsDraft((prev) => prev.map((x, j) => (j === i ? v : x)));
                      }}
                      className="bg-secondary"
                      disabled={savingFormOptions}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={savingFormOptions || streetsDraft.length <= 1}
                      onClick={() => setStreetsDraft((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Remove street"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={savingFormOptions}
                onClick={() => setStreetsDraft((prev) => [...prev, ''])}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add street
              </Button>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="button" onClick={() => void handleSaveFormOptions()} disabled={savingFormOptions}>
                {savingFormOptions ? 'Saving…' : 'Save form dropdowns'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
