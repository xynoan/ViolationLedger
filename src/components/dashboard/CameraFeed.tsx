import { useState, useCallback, memo, useRef } from 'react';
import { Camera as CameraIcon } from 'lucide-react';
import { Camera } from '@/types/parking';
import { cn } from '@/lib/utils';
import { capturesAPI } from '@/lib/api';
import { useCameraStream } from '@/hooks/useCameraStream';
import { useCaptureTimer } from '@/hooks/useCaptureTimer';
import { useDetections } from '@/hooks/useDetections';
import { VideoPlayer, VideoPlayerHandle } from './VideoPlayer';
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

interface CameraFeedProps {
  camera: Camera;
  onRefresh?: () => void;
  onDelete?: (id: string) => void;
  canDelete?: boolean;
}

export const CameraFeed = memo(function CameraFeed({
  camera,
  onRefresh,
  onDelete,
  canDelete = true,
}: CameraFeedProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const isOnline = camera.status === 'online';
  const videoPlayerRef = useRef<VideoPlayerHandle>(null);
  const fullscreenVideoPlayerRef = useRef<VideoPlayerHandle>(null);

  // Custom hooks for complex logic
  const { stream, refresh: refreshStream } = useCameraStream({
    deviceId: camera.deviceId,
    isOnline,
  });

  const { detections, vehicleCount } = useDetections({
    cameraId: camera.id,
    isOnline,
  });

  const handleCapture = useCallback(async () => {
    try {
      // Try to capture frame from video element
      const videoPlayer = isFullscreen ? fullscreenVideoPlayerRef.current : videoPlayerRef.current;
      let imageData: string | null = null;

      if (videoPlayer) {
        imageData = await videoPlayer.captureFrame();
      }

      // Send capture request with image data and wait for AI processing to complete
      console.log('📸 Sending capture request and waiting for AI processing...');
      const response = await capturesAPI.trigger(camera.id, imageData || undefined);
      
      // Wait for AI processing to complete before showing results
      if (response && response.aiProcessingComplete !== false) {
        console.log('✅ AI processing complete, refreshing results...');
        // Small delay to ensure database writes are complete
        await new Promise(resolve => setTimeout(resolve, 500));
        if (onRefresh) {
          onRefresh();
        }
      } else {
        // If AI processing not complete, wait a bit longer
        console.log('⏳ Waiting for AI processing to complete...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        if (onRefresh) {
          onRefresh();
        }
      }
    } catch (error) {
      console.error('Error capturing image:', error);
      // Still try to trigger capture without image
      try {
        await capturesAPI.trigger(camera.id);
        // Wait for processing even on error
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (onRefresh) {
          onRefresh();
        }
      } catch (retryError) {
        console.error('Error on retry capture:', retryError);
      }
    }
  }, [camera.id, onRefresh, isFullscreen]);

  const { captureStatus, nextCaptureTime, resetTimer } = useCaptureTimer({
    cameraId: camera.id,
    isOnline,
    lastCapture: camera.lastCapture,
    onCapture: handleCapture,
  });

  const handleRefresh = useCallback(() => {
    refreshStream();
    resetTimer();
    if (onRefresh) {
      onRefresh();
    }
  }, [refreshStream, resetTimer, onRefresh]);

  const handleDelete = useCallback(() => {
    if (onDelete) {
      onDelete(camera.id);
    }
    setShowDeleteDialog(false);
  }, [camera.id, onDelete]);

  return (
    <>
      <div className="glass-card rounded-xl overflow-hidden animate-slide-up">
        <CameraHeader
          camera={camera}
          isOnline={isOnline}
          onDelete={canDelete && onDelete ? () => setShowDeleteDialog(true) : undefined}
        />

        <div className={cn('relative bg-muted flex items-center justify-center overflow-hidden aspect-video')}>
          <VideoPlayer
            ref={videoPlayerRef}
            stream={stream}
            isOnline={isOnline}
            camera={camera}
            detections={detections}
            vehicleCount={vehicleCount}
          />
        </div>

        <CameraFooter
          isOnline={isOnline}
          captureStatus={captureStatus}
          nextCaptureTime={nextCaptureTime}
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
              ref={fullscreenVideoPlayerRef}
              stream={stream}
              isOnline={isOnline}
              camera={camera}
              detections={detections}
              vehicleCount={vehicleCount}
              fullscreen
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
