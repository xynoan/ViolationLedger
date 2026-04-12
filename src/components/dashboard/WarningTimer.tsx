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
  /** Denser layout for dashboard queue previews. */
  compact?: boolean;
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

export function WarningTimer({ violation, onCancel, onIssueTicket, onSendSms, compact }: WarningTimerProps) {
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
  const canSendSms =
    Boolean(onSendSms) &&
    !violation.unregisteredUrgent &&
    violation.plateNumber !== 'NONE' &&
    violation.plateNumber !== 'BLUR' &&
    Boolean(violation.plateNumber);

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
        'glass-card rounded-xl border border-border bg-card shadow-sm overflow-hidden animate-slide-up',
        'border-l-4',
        borderClass,
      )}
    >
      <div className="flex flex-col gap-0 sm:flex-row sm:items-stretch">
        {/* Reserved 1:1 detection thumbnail */}
        <div className={cn('w-full shrink-0', compact ? 'sm:w-24 md:w-28' : 'sm:w-36 md:w-40')}>
          <div className={cn('relative aspect-square w-full bg-muted', compact ? 'sm:min-h-[5.5rem]' : 'sm:min-h-[9rem]')}>
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

        <div className={cn('flex min-w-0 flex-1 flex-col gap-3', compact ? 'p-2 sm:p-2.5' : 'p-4')}>
          <div className={cn('flex flex-col lg:flex-row lg:items-start lg:justify-between', compact ? 'gap-2' : 'gap-3')}>
            <div className={cn('flex min-w-0 flex-1 items-start', compact ? 'gap-2' : 'gap-3')}>
              <div
                className={cn(
                  'rounded-lg shrink-0',
                  compact ? 'p-1.5' : 'p-2',
                  tier === 'overdue' && 'bg-red-500/10',
                  tier === 'urgent' && 'bg-orange-500/10',
                  tier === 'moderate' && 'bg-amber-500/10',
                  tier === 'calm' && 'bg-teal-500/10',
                  tier === 'unknown' && 'bg-muted',
                )}
              >
                <AlertTriangle
                  className={cn(
                    compact ? 'h-4 w-4' : 'h-5 w-5',
                    tier === 'overdue' && 'text-red-600',
                    tier === 'urgent' && 'text-orange-500',
                    tier === 'moderate' && 'text-amber-600',
                    tier === 'calm' && 'text-teal-600',
                    tier === 'unknown' && 'text-muted-foreground',
                  )}
                />
              </div>
              <div className={cn('min-w-0 flex-1', compact ? 'space-y-1' : 'space-y-2')}>
                <div className="flex flex-wrap items-center gap-1.5">
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
                      No text sent
                    </Badge>
                  )}
                </div>
                <p
                  className={cn(
                    'text-foreground',
                    compact ? 'text-xs line-clamp-2 leading-snug' : 'text-sm',
                  )}
                >
                  {displayMessage}
                </p>
                <p className={cn('text-muted-foreground', compact ? 'text-[10px]' : 'text-xs')}>
                  Detected at {new Date(violation.timeDetected).toLocaleString()}
                </p>
              </div>
            </div>

            <div
              className={cn(
                'flex shrink-0 flex-col items-stretch sm:items-end lg:ml-4',
                compact ? 'gap-1.5 lg:min-w-[8rem]' : 'gap-2 lg:min-w-[11rem]',
              )}
            >
              <div className={cn('flex items-center justify-end text-muted-foreground', compact ? 'gap-1' : 'gap-2')}>
                <Clock className={cn('shrink-0', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
                {isOutOfView ? (
                  <div className="text-right">
                    <div className="font-mono text-lg font-bold text-muted-foreground">PAUSED</div>
                    <div className="text-[10px] text-muted-foreground">vehicle out of camera view</div>
                  </div>
                ) : isOverdue ? (
                  <div className="text-right">
                    <div className={cn('font-mono font-bold text-red-600', compact ? 'text-sm' : 'text-lg')}>OVERDUE</div>
                    <div
                      className={cn(
                        'font-mono font-semibold text-red-600 tabular-nums',
                        compact ? 'text-xs' : 'text-sm',
                      )}
                    >
                      +{formatHms(overdueSeconds)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">since grace ended</div>
                  </div>
                ) : deltaSec !== null ? (
                  <span
                    className={cn(
                      'font-mono font-bold tabular-nums',
                      compact ? 'text-base' : 'text-xl',
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

          <div
            className={cn(
              'flex flex-wrap items-stretch justify-end gap-2 border-t border-border/60',
              compact ? 'pt-2' : 'pt-3',
            )}
          >
            <Button
              variant="destructive"
              size="sm"
              disabled={!canIssueTicket}
              onClick={() => onIssueTicket?.(violation.id)}
              className={cn(
                'disabled:opacity-40 disabled:pointer-events-none font-semibold shadow-sm',
                compact && 'h-9 min-h-[2.25rem] px-3 text-xs sm:text-sm order-first',
              )}
            >
              <Ticket className="h-4 w-4 mr-1 shrink-0" />
              Issue ticket
            </Button>
            {onSendSms && (
              <Button
                variant={compact ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'disabled:opacity-40 disabled:pointer-events-none',
                  compact
                    ? 'h-9 min-h-[2.25rem] border-0 bg-amber-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 sm:text-sm'
                    : '',
                )}
                disabled={!canSendSms || sendingSms}
                onClick={handleSendSmsClick}
                title={
                  canSendSms
                    ? 'Send SMS reminder to the registered owner'
                    : 'SMS requires a readable plate and registered vehicle'
                }
              >
                <MessageSquare className="h-4 w-4 mr-1 shrink-0" />
                {sendingSms ? 'Sending…' : 'Send SMS'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCancel?.(violation.id)}
              className={cn('text-muted-foreground hover:text-emerald-600', compact && 'h-9 px-2 text-xs')}
            >
              <Check className="h-4 w-4 mr-1 shrink-0" />
              Clear
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
