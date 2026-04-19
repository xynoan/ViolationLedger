import { useEffect, useState, useRef } from 'react';
import { Clock, AlertTriangle, Check, Camera, Ticket, ImageOff, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Violation } from '@/types/parking';
import { cn } from '@/lib/utils';
import { healthAPI } from '@/lib/api';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const SERVER_BASE_URL = API_BASE_URL.replace('/api', '');

const TWENTY_MIN = 20 * 60;
const TEN_MIN = 10 * 60;
const OUT_OF_VIEW_MESSAGE_PATTERN = /\s*Vehicle is not in the camera view anymore\.?/gi;

interface WarningTimerProps {
  violation: Violation;
  onCancel?: (id: string) => void;
  onIssueTicket?: (id: string) => void;
  /** Manual resend SMS to registered owner (same template as automatic warning SMS). */
  onSendSms?: (id: string) => void | Promise<void>;
  onAssignToMe?: (id: string) => void | Promise<void>;
  assigning?: boolean;
  currentUserId?: string | null;
  showThumbnail?: boolean;
  /** full: scheduled time / demo / no-text badges; sentOnly: green "Text sent" badge only. */
  smsStatusBadge?: 'full' | 'sentOnly';
  /** full: owner SMS countdown + line; graceOnly: grace timer only (Warnings page). */
  ownerSmsUi?: 'full' | 'graceOnly';
}

/** Seconds until a wall-clock instant. */
function computeDeltaSecUntil(targetMs: number): number {
  return Math.floor((targetMs - Date.now()) / 1000);
}

/**
 * Sequential model (matches Settings): grace ends after the owner SMS window —
 * SMS scheduled time + grace period, or detection + grace when SMS is immediate (demo).
 */
function computeSequentialGraceEndMs(
  violation: Violation,
  gracePeriodMinutes: number,
  ownerSmsDelayMinutes: number,
  ownerSmsDelayDisabledForDemo: boolean,
): number {
  const detectedMs = new Date(violation.timeDetected).getTime();
  const scheduledSmsMs = violation.ownerSmsScheduledAt
    ? new Date(violation.ownerSmsScheduledAt).getTime()
    : null;

  if (ownerSmsDelayDisabledForDemo) {
    return detectedMs + gracePeriodMinutes * 60 * 1000;
  }
  if (scheduledSmsMs != null) {
    return scheduledSmsMs + gracePeriodMinutes * 60 * 1000;
  }
  return detectedMs + ownerSmsDelayMinutes * 60 * 1000 + gracePeriodMinutes * 60 * 1000;
}

function formatHms(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function tierFromDelta(deltaSec: number | null): 'overdue' | 'urgent' | 'moderate' | 'calm' | 'unknown' {
  if (deltaSec === null) return 'unknown';
  if (deltaSec <= 0) return 'overdue';
  if (deltaSec <= TEN_MIN) return 'urgent';
  if (deltaSec <= TWENTY_MIN) return 'moderate';
  return 'calm';
}

export function WarningTimer({
  violation,
  onCancel,
  onIssueTicket,
  onSendSms,
  onAssignToMe,
  assigning = false,
  currentUserId = null,
  showThumbnail = true,
  smsStatusBadge = 'full',
  ownerSmsUi = 'full',
}: WarningTimerProps) {
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState(30);
  const [ownerSmsDelayMinutes, setOwnerSmsDelayMinutes] = useState(5);
  const [postGraceVerificationMinutes, setPostGraceVerificationMinutes] = useState(5);
  const [graceDeltaSec, setGraceDeltaSec] = useState<number | null>(null);
  const [verificationDeltaSec, setVerificationDeltaSec] = useState<number | null>(null);
  const [sendingSms, setSendingSms] = useState(false);
  const [ownerSmsDelayDisabledForDemo, setOwnerSmsDelayDisabledForDemo] = useState(false);
  const [autoClearFailed, setAutoClearFailed] = useState(false);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const autoClearInvokedRef = useRef(false);

  useEffect(() => {
    autoClearInvokedRef.current = false;
    setAutoClearFailed(false);
  }, [violation.id]);

  /** After grace + verification window (client clock), call clear (same as Clear button) instead of waiting on monitoring poll. */
  useEffect(() => {
    if (autoClearInvokedRef.current) return;
    if (violation.status !== 'warning') return;
    const clear = onCancelRef.current;
    if (!clear) return;
    if (graceDeltaSec === null || verificationDeltaSec === null) return;
    if (graceDeltaSec > 0 || verificationDeltaSec > 0) return;

    autoClearInvokedRef.current = true;
    void Promise.resolve(clear(violation.id)).catch(() => {
      autoClearInvokedRef.current = false;
      setAutoClearFailed(true);
    });
  }, [violation.id, violation.status, graceDeltaSec, verificationDeltaSec]);

  useEffect(() => {
    const tick = () => {
      const graceEndMs = computeSequentialGraceEndMs(
        violation,
        gracePeriodMinutes,
        ownerSmsDelayMinutes,
        ownerSmsDelayDisabledForDemo,
      );
      const verificationEndMs = graceEndMs + postGraceVerificationMinutes * 60 * 1000;
      setGraceDeltaSec(computeDeltaSecUntil(graceEndMs));
      setVerificationDeltaSec(computeDeltaSecUntil(verificationEndMs));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [
    violation.timeDetected,
    violation.ownerSmsScheduledAt,
    gracePeriodMinutes,
    ownerSmsDelayMinutes,
    postGraceVerificationMinutes,
    ownerSmsDelayDisabledForDemo,
  ]);

  useEffect(() => {
    if (ownerSmsUi === 'graceOnly' && smsStatusBadge === 'sentOnly') return;
    let mounted = true;
    healthAPI
      .getOwnerSmsDelayConfig()
      .then((config) => {
        if (!mounted) return;
        setOwnerSmsDelayDisabledForDemo(Boolean(config?.disabledForDemo));
      })
      .catch(() => {
        if (!mounted) return;
        setOwnerSmsDelayDisabledForDemo(false);
      });
    return () => {
      mounted = false;
    };
  }, [ownerSmsUi, smsStatusBadge]);

  useEffect(() => {
    let mounted = true;
    healthAPI
      .getRuntimeConfig()
      .then((config) => {
        if (!mounted) return;
        const pg = Number(config?.postGraceVerificationMinutes ?? 5);
        const g = Number(config?.gracePeriodMinutes ?? 30);
        const sms = Number(config?.ownerSmsDelayMinutes ?? 5);
        setPostGraceVerificationMinutes(Number.isFinite(pg) && pg > 0 ? pg : 5);
        setGracePeriodMinutes(Number.isFinite(g) && g > 0 ? g : 30);
        setOwnerSmsDelayMinutes(Number.isFinite(sms) && sms > 0 ? sms : 5);
      })
      .catch(() => {
        if (!mounted) return;
        setPostGraceVerificationMinutes(5);
        setGracePeriodMinutes(30);
        setOwnerSmsDelayMinutes(5);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const isInPostGraceVerificationWindow =
    graceDeltaSec !== null &&
    graceDeltaSec <= 0 &&
    verificationDeltaSec !== null &&
    verificationDeltaSec > 0;
  const tier = isInPostGraceVerificationWindow ? 'urgent' : tierFromDelta(graceDeltaSec);
  const isOverdue = graceDeltaSec !== null && graceDeltaSec <= 0;
  const overdueSeconds = isOverdue && graceDeltaSec !== null ? Math.abs(graceDeltaSec) : 0;
  const canIssueTicket = graceDeltaSec !== null && graceDeltaSec <= 0;

  const borderClass = {
    overdue: 'border-l-red-600',
    urgent: 'border-l-orange-500',
    moderate: 'border-l-amber-500',
    calm: 'border-l-teal-500',
    unknown: 'border-l-slate-500',
  }[tier];

  const getImageSrc = (): string | null => {
    if (violation.imageBase64) {
      if (violation.imageBase64.startsWith('data:')) {
        return violation.imageBase64;
      }
      return `data:image/jpeg;base64,${violation.imageBase64}`;
    }
    if (violation.imageUrl) {
      return `${SERVER_BASE_URL}/captured_images/${violation.imageUrl.split(/[/\\]/).pop()}`;
    }
    return null;
  };

  const imageSrc = getImageSrc();
  const rawDisplayMessage = violation.message || (
    violation.plateNumber === 'BLUR'
      ? `Vehicle illegally parked at location ${violation.cameraLocationId}. License plate is visible but unclear or blurry - cannot be read. Immediate Barangay attention required.`
      : violation.plateNumber === 'NONE'
        ? `Vehicle illegally parked at location ${violation.cameraLocationId}. License plate is not visible or readable. Immediate Barangay attention required.`
        : `Vehicle with plate ${violation.plateNumber} detected illegally parked at ${violation.cameraLocationId}. Immediate action required.`
  );
  const displayMessage = rawDisplayMessage.replace(OUT_OF_VIEW_MESSAGE_PATTERN, '').trim();

  const smsSentAt = violation.smsSentAt;
  const smsScheduledAt = violation.ownerSmsScheduledAt;
  const ownerSmsCountdownSec = smsScheduledAt ? computeDeltaSecUntil(new Date(smsScheduledAt).getTime()) : null;
  const canSendSms =
    Boolean(onSendSms) &&
    !violation.unregisteredUrgent &&
    violation.plateNumber !== 'NONE' &&
    violation.plateNumber !== 'BLUR' &&
    Boolean(violation.plateNumber);
  const showOwnerSmsPrimaryTimer =
    ownerSmsUi !== 'graceOnly' &&
    !smsSentAt &&
    canSendSms &&
    !ownerSmsDelayDisabledForDemo &&
    ownerSmsCountdownSec !== null &&
    ownerSmsCountdownSec > 0;
  const isAssigned = Boolean(violation.assignedToUserId);
  const assignedToCurrentUser = isAssigned && violation.assignedToUserId === currentUserId;

  const handleSendSmsClick = async () => {
    if (!onSendSms || !canSendSms || sendingSms) return;
    setSendingSms(true);
    try {
      await onSendSms(violation.id);
    } finally {
      setSendingSms(false);
    }
  };

  return (
    <div
      className={cn(
        'glass-card rounded-xl border border-border overflow-hidden animate-slide-up',
        'border-l-4',
        borderClass,
      )}
    >
      <div className="flex flex-col gap-0 sm:flex-row sm:items-stretch">
        {showThumbnail && (
          <div className="w-full shrink-0 sm:w-36 md:w-40">
            <div className="relative aspect-square w-full bg-muted sm:min-h-[9rem]">
              {imageSrc ? (
                <img
                  src={imageSrc}
                  alt={`Detection at ${violation.cameraLocationId}`}
                  className="absolute inset-0 h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground p-2">
                  <ImageOff className="h-8 w-8 opacity-50" aria-hidden />
                  <span className="text-[10px] uppercase tracking-wide text-center">No thumbnail</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div
                className={cn(
                  'rounded-lg p-2 shrink-0',
                  tier === 'overdue' && 'bg-red-500/10',
                  tier === 'urgent' && 'bg-orange-500/10',
                  tier === 'moderate' && 'bg-amber-500/10',
                  tier === 'calm' && 'bg-teal-500/10',
                  tier === 'unknown' && 'bg-muted',
                )}
              >
                <AlertTriangle
                  className={cn(
                    'h-5 w-5',
                    tier === 'overdue' && 'text-red-600',
                    tier === 'urgent' && 'text-orange-500',
                    tier === 'moderate' && 'text-amber-600',
                    tier === 'calm' && 'text-teal-600',
                    tier === 'unknown' && 'text-muted-foreground',
                  )}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {violation.plateNumber === 'NONE' ? (
                    <span className="font-semibold text-foreground">Plate Not Visible</span>
                  ) : violation.plateNumber === 'BLUR' ? (
                    <span className="font-semibold text-foreground">Unclear or Blur Plate Number Detected</span>
                  ) : (
                    <span className="font-mono font-semibold text-foreground">{violation.plateNumber}</span>
                  )}
                  <Badge variant="secondary" className="text-xs">
                    <Camera className="h-3 w-3 mr-1" />
                    {violation.cameraLocationId}
                  </Badge>
                  {violation.vehicleType && violation.vehicleType !== 'none' && (
                    <Badge variant="outline" className="text-xs">
                      {violation.vehicleType}
                    </Badge>
                  )}
                  {violation.unregisteredUrgent && (
                    <Badge className="text-xs bg-red-600 text-white border-red-700">
                      URGENT · UNREGISTERED
                    </Badge>
                  )}
                  {smsSentAt ? (
                    <Badge
                      variant="outline"
                      className="border-green-600/40 bg-green-500/10 text-green-800 dark:text-green-300 text-xs"
                    >
                      Text sent · {smsSentAt.toLocaleString()}
                    </Badge>
                  ) : smsStatusBadge === 'full' ? (
                    ownerSmsDelayDisabledForDemo ? (
                      <Badge
                        variant="secondary"
                        className="text-xs border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-300"
                      >
                        SMS immediate · demo mode
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs text-muted-foreground font-normal">
                        {smsScheduledAt ? `SMS scheduled · ${smsScheduledAt.toLocaleTimeString()}` : 'No text sent'}
                      </Badge>
                    )
                  ) : null}
                </div>
                <p className="text-sm text-foreground">{displayMessage}</p>
                <p className="text-xs text-muted-foreground">
                  Detected at {new Date(violation.timeDetected).toLocaleString()}
                </p>
                {violation.lastPlateDetectionAt && (
                  <p className="text-xs text-muted-foreground">
                    Most recent plate capture at {violation.lastPlateDetectionAt.toLocaleString()}
                  </p>
                )}
                {ownerSmsUi !== 'graceOnly' && !smsSentAt && canSendSms && (
                  <p className="text-xs text-muted-foreground">
                    Owner SMS timer:{' '}
                    {ownerSmsDelayDisabledForDemo
                      ? 'Immediate (demo mode)'
                      : ownerSmsCountdownSec !== null
                        ? ownerSmsCountdownSec <= 0
                          ? 'Due now'
                          : formatHms(ownerSmsCountdownSec)
                        : 'Not scheduled'}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end lg:ml-4 lg:min-w-[11rem]">
              <div className="flex items-center justify-end gap-2 text-muted-foreground">
                <Clock className="h-4 w-4 shrink-0" />
                {showOwnerSmsPrimaryTimer ? (
                  <div className="text-right">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Owner SMS in</div>
                    <div className="font-mono text-xl font-bold tabular-nums text-blue-600">
                      {formatHms(ownerSmsCountdownSec)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">before grace timer</div>
                  </div>
                ) : (
                  <>
                    {isInPostGraceVerificationWindow && verificationDeltaSec !== null ? (
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          Final verification
                        </div>
                        <div className="font-mono text-xl font-bold tabular-nums text-orange-500">
                          {formatHms(verificationDeltaSec)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          then auto-clear if plate not seen again
                        </div>
                      </div>
                    ) : isOverdue ? (
                      <div className="text-right">
                        {verificationDeltaSec !== null && verificationDeltaSec <= 0 ? (
                          autoClearFailed ? (
                            <p className="text-xs text-destructive text-right max-w-[12rem] ml-auto leading-snug">
                              Could not clear automatically. Use Clear below.
                            </p>
                          ) : onCancel ? (
                            <div className="text-sm font-medium text-muted-foreground tabular-nums">
                              Clearing…
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )
                        ) : (
                          <>
                            <div className="font-mono text-lg font-bold text-red-600">OVERDUE</div>
                            <div className="font-mono text-sm font-semibold text-red-600 tabular-nums">
                              +{formatHms(overdueSeconds)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">since grace ended</div>
                          </>
                        )}
                      </div>
                    ) : graceDeltaSec !== null ? (
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Grace ends in</div>
                        <span
                          className={cn(
                            'font-mono text-xl font-bold tabular-nums',
                            tier === 'urgent' && 'text-orange-500 animate-pulse',
                            tier === 'moderate' && 'text-amber-600',
                            tier === 'calm' && 'text-teal-700 dark:text-teal-300',
                            tier === 'unknown' && 'text-foreground',
                          )}
                        >
                          {formatHms(graceDeltaSec)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
            {onSendSms && (
              <Button
                variant="outline"
                size="sm"
                disabled={!canSendSms || sendingSms}
                onClick={handleSendSmsClick}
                className="disabled:opacity-40 disabled:pointer-events-none"
                title={
                  canSendSms
                    ? 'Send SMS reminder to the registered owner'
                    : 'SMS requires a readable plate and registered vehicle'
                }
              >
                <MessageSquare className="h-4 w-4 mr-1" />
                {sendingSms ? 'Sending…' : 'Send SMS'}
              </Button>
            )}
            {onAssignToMe && (
              <Button
                variant="outline"
                size="sm"
                disabled={assigning || (isAssigned && !assignedToCurrentUser)}
                onClick={() => onAssignToMe(violation.id)}
                className="disabled:opacity-40 disabled:pointer-events-none"
              >
                {assignedToCurrentUser ? 'Assigned to me' : isAssigned ? `Handled by ${violation.assignedToName || 'another user'}` : 'Assign to me'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCancel?.(violation.id)}
              className="text-muted-foreground hover:text-emerald-600"
            >
              <Check className="h-4 w-4 mr-1" />
              Clear
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!canIssueTicket}
              onClick={() => onIssueTicket?.(violation.id)}
              className="disabled:opacity-40 disabled:pointer-events-none"
            >
              <Ticket className="h-4 w-4 mr-1" />
              Issue Ticket
            </Button>
          </div>
          {isAssigned && (
            <p className="text-xs text-muted-foreground w-full text-right">
              Being handled by <span className="font-medium">{violation.assignedToName || 'Unknown user'}</span>
              {violation.assignedAt ? ` since ${new Date(violation.assignedAt).toLocaleString()}` : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
