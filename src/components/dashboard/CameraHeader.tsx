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
        <Badge variant={isOnline ? 'success' : 'destructive'}>
          <span
            className={cn(
              'status-indicator mr-1.5',
              isOnline ? 'status-active' : 'status-violation'
            )}
          />
          {isOnline ? 'Online' : 'Offline'}
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
