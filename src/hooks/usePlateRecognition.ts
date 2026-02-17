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
): { detections: PlateDetection[]; plateCount: number } {
  const [detections, setDetections] = useState<PlateDetection[]>([]);
  const rafRef = useRef<number>(0);
  const lastRunRef = useRef(0);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setDetections([]);
      return;
    }

    const runOCR = async () => {
      const video = videoRef.current;
      if (runningRef.current || !video?.videoWidth) return;

      runningRef.current = true;
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
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
        const plates = result?.plates ?? [];

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
        console.warn('Plate OCR error:', e);
        setDetections([]);
      } finally {
        runningRef.current = false;
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
  };
}
