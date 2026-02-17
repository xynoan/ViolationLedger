import { useState, useEffect, useRef } from 'react';
import { ocrAPI } from '@/lib/api';

export interface PlateDetection {
  bbox: number[];
  class_name: string;
  confidence: number;
  plateNumber?: string;
}

/** Interval between OCR requests (ms). Server AI is heavy so we throttle. */
const OCR_INTERVAL_MS = 2500;

export function usePlateRecognition(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean
): {
  detections: PlateDetection[];
  plateCount: number;
  isRunning: boolean;
  lastScanAt: number | null;
  lastError: string | null;
} {
  const [detections, setDetections] = useState<PlateDetection[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const rafRef = useRef<number>(0);
  const lastRunRef = useRef(0);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setDetections([]);
      setIsRunning(false);
      setLastError(null);
      return;
    }
    console.log('[Plate OCR] Running in background (every ~2.5s). Waiting for video frame...');

    const runOCR = async () => {
      const video = videoRef.current;
      if (runningRef.current) return;
      if (!video?.videoWidth) {
        return; // silent until video is ready
      }

      runningRef.current = true;
      setIsRunning(true);
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        console.log('[Plate OCR] Capturing frame and sending to server...', { w, h });
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setDetections([]);
          return;
        }
        ctx.drawImage(video, 0, 0, w, h);
        const imageBase64 = canvas.toDataURL('image/jpeg', 0.85);

        const result = await ocrAPI.plate(imageBase64);
        setLastScanAt(Date.now());
        setLastError(result?.error ? String(result.error) : null);
        const plates = result?.plates ?? [];
        if (plates.length > 0) {
          console.log('[Plate OCR] Done. Plates found:', plates.map((p: { plateNumber?: string }) => p.plateNumber));
        } else {
          console.log('[Plate OCR] Done. No plates detected.', result?.error ? `(${result.error})` : '');
        }

        const next: PlateDetection[] = plates.map((p: { plateNumber: string; confidence: number; bbox: number[] }) => {
          const [nx, ny, nw, nh] = p.bbox;
          const x1 = nx * w;
          const y1 = ny * h;
          const x2 = (nx + nw) * w;
          const y2 = (ny + nh) * h;
          return {
            bbox: [x1, y1, x2, y2],
            class_name: 'plate',
            confidence: p.confidence ?? 0.8,
            plateNumber: p.plateNumber,
          };
        });

        setDetections(next);
      } catch (e) {
        console.warn('[Plate OCR] Request failed:', e);
        setLastError(e instanceof Error ? e.message : 'Plate OCR request failed');
        setDetections([]);
      } finally {
        runningRef.current = false;
        setIsRunning(false);
      }
    };

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (now - lastRunRef.current < OCR_INTERVAL_MS) return;
      lastRunRef.current = now;
      runOCR();
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, videoRef]);

  return {
    detections,
    plateCount: detections.length,
    isRunning,
    lastScanAt,
    lastError,
  };
}
