import { useRef, useEffect, useMemo, memo, useImperativeHandle, forwardRef } from 'react';
import { Camera as CameraIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Camera } from '@/types/parking';
import { usePlateRecognition } from '@/hooks/usePlateRecognition';
import { normalizePlateForOcrMatch } from '@/lib/plateNormalize';
import {
  type PlateRegistryStatus,
  resolvePlateRegistryStatus,
} from '@/lib/cameraPlateRegistry';

export type { PlateRegistryStatus };

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
  /** Plates linked to a resident (resident vehicles). */
  residentPlates?: string[];
  /** Registered guest visitors (no residentId; not delivery/drop-off). */
  visitorPlates?: string[];
  /** Delivery-category visitor plates (mutually exclusive with drop-off / guest visitor lists). */
  deliveryPlates?: string[];
  /** Drop-off purpose visitor plates. */
  dropoffPlates?: string[];
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

function plateStatusLabel(status: PlateRegistryStatus): string {
  switch (status) {
    case 'RESIDENT':
      return 'Resident';
    case 'VISITOR':
      return 'Visitor';
    case 'DELIVERY':
      return 'Delivery';
    case 'DROPOFF':
      return 'Drop-off';
    default:
      return 'Unregistered';
  }
}

function plateStatusOverlayClass(status: PlateRegistryStatus, fullscreen: boolean): string {
  const size = fullscreen ? 'text-xs' : 'text-[10px]';
  const base =
    'absolute -top-12 left-0 z-50 rounded-md border px-2 py-0.5 font-semibold shadow-lg backdrop-blur-sm ' +
    size;
  switch (status) {
    case 'RESIDENT':
      return cn(base, 'border-emerald-300 bg-emerald-600 text-white');
    case 'VISITOR':
      return cn(base, 'border-sky-300 bg-sky-700 text-white');
    case 'DELIVERY':
      return cn(base, 'border-orange-300 bg-orange-700 text-white');
    case 'DROPOFF':
      return cn(base, 'border-amber-300 bg-amber-800 text-white');
    default:
      return cn(base, 'border-red-200 bg-red-700 text-white ring-1 ring-red-300/70');
  }
}

function plateStatusPanelClass(status: PlateRegistryStatus, fullscreen: boolean): string {
  const size = fullscreen ? 'text-[10px]' : 'text-[9px]';
  const base = 'rounded border px-1 py-0.5 font-semibold ' + size;
  switch (status) {
    case 'RESIDENT':
      return cn(base, 'border-emerald-300 bg-emerald-700/80 text-emerald-100');
    case 'VISITOR':
      return cn(base, 'border-sky-300 bg-sky-800/90 text-sky-50');
    case 'DELIVERY':
      return cn(base, 'border-orange-300 bg-orange-800/90 text-orange-50');
    case 'DROPOFF':
      return cn(base, 'border-amber-300 bg-amber-900/90 text-amber-50');
    default:
      return cn(base, 'border-red-200 bg-red-700 text-red-50 ring-1 ring-red-300/70');
  }
}

export const VideoPlayer = memo(forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer({
  stream,
  isOnline,
  camera,
  detections: apiDetections,
  residentPlates = [],
  visitorPlates = [],
  deliveryPlates = [],
  dropoffPlates = [],
  fullscreen = false,
  enablePlateRecognition = false,
  onPlateMetaChange,
}, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mjpegImgRef = useRef<HTMLImageElement>(null);
  const deviceSource = String(camera.deviceId || '').trim();
  const directMjpegUrl = /^https?:\/\//i.test(deviceSource) ? deviceSource : null;
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
  const residentPlateSet = useMemo(
    () =>
      new Set(
        residentPlates.map((p) => normalizePlateForOcrMatch(p)).filter(Boolean),
      ),
    [residentPlates],
  );
  const visitorPlateSet = useMemo(
    () =>
      new Set(
        visitorPlates.map((p) => normalizePlateForOcrMatch(p)).filter(Boolean),
      ),
    [visitorPlates],
  );
  const deliveryPlateSet = useMemo(
    () =>
      new Set(
        deliveryPlates.map((p) => normalizePlateForOcrMatch(p)).filter(Boolean),
      ),
    [deliveryPlates],
  );
  const dropoffPlateSet = useMemo(
    () =>
      new Set(
        dropoffPlates.map((p) => normalizePlateForOcrMatch(p)).filter(Boolean),
      ),
    [dropoffPlates],
  );

  const recognizedPlates = useMemo(() => {
    const deduped = new Map<string, { plate: string; status: PlateRegistryStatus | null }>();

    detections.forEach((detection) => {
      const rawPlate = typeof detection.plateNumber === 'string' ? detection.plateNumber.trim() : '';
      if (!rawPlate) return;
      const normalized = normalizePlateForOcrMatch(rawPlate);
      if (!normalized || normalized === 'NONE' || normalized === 'BLUR') return;
      if (deduped.has(normalized)) return;

      const status: PlateRegistryStatus = resolvePlateRegistryStatus(
        normalized,
        residentPlateSet,
        dropoffPlateSet,
        deliveryPlateSet,
        visitorPlateSet,
      );
      deduped.set(normalized, { plate: rawPlate, status });
    });

    return [...deduped.values()];
  }, [
    detections,
    residentPlateSet,
    dropoffPlateSet,
    deliveryPlateSet,
    visitorPlateSet,
  ]);
  const hasVehicleDetection = useMemo(
    () =>
      detections.some(
        (detection) =>
          detection.class_name === 'car' ||
          detection.class_name === 'motorcycle' ||
          detection.class_name === 'truck' ||
          detection.class_name === 'bus' ||
          detection.class_name === 'vehicle'
      ),
    [detections]
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
          ref={mjpegImgRef}
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
          const mjpegElement = mjpegImgRef.current;
          const sourceIsVideo =
            Boolean(videoElement && hasStream && (videoElement.videoWidth || videoElement.videoHeight));
          const sourceElement = sourceIsVideo ? videoElement : mjpegElement;

          const displayWidth = sourceElement?.clientWidth || 0;
          const displayHeight = sourceElement?.clientHeight || 0;

          if (!sourceElement || !displayWidth || !displayHeight) return null;

          const sourceWidth = sourceIsVideo
            ? (videoElement?.videoWidth || 1920)
            : (mjpegElement?.naturalWidth || 1920);
          const sourceHeight = sourceIsVideo
            ? (videoElement?.videoHeight || 1080)
            : (mjpegElement?.naturalHeight || 1080);

          const videoAspect = sourceWidth / sourceHeight;
          const displayAspect = displayWidth / displayHeight;

          let scaleX: number, scaleY: number, offsetX = 0, offsetY = 0;

          if (videoAspect > displayAspect) {
            scaleX = displayWidth / sourceWidth;
            scaleY = scaleX;
            offsetY = (displayHeight - sourceHeight * scaleY) / 2;
          } else {
            scaleY = displayHeight / sourceHeight;
            scaleX = scaleY;
            offsetX = (displayWidth - sourceWidth * scaleX) / 2;
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
            typeof plateLabel === 'string' ? normalizePlateForOcrMatch(plateLabel) : '';
          const hasReadablePlate =
            typeof plateLabel === 'string' &&
            plateLabel.trim().length > 0 &&
            normalizedPlate !== 'NONE' &&
            normalizedPlate !== 'BLUR';
          const baseLabel = typeof plateLabel === 'string' && plateLabel.trim().length > 0
            ? plateLabel
            : `${detection.class_name} ${(detection.confidence * 100).toFixed(0)}%`;
          const plateStatus: PlateRegistryStatus | null =
            hasReadablePlate
              ? resolvePlateRegistryStatus(
                  normalizedPlate,
                  residentPlateSet,
                  dropoffPlateSet,
                  deliveryPlateSet,
                  visitorPlateSet,
                )
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
                <div className={plateStatusOverlayClass(plateStatus, fullscreen)}>
                  {plateStatusLabel(plateStatus)}
                </div>
              )}
              {hasReadablePlate && (
                <div
                  className={cn(
                    'absolute -top-7 left-0 z-50 rounded-md border border-slate-300 bg-slate-900/90 px-2 py-0.5 font-mono font-semibold text-white shadow-lg backdrop-blur-sm',
                    fullscreen ? 'text-xs' : 'text-[10px]'
                  )}
                >
                  PLATE: {plateLabel}
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

      {(recognizedPlates.length > 0 || hasVehicleDetection) && (
        <div
          className={cn(
            'absolute left-2 bottom-2 z-30 rounded-md border border-white/20 bg-black/70 px-2 py-1.5 text-white backdrop-blur-sm',
            fullscreen ? 'max-w-[70%]' : 'max-w-[80%]'
          )}
        >
          <div className={cn('font-semibold', fullscreen ? 'text-xs' : 'text-[10px]')}>
            Plate Number Detected:
          </div>
          <div className="mt-1 flex flex-col gap-1">
            {recognizedPlates.length > 0 ? (
              <>
                {recognizedPlates.slice(0, 5).map((entry) => (
                  <div key={entry.plate} className="flex items-center gap-2">
                    <span className={cn('font-mono', fullscreen ? 'text-xs' : 'text-[10px]')}>
                      {entry.plate}
                    </span>
                    {entry.status && (
                      <span className={plateStatusPanelClass(entry.status, fullscreen)}>
                        {plateStatusLabel(entry.status)}
                      </span>
                    )}
                  </div>
                ))}
                {recognizedPlates.length > 5 && (
                  <div className={cn('text-muted-foreground', fullscreen ? 'text-[10px]' : 'text-[9px]')}>
                    +{recognizedPlates.length - 5} more
                  </div>
                )}
              </>
            ) : (
              <div className={cn('italic text-muted-foreground', fullscreen ? 'text-[10px]' : 'text-[9px]')}>
                No readable plate recognized
              </div>
            )}
          </div>
        </div>
      )}

    </>
  );
}));

