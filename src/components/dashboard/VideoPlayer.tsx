import { useRef, useEffect, memo, useImperativeHandle, forwardRef } from 'react';
import { Camera as CameraIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Camera } from '@/types/parking';

interface Detection {
  bbox: number[];
  class_name: string;
  confidence: number;
}

interface VideoPlayerProps {
  stream: MediaStream | null;
  isOnline: boolean;
  camera: Camera;
  detections: Detection[];
  vehicleCount: number;
  fullscreen?: boolean;
}

export interface VideoPlayerHandle {
  captureFrame: () => Promise<string | null>;
}

export const VideoPlayer = memo(forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer({
  stream,
  isOnline,
  camera,
  detections,
  vehicleCount,
  fullscreen = false,
}, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Expose capture function via ref
  useImperativeHandle(ref, () => ({
    captureFrame: async () => {
      const videoElement = videoRef.current;
      
      // Wait for video to be ready (with timeout)
      if (!videoElement || !stream) {
        console.warn('⚠️  Cannot capture: video element or stream not available');
        return null;
      }

      // Wait for video to be ready (readyState 2 = HAVE_CURRENT_DATA, 4 = HAVE_ENOUGH_DATA)
      const maxWaitTime = 3000; // 3 seconds max wait
      const startTime = Date.now();
      
      while (videoElement.readyState < 2 && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (videoElement.readyState < 2) {
        console.warn(`⚠️  Video not ready after ${maxWaitTime}ms (readyState: ${videoElement.readyState})`);
        return null;
      }

      try {
        // Create canvas to capture frame
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth || 1920;
        canvas.height = videoElement.videoHeight || 1080;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          console.warn('⚠️  Cannot get canvas context');
          return null;
        }

        // Draw video frame to canvas
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        
        // Convert to base64
        const base64 = canvas.toDataURL('image/jpeg', 0.9);
        console.log(`✅ Frame captured: ${canvas.width}x${canvas.height}, size: ${Math.round(base64.length / 1024)}KB`);
        return base64;
      } catch (error) {
        console.error('❌ Error capturing frame:', error);
        return null;
      }
    },
  }), [stream]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    if (stream) {
      if (videoElement.srcObject !== stream) {
        videoElement.srcObject = stream;
        videoElement.play().catch((err) => {
          if (err.name !== 'AbortError' && err.name !== 'NotAllowedError' && err.name !== 'NotSupportedError') {
            console.error('Error playing video:', err);
          }
        });
      } else if (videoElement.paused && videoElement.isConnected) {
        videoElement.play().catch(() => {
          // Ignore autoplay errors
        });
      }
    } else {
      // Clean up when stream is removed
      if (videoElement.srcObject) {
        videoElement.srcObject = null;
      }
    }

    return () => {
      // Cleanup on unmount
      if (videoElement && videoElement.srcObject) {
        videoElement.srcObject = null;
      }
    };
  }, [stream]);

  const hasStream = stream !== null && camera.deviceId;

  if (!isOnline) {
    return (
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <CameraIcon className={cn('opacity-30', fullscreen ? 'h-20 w-20' : 'h-12 w-12')} />
        <span className={cn(fullscreen ? 'text-lg' : 'text-sm')}>Camera Offline</span>
      </div>
    );
  }

  // Always show video element when online, regardless of detections or vehicle count
  // This ensures the camera feed is always visible even when there are no illegal parks detected
  return (
    <>
      {/* Video element - always render when camera is online */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          "w-full h-full object-cover",
          !hasStream && "opacity-0" // Hide video visually when no stream, but keep element in DOM
        )}
      />
      
      {/* Placeholder overlay when stream is not yet available but camera is online */}
      {!hasStream && (
        <>
          <div className="absolute inset-0 bg-gradient-to-t from-foreground/10 to-transparent" />
          <div className="relative flex flex-col items-center gap-2 text-muted-foreground">
            <CameraIcon className={cn('opacity-30', fullscreen ? 'h-20 w-20' : 'h-12 w-12')} />
            <span className={cn(fullscreen ? 'text-lg' : 'text-sm')}>Connecting to camera...</span>
            <span className={cn('font-mono', fullscreen ? 'text-base' : 'text-xs')}>
              Last capture: {new Date(camera.lastCapture).toLocaleTimeString()}
            </span>
            {!camera.deviceId && (
              <span className={cn('text-xs text-muted-foreground/70', fullscreen ? 'text-sm' : 'text-xs')}>
                No camera device configured
              </span>
            )}
          </div>
        </>
      )}
      
      {/* Gradient overlay - always show when video is visible */}
      {hasStream && (
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/10 to-transparent pointer-events-none" />
      )}

      {/* Detection Overlays */}
      {detections.map((detection, idx) => {
        if (!detection.bbox || detection.bbox.length !== 4) return null;

        const [x1, y1, x2, y2] = detection.bbox;
        const videoElement = videoRef.current;
        if (!videoElement || !videoElement.clientWidth || !videoElement.clientHeight) return null;

        const videoWidth = videoElement.videoWidth || 1920;
        const videoHeight = videoElement.videoHeight || 1080;
        const displayWidth = videoElement.clientWidth;
        const displayHeight = videoElement.clientHeight;

        const videoAspect = videoWidth / videoHeight;
        const displayAspect = displayWidth / displayHeight;

        let scaleX: number, scaleY: number, offsetX = 0, offsetY = 0;

        if (videoAspect > displayAspect) {
          scaleX = displayWidth / videoWidth;
          scaleY = scaleX;
          offsetY = (displayHeight - videoHeight * scaleY) / 2;
        } else {
          scaleY = displayHeight / videoHeight;
          scaleX = scaleY;
          offsetX = (displayWidth - videoWidth * scaleX) / 2;
        }

        const left = x1 * scaleX + offsetX;
        const top = y1 * scaleY + offsetY;
        const width = (x2 - x1) * scaleX;
        const height = (y2 - y1) * scaleY;

        const colorClass =
          detection.class_name === 'car'
            ? 'border-blue-500 bg-blue-500/20'
            : detection.class_name === 'motorcycle'
              ? 'border-yellow-500 bg-yellow-500/20'
              : detection.class_name === 'truck'
                ? 'border-red-500 bg-red-500/20'
                : detection.class_name === 'bus'
                  ? 'border-green-500 bg-green-500/20'
                  : 'border-orange-500 bg-orange-500/20';

        return (
          <div
            key={idx}
            className={cn('absolute border-2 pointer-events-none', colorClass)}
            style={{
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`,
            }}
          >
            <div
              className={cn(
                'absolute -top-6 left-0 bg-black/80 text-white px-2 py-0.5 rounded whitespace-nowrap',
                fullscreen ? 'text-xs' : 'text-[10px]'
              )}
            >
              {detection.class_name} {(detection.confidence * 100).toFixed(0)}%
            </div>
          </div>
        );
      })}

      {/* Vehicle Count Badge */}
      {vehicleCount > 0 && (
        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
          <div className="flex items-center gap-2 bg-foreground/80 backdrop-blur-sm rounded-lg px-3 py-2">
            <span className="status-indicator status-warning" />
            <span className={cn('font-mono text-background', fullscreen ? 'text-sm' : 'text-xs')}>
              {vehicleCount} {vehicleCount === 1 ? 'vehicle' : 'vehicles'} detected
            </span>
          </div>
        </div>
      )}
    </>
  );
}));

