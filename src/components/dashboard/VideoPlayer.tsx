import { useRef, useEffect, memo, useImperativeHandle, forwardRef } from 'react';
import { Camera as CameraIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Camera } from '@/types/parking';
import { usePlateRecognition } from '@/hooks/usePlateRecognition';

export interface Detection {
  bbox: number[];
  class_name: string;
  confidence: number;
  plateNumber?: string;
}

interface VideoPlayerProps {
  stream: MediaStream | null;
  isOnline: boolean;
  camera: Camera;
  detections: Detection[];
  registeredPlates?: string[];
  fullscreen?: boolean;
  enablePlateRecognition?: boolean;
  onPlateMetaChange?: (meta: {
    enabled: boolean;
    isRunning: boolean;
    plateCount: number;
    lastScanAt: number | null;
    lastError: string | null;
  }) => void;
}

export interface VideoPlayerHandle {
  captureFrame: () => Promise<string | null>;
}

export const VideoPlayer = memo(forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer({
  stream,
  isOnline,
  camera,
  detections: apiDetections,
  registeredPlates = [],
  fullscreen = false,
  enablePlateRecognition = false,
  onPlateMetaChange,
}, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const deviceSource = String(camera.deviceId || '').trim();
  const isHttpsPage = window.location.protocol === 'https:';
  const directMjpegUrl = isHttpsPage
    ? (/^https:\/\//i.test(deviceSource) ? deviceSource : null)
    : (/^https?:\/\//i.test(deviceSource) ? deviceSource : null);
  const hasStream = stream !== null && camera.deviceId;
  const showDirectMjpegFallback = !hasStream && !!directMjpegUrl;
  const {
    detections: plateDetections,
    plateCount,
    isRunning: plateIsRunning,
    lastScanAt: plateLastScanAt,
    lastError: plateLastError,
  } = usePlateRecognition(
    videoRef,
    enablePlateRecognition && !!hasStream
  );
  useEffect(() => {
    if (!onPlateMetaChange) return;
    onPlateMetaChange({
      enabled: enablePlateRecognition && !!hasStream,
      isRunning: plateIsRunning,
      plateCount,
      lastScanAt: plateLastScanAt,
      lastError: plateLastError,
    });
  }, [
    onPlateMetaChange,
    enablePlateRecognition,
    hasStream,
    plateIsRunning,
    plateCount,
    plateLastScanAt,
    plateLastError,
  ]);
  const detections = enablePlateRecognition
    ? plateDetections
    : apiDetections;
  const registeredPlateSet = new Set(
    registeredPlates
      .map((plate) => String(plate || '').replace(/\s+/g, '').toUpperCase())
      .filter(Boolean)
  );

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
          "absolute inset-0 w-full h-full object-cover",
          !hasStream && "opacity-0" // Hide video visually when no stream, but keep element in DOM
        )}
      />

      {showDirectMjpegFallback && (
        <img
          src={directMjpegUrl as string}
          alt={`${camera.name} live stream`}
          className="absolute inset-0 z-5 w-full h-full object-cover"
          loading="eager"
        />
      )}
      
      {/* Placeholder overlay when stream is not yet available but camera is online */}
      {!hasStream && !showDirectMjpegFallback && (
        <>
          <div className="absolute inset-0 z-10 bg-gradient-to-t from-foreground/10 to-transparent" />
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 text-muted-foreground">
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
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-foreground/10 to-transparent pointer-events-none" />
      )}

      {/* Detection Overlays */}
      <div className="absolute inset-0 z-20 pointer-events-none">
        {detections.map((detection, idx) => {
          if (!detection.bbox || detection.bbox.length !== 4) return null;

          const [x1, y1, x2, y2] = detection.bbox;
          const videoElement = videoRef.current;
          const displayWidth =
            videoElement?.clientWidth ||
            videoElement?.parentElement?.clientWidth ||
            0;
          const displayHeight =
            videoElement?.clientHeight ||
            videoElement?.parentElement?.clientHeight ||
            0;

          if (!videoElement || !displayWidth || !displayHeight) return null;

          const videoWidth = videoElement.videoWidth || 1920;
          const videoHeight = videoElement.videoHeight || 1080;

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
            detection.class_name === 'plate'
              ? 'border-violet-400 bg-violet-400/20'
              : detection.class_name === 'face'
                ? 'border-cyan-400 bg-cyan-400/20'
                : detection.class_name === 'car'
                  ? 'border-blue-500 bg-blue-500/20'
                  : detection.class_name === 'motorcycle'
                    ? 'border-yellow-500 bg-yellow-500/20'
                    : detection.class_name === 'truck'
                      ? 'border-red-500 bg-red-500/20'
                      : detection.class_name === 'bus'
                        ? 'border-green-500 bg-green-500/20'
                        : 'border-orange-500 bg-orange-500/20';
          const plateLabel = (detection as { plateNumber?: unknown }).plateNumber;
          const isVehicleClass =
            detection.class_name === 'car' ||
            detection.class_name === 'motorcycle' ||
            detection.class_name === 'truck' ||
            detection.class_name === 'bus' ||
            detection.class_name === 'vehicle';
          const normalizedPlate =
            typeof plateLabel === 'string'
              ? plateLabel.replace(/\s+/g, '').toUpperCase()
              : '';
          const hasReadablePlate =
            typeof plateLabel === 'string' &&
            plateLabel.trim().length > 0 &&
            normalizedPlate !== 'NONE' &&
            normalizedPlate !== 'BLUR';
          const baseLabel = typeof plateLabel === 'string' && plateLabel.trim().length > 0
            ? plateLabel
            : `${detection.class_name} ${(detection.confidence * 100).toFixed(0)}%`;
          const plateStatus =
            registeredPlateSet.size > 0 && hasReadablePlate
              ? registeredPlateSet.has(normalizedPlate)
                ? 'Registered'
                : 'Unregistered'
              : null;
          const label: string = isVehicleClass
              ? `${baseLabel} Detected`
              : baseLabel;

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
              {plateStatus && (
                <div
                  className={cn(
                    'absolute -top-7 left-0 z-50 rounded-md border px-2 py-0.5 font-semibold shadow-lg backdrop-blur-sm',
                    plateStatus === 'Registered'
                      ? 'border-emerald-300 bg-emerald-600 text-white'
                      : 'border-rose-300 bg-rose-600 text-white',
                    fullscreen ? 'text-xs' : 'text-[10px]'
                  )}
                >
                  {plateStatus}
                </div>
              )}
              <div
                className={cn(
                  'absolute -top-6 left-0 bg-black/80 text-white px-2 py-0.5 rounded whitespace-nowrap',
                  fullscreen ? 'text-xs' : 'text-[10px]'
                )}
              >
                {label}
              </div>
            </div>
          );
        })}
      </div>

    </>
  );
}));

