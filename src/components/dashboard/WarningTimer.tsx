import { useEffect, useState } from 'react';
import { Clock, AlertTriangle, Check, Camera, Ticket, ImageOff, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Violation } from '@/types/parking';
import { cn } from '@/lib/utils';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const SERVER_BASE_URL = API_BASE_URL.replace('/api', '');

const TWENTY_MIN = 20 * 60;
const TEN_MIN = 10 * 60;
const OUT_OF_VIEW_NOTE = 'not in the camera view anymore';

interface WarningTimerProps {
  violation: Violation;
  onCancel?: (id: string) => void;
  onIssueTicket?: (id: string) => void;
  /** Manual resend SMS to registered owner (same template as automatic warning SMS). */
  onSendSms?: (id: string) => void | Promise<void>;
  onAssignToMe?: (id: string) => void | Promise<void>;
  assigning?: boolean;
  currentUserId?: string | null;
}

/** Seconds until expiry; negative = overdue by that many seconds. */
function computeDeltaSec(warningExpiresAt: Date | undefined): number | null {
  if (!warningExpiresAt) return null;
  const now = Date.now();
  const expires = new Date(warningExpiresAt).getTime();
  return Math.floor((expires - now) / 1000);
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
}: WarningTimerProps) {
  const [deltaSec, setDeltaSec] = useState<number | null>(() => computeDeltaSec(violation.warningExpiresAt));
  const [sendingSms, setSendingSms] = useState(false);

  useEffect(() => {
    const tick = () => {
      setDeltaSec(computeDeltaSec(violation.warningExpiresAt));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [violation.warningExpiresAt]);

  const tier = tierFromDelta(deltaSec);
  const isOverdue = deltaSec !== null && deltaSec <= 0;
  const overdueSeconds = isOverdue && deltaSec !== null ? Math.abs(deltaSec) : 0;
  const messageText = String(violation.message || '');
  const isOutOfView = messageText.toLowerCase().includes(OUT_OF_VIEW_NOTE);
  const canIssueTicket = deltaSec !== null && deltaSec <= 0;

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
  const displayMessage = violation.message || (
    violation.plateNumber === 'BLUR'
      ? `Vehicle illegally parked at location ${violation.cameraLocationId}. License plate is visible but unclear or blurry - cannot be read. Immediate Barangay attention required.`
      : violation.plateNumber === 'NONE'
        ? `Vehicle illegally parked at location ${violation.cameraLocationId}. License plate is not visible or readable. Immediate Barangay attention required.`
        : `Vehicle with plate ${violation.plateNumber} detected illegally parked at ${violation.cameraLocationId}. Immediate action required.`
  );

  const smsSentAt = violation.smsSentAt;
  const smsScheduledAt = violation.ownerSmsScheduledAt;
  const canSendSms =
    Boolean(onSendSms) &&
    !violation.unregisteredUrgent &&
    violation.plateNumber !== 'NONE' &&
    violation.plateNumber !== 'BLUR' &&
    Boolean(violation.plateNumber);
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
        {/* Reserved 1:1 detection thumbnail */}
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
                  ) : (
                    <Badge variant="secondary" className="text-xs text-muted-foreground font-normal">
                      {smsScheduledAt ? `SMS scheduled · ${smsScheduledAt.toLocaleTimeString()}` : 'No text sent'}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-foreground">{displayMessage}</p>
                <p className="text-xs text-muted-foreground">
                  Detected at {new Date(violation.timeDetected).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end lg:ml-4 lg:min-w-[11rem]">
              <div className="flex items-center justify-end gap-2 text-muted-foreground">
                <Clock className="h-4 w-4 shrink-0" />
                {isOutOfView ? (
                  <div className="text-right">
                    <div className="font-mono text-lg font-bold text-muted-foreground">PAUSED</div>
                    <div className="text-[10px] text-muted-foreground">vehicle out of camera view</div>
                  </div>
                ) : isOverdue ? (
                  <div className="text-right">
                    <div className="font-mono text-lg font-bold text-red-600">OVERDUE</div>
                    <div className="font-mono text-sm font-semibold text-red-600 tabular-nums">
                      +{formatHms(overdueSeconds)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">since grace ended</div>
                  </div>
                ) : deltaSec !== null ? (
                  <span
                    className={cn(
                      'font-mono text-xl font-bold tabular-nums',
                      tier === 'urgent' && 'text-orange-500 animate-pulse',
                      tier === 'moderate' && 'text-amber-600',
                      tier === 'calm' && 'text-teal-700 dark:text-teal-300',
                      tier === 'unknown' && 'text-foreground',
                    )}
                  >
                    {formatHms(deltaSec)}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
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
