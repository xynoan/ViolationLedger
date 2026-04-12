import { memo } from 'react';
import { Camera as CameraIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera } from '@/types/parking';
import { cn } from '@/lib/utils';

interface CameraHeaderProps {
  camera: Camera;
  isOnline: boolean;
  onDelete?: () => void;
}

const CameraHeaderComponent = function CameraHeader({
  camera,
  isOnline,
  onDelete,
}: CameraHeaderProps) {
  return (
    <div className="flex items-center justify-between p-4 border-b border-border">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <CameraIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-foreground truncate">{camera.name}</h3>
          <p className="text-xs text-muted-foreground">Zone: {camera.locationId}</p>
          {camera.deviceId && (
            <p className="text-xs text-muted-foreground font-mono truncate" title={camera.deviceId}>
              Device ID: {camera.deviceId.substring(0, 20)}...
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Badge variant={isOnline ? 'success' : 'destructive'} className={cn(isOnline && 'gap-2 pl-2')}>
          {isOnline ? (
            <>
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400" />
              </span>
              <span className="animate-pulse font-semibold tracking-tight text-emerald-950 dark:text-emerald-50">Live</span>
              <span className="text-emerald-800/35 dark:text-emerald-100/35" aria-hidden>
                |
              </span>
              <span>Online</span>
            </>
          ) : (
            <>
              <span className={cn('status-indicator mr-1.5', 'status-violation')} />
              Offline
            </>
          )}
        </Badge>
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
};

export const CameraHeader = memo(CameraHeaderComponent);
