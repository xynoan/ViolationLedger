import { useEffect, useState } from 'react';
import { Clock, AlertTriangle, X, Check, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Violation } from '@/types/parking';
import { cn } from '@/lib/utils';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const SERVER_BASE_URL = API_BASE_URL.replace('/api', '');

interface WarningTimerProps {
  violation: Violation;
  onCancel?: (id: string) => void;
  onIssueTicket?: (id: string) => void;
}

export function WarningTimer({ violation, onCancel, onIssueTicket }: WarningTimerProps) {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (!violation.warningExpiresAt) return;

    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const expires = new Date(violation.warningExpiresAt!).getTime();
      return Math.max(0, Math.floor((expires - now) / 1000));
    };

    setTimeLeft(calculateTimeLeft());

    const interval = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(interval);
  }, [violation.warningExpiresAt]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isExpired = timeLeft === 0;
  const isUrgent = timeLeft > 0 && timeLeft <= 300; // 5 minutes

  // Get image source
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

  return (
    <div className={cn(
      "glass-card rounded-xl p-4 border-l-4 animate-slide-up",
      isExpired ? "border-l-destructive" : isUrgent ? "border-l-warning" : "border-l-primary"
    )}>
      <div className="flex flex-col gap-4">
        {/* Header with plate, location, and timer */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            <div className={cn(
              "rounded-lg p-2",
              isExpired ? "bg-destructive/10" : isUrgent ? "bg-warning/10" : "bg-primary/10"
            )}>
              <AlertTriangle className={cn(
                "h-5 w-5",
                isExpired ? "text-destructive" : isUrgent ? "text-warning" : "text-primary"
              )} />
            </div>
            <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {violation.plateNumber === 'NONE' ? (
                <span className="font-semibold text-foreground">Plate Not Visible</span>
              ) : violation.plateNumber === 'BLUR' ? (
                <span className="font-semibold text-foreground">Unclear or Blur Plate Number Detected</span>
              ) : (
                <span className="font-mono font-semibold text-foreground">{violation.plateNumber}</span>
              )}
                <Badge variant={isExpired ? "destructive" : isUrgent ? "warning" : "secondary"}>
                  <Camera className="h-3 w-3 mr-1" />
                  Location: {violation.cameraLocationId}
                </Badge>
                {violation.vehicleType && violation.vehicleType !== 'none' && (
                  <Badge variant="outline" className="text-xs">
                    {violation.vehicleType}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-foreground mb-2">{displayMessage}</p>
              <p className="text-xs text-muted-foreground">
                Detected at {new Date(violation.timeDetected).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="text-right flex-shrink-0 ml-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Clock className="h-4 w-4" />
              <span className={cn(
                "font-mono text-xl font-bold",
                isExpired ? "text-destructive" : isUrgent ? "text-warning animate-pulse" : "text-foreground"
              )}>
                {isExpired ? "EXPIRED" : formatTime(timeLeft)}
              </span>
            </div>
            <div className="flex gap-2 justify-end">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => onCancel?.(violation.id)}
                className="text-muted-foreground hover:text-success"
              >
                <Check className="h-4 w-4 mr-1" />
                Clear
              </Button>
              {isExpired && (
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={() => onIssueTicket?.(violation.id)}
                >
                  <X className="h-4 w-4 mr-1" />
                  Issue Ticket
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Captured Image */}
        {imageSrc && (
          <div className="mt-2 border border-border rounded-lg overflow-hidden">
            <img 
              src={imageSrc} 
              alt={`Illegal parking violation at ${violation.cameraLocationId}`}
              className="w-full h-auto max-h-64 object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
