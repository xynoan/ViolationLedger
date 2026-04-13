import { useState, useCallback, memo } from 'react';
import { Camera as CameraIcon } from 'lucide-react';
import { Camera } from '@/types/parking';
import { cn } from '@/lib/utils';
import { useCameraStream } from '@/hooks/useCameraStream';
import { useYoloDetection } from '@/hooks/useDetectionStream';
import { VideoPlayer } from './VideoPlayer';
import { CameraHeader } from './CameraHeader';
import { CameraFooter } from './CameraFooter';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { getJurisdictionKindForLocationId } from '@/lib/blueRidgeGeofence';

interface CameraFeedProps {
  camera: Camera;
  registeredPlates?: string[];
  onRefresh?: () => void;
  onDelete?: (id: string) => void;
  canDelete?: boolean;
}

export const CameraFeed = memo(function CameraFeed({
  camera,
  registeredPlates = [],
  onRefresh,
  onDelete,
  canDelete = true,
}: CameraFeedProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const isOnline = camera.status === 'online';

  // Custom hooks: stream from go2rtc, detections from server-side RTSP worker
  const { stream, refresh: refreshStream } = useCameraStream({
    deviceId: camera.deviceId,
    isOnline,
  });
  const { detections, workerStatus, lastDetectionAt } = useYoloDetection(camera.id, isOnline);

  const lastMotionLabel = (() => {
    const capMs = new Date(camera.lastCapture).getTime();
    const ms =
      isOnline && lastDetectionAt != null
        ? Math.max(lastDetectionAt, Number.isFinite(capMs) ? capMs : lastDetectionAt)
        : Number.isFinite(capMs)
          ? capMs
          : lastDetectionAt;
    if (ms == null || !Number.isFinite(ms)) return 'Waiting for first frame…';
    const diff = Date.now() - ms;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 min ago';
    return `${mins} mins ago`;
  })();

  const handleRefresh = useCallback(() => {
    refreshStream();
    if (onRefresh) {
      onRefresh();
    }
  }, [refreshStream, onRefresh]);

  const handleDelete = useCallback(() => {
    if (onDelete) {
      onDelete(camera.id);
    }
    setShowDeleteDialog(false);
  }, [camera.id, onDelete]);

  const jurisdiction = getJurisdictionKindForLocationId(camera.locationId);

  return (
    <>
      <div className="glass-card rounded-xl overflow-hidden animate-slide-up">
        <CameraHeader
          camera={camera}
          isOnline={isOnline}
          onDelete={canDelete && onDelete ? () => setShowDeleteDialog(true) : undefined}
        />

        <div className="border-b border-border bg-muted/30 px-4 py-2">
          <p className="text-xs text-muted-foreground">
            Last motion detected:{' '}
            <span className="font-medium text-foreground">{lastMotionLabel}</span>
            <span className="text-muted-foreground/80">
              {isOnline ? ' · AI worker stream' : ' · last server capture'}
            </span>
          </p>
        </div>

        <div className={cn('relative bg-muted flex items-center justify-center overflow-hidden aspect-video')}>
          <VideoPlayer
            stream={stream}
            isOnline={isOnline}
            camera={camera}
            detections={detections}
            registeredPlates={registeredPlates}
            enablePlateRecognition={false}
          />
        </div>

        <div className="border-t border-border bg-muted/40 px-4 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="status-indicator status-active" />
            <span className="font-mono">
              {workerStatus || (isOnline ? 'Connecting detection worker...' : 'Detection offline')}
            </span>
            {jurisdiction === 'out' ? (
              <Badge variant="destructive" className="text-[10px] font-semibold">
                Out of Jurisdiction
              </Badge>
            ) : null}
          </div>
        </div>

        <CameraFooter
          isOnline={isOnline}
          lastCapture={camera.lastCapture}
          onRefresh={handleRefresh}
          onFullscreen={() => setIsFullscreen(true)}
        />
      </div>

      {/* Fullscreen Dialog */}
      <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
        <DialogContent className="max-w-4xl w-[95vw] bg-card border-border p-0">
          <DialogHeader className="p-4 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CameraIcon className="h-5 w-5 text-muted-foreground" />
                <div>
                  <DialogTitle>{camera.name}</DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    {camera.locationId} - {isOnline ? 'Online' : 'Offline'}
                  </DialogDescription>
                </div>
              </div>
              <Badge variant={isOnline ? 'success' : 'destructive'}>
                <span
                  className={cn(
                    'status-indicator mr-1.5',
                    isOnline ? 'status-active' : 'status-violation'
                  )}
                />
                {isOnline ? 'Online' : 'Offline'}
              </Badge>
            </div>
          </DialogHeader>
          <div className={cn('relative bg-muted flex items-center justify-center overflow-hidden aspect-video w-full')}>
            <VideoPlayer
              stream={stream}
              isOnline={isOnline}
              camera={camera}
              detections={detections}
              registeredPlates={registeredPlates}
              fullscreen
              enablePlateRecognition={false}
            />
          </div>
          <div className="flex items-center justify-between p-4 border-t border-border">
            <span className="text-sm text-muted-foreground">
              Last capture: {new Date(camera.lastCapture).toLocaleString()}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Camera</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{camera.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
