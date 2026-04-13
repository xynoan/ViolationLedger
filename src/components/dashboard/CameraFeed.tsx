import { useState, useCallback, memo } from 'react';
import { Camera as CameraIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  DialogFooter,
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
import { camerasAPI } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

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
  const [editStreamOpen, setEditStreamOpen] = useState(false);
  const [detectionRtspDraft, setDetectionRtspDraft] = useState('');
  const [savingStreamUrl, setSavingStreamUrl] = useState(false);
  const isOnline = camera.status === 'online';

  const { stream, refresh: refreshStream } = useCameraStream({
    deviceId: camera.deviceId,
    isOnline,
  });
  const {
    detections,
    workerStatus,
  } = useYoloDetection(camera.id, isOnline);

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

  const openEditStream = useCallback(() => {
    setDetectionRtspDraft(camera.detectionRtspUrl?.trim() || '');
    setEditStreamOpen(true);
  }, [camera.detectionRtspUrl]);

  const saveDetectionRtsp = useCallback(async () => {
    const trimmed = detectionRtspDraft.trim();
    if (trimmed && !/^rtsp:\/\//i.test(trimmed)) {
      toast({
        title: 'Invalid URL',
        description: 'Detection RTSP URL must start with rtsp://',
        variant: 'destructive',
      });
      return;
    }
    setSavingStreamUrl(true);
    try {
      await camerasAPI.update(camera.id, {
        name: camera.name,
        locationId: camera.locationId,
        status: camera.status,
        deviceId: camera.deviceId ?? null,
        isFixed: camera.isFixed ?? true,
        illegalParkingZone: camera.illegalParkingZone ?? true,
        detectionRtspUrl: trimmed || null,
      });
      toast({ title: 'Saved', description: 'Detection stream URL updated.' });
      setEditStreamOpen(false);
      if (onRefresh) onRefresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to save';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setSavingStreamUrl(false);
    }
  }, [
    camera.deviceId,
    camera.id,
    camera.illegalParkingZone,
    camera.isFixed,
    camera.locationId,
    camera.name,
    camera.status,
    detectionRtspDraft,
    onRefresh,
  ]);

  return (
    <>
      <div className="glass-card rounded-xl overflow-hidden animate-slide-up">
        <CameraHeader
          camera={camera}
          isOnline={isOnline}
          onEditStream={canDelete ? openEditStream : undefined}
          onDelete={canDelete && onDelete ? () => setShowDeleteDialog(true) : undefined}
        />

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
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="status-indicator status-active" />
            <span className="font-mono">
              {workerStatus || (isOnline ? 'Connecting detection worker...' : 'Detection offline')}
            </span>
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

      <Dialog open={editStreamOpen} onOpenChange={setEditStreamOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Detection RTSP URL</DialogTitle>
            <DialogDescription>
              Optional full RTSP URL for server-side detection. Leave empty to use go2rtc (
              <code className="text-xs">GO2RTC_RTSP_BASE</code> + stream name).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor={`det-rtsp-${camera.id}`}>rtsp://…</Label>
            <Input
              id={`det-rtsp-${camera.id}`}
              placeholder="rtsp://user:pass@host:554/path"
              value={detectionRtspDraft}
              onChange={(e) => setDetectionRtspDraft(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditStreamOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveDetectionRtsp} disabled={savingStreamUrl}>
              {savingStreamUrl ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
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
