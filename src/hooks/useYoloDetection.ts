import { useState, useEffect, useRef } from 'react';
import { detectAPI } from '@/lib/api';
import { VideoPlayerHandle } from '@/components/dashboard/VideoPlayer';

export interface YoloDetection {
  bbox: number[];
  class_name: string;
  confidence: number;
  plateNumber?: string;
}

/** Interval between YOLO detection requests (ms). */
const YOLO_INTERVAL_MS = 2500;

export function useYoloDetection(
  videoPlayerRef: React.RefObject<VideoPlayerHandle | null>,
  enabled: boolean
): {
  detections: YoloDetection[];
  vehicleCount: number;
  plateCount: number;
  isRunning: boolean;
  lastError: string | null;
} {
  const [detections, setDetections] = useState<YoloDetection[]>([]);
  const [isRunning, setIsRunning] = useState(false);
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

    const runDetection = async () => {
      if (runningRef.current) return;
      const captureFrame = videoPlayerRef.current?.captureFrame;
      if (!captureFrame) return;

      runningRef.current = true;
      setIsRunning(true);
      try {
        const imageBase64 = await captureFrame();
        if (!imageBase64) return;

        const result = await detectAPI.yolo(imageBase64);
        setLastError(result?.error ? String(result.error) : null);

        const vehicles = result?.vehicles ?? [];
        const plates = result?.plates ?? [];

        const next: YoloDetection[] = [
          ...vehicles.map((v: { bbox: number[]; class_name: string; confidence: number }) => ({
            bbox: v.bbox,
            class_name: v.class_name,
            confidence: v.confidence ?? 0,
            plateNumber: undefined,
          })),
          ...plates.map((p: { bbox: number[]; class_name: string; confidence: number; plateNumber?: string }) => ({
            bbox: p.bbox,
            class_name: p.class_name,
            confidence: p.confidence ?? 0,
            plateNumber: p.plateNumber,
          })),
        ];

        setDetections(next);
      } catch (e) {
        console.warn('[YOLO] Request failed:', e);
        setLastError(e instanceof Error ? e.message : 'YOLO detection failed');
        setDetections([]);
      } finally {
        runningRef.current = false;
        setIsRunning(false);
      }
    };

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (now - lastRunRef.current < YOLO_INTERVAL_MS) return;
      lastRunRef.current = now;
      runDetection();
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, videoPlayerRef]);

  const vehicleCount = detections.filter((d) => d.class_name !== 'plate').length;
  const plateCount = detections.filter((d) => d.class_name === 'plate').length;

  return {
    detections,
    vehicleCount,
    plateCount,
    isRunning,
    lastError,
  };
}
