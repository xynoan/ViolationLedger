import { useState, useCallback, memo } from 'react';
import { Camera as CameraIcon, Maximize2, RefreshCw } from 'lucide-react';
import { Camera } from '@/types/parking';
import { cn } from '@/lib/utils';
import { useCameraStream } from '@/hooks/useCameraStream';
import { useYoloDetection } from '@/hooks/useDetectionStream';
import { VideoPlayer } from './VideoPlayer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getGo2rtcPreviewStreamSrc } from '@/lib/go2rtcConfig';

type Go2RtcStreamPanelProps = {
  className?: string;
  /** go2rtc stream name (`src` query); defaults from env / `cam1`. */
  streamSrc?: string;
  title?: string;
  /** When set, subscribe to server detection overlay for this camera id. */
  detectionCameraId?: string;
  registeredPlates?: string[];
  onRefresh?: () => void;
};

function buildStubCamera(streamSrc: string, title: string): Camera {
  return {
    id: 'go2rtc-live',
    name: title,
    locationId: 'go2rtc',
    status: 'online',
    lastCapture: new Date(),
    deviceId: streamSrc,
  };
}

export const Go2RtcStreamPanel = memo(function Go2RtcStreamPanel({
  className,
  streamSrc: streamSrcProp,
  title = 'Live',
  detectionCameraId,
  registeredPlates = [],
  onRefresh,
}: Go2RtcStreamPanelProps) {
  const streamSrc = (streamSrcProp ?? getGo2rtcPreviewStreamSrc()).trim();
  const camera = buildStubCamera(streamSrc, title);
  const [fullscreen, setFullscreen] = useState(false);

  const { stream, refresh: refreshStream } = useCameraStream({
    deviceId: streamSrc,
    isOnline: true,
  });
  const detectionOn = Boolean(detectionCameraId?.trim());
  const { detections, workerStatus } = useYoloDetection(
    detectionCameraId?.trim(),
    detectionOn,
  );

  const handleRefresh = useCallback(() => {
    refreshStream();
    onRefresh?.();
  }, [refreshStream, onRefresh]);

  return (
    <>
      <div className={cn('glass-card rounded-xl overflow-hidden', className)}>
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4">
          <div className="flex items-center gap-2 min-w-0">
            <CameraIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium truncate">{title}</span>
            <Badge variant="success" className="shrink-0 text-[10px] sm:text-xs">
              WebRTC
            </Badge>
          </div>
          <Button variant="ghost" size="sm" className="h-8 shrink-0" onClick={handleRefresh} type="button">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className={cn('relative bg-muted flex items-center justify-center overflow-hidden aspect-video')}>
          <VideoPlayer
            stream={stream}
            isOnline
            camera={camera}
            detections={detections}
            registeredPlates={registeredPlates}
            enablePlateRecognition={false}
          />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 sm:px-4">
          <span className="text-xs text-muted-foreground font-mono truncate">
            {detectionOn
              ? workerStatus || 'Connecting detection…'
              : `go2rtc • ${streamSrc}`}
          </span>
          <Button variant="ghost" size="sm" className="h-8 shrink-0" onClick={() => setFullscreen(true)} type="button">
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-w-4xl w-[95vw] bg-card border-border p-0">
          <DialogHeader className="p-4 border-b border-border">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              go2rtc • {streamSrc}
            </DialogDescription>
          </DialogHeader>
          <div className={cn('relative bg-muted flex items-center justify-center overflow-hidden aspect-video w-full')}>
            <VideoPlayer
              stream={stream}
              isOnline
              camera={camera}
              detections={detections}
              registeredPlates={registeredPlates}
              fullscreen
              enablePlateRecognition={false}
            />
          </div>
          <div className="flex justify-end p-3 border-t border-border">
            <Button variant="outline" size="sm" onClick={handleRefresh} type="button">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});
