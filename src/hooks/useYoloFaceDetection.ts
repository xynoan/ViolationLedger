import { useState, useEffect, useRef } from 'react';
import { detectFaces, type FaceDetection } from '@/lib/yoloFaceDetection';

const DETECTION_INTERVAL_MS = 200;

export function useYoloFaceDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean
): { detections: FaceDetection[]; faceCount: number } {
  const [detections, setDetections] = useState<FaceDetection[]>([]);
  const rafRef = useRef<number>(0);
  const lastRunRef = useRef(0);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled || !videoRef.current) {
      setDetections([]);
      return;
    }

    const runDetection = async () => {
      const video = videoRef.current;
      if (runningRef.current || !video || !video.videoWidth) return;
      runningRef.current = true;
      try {
        const faces = await detectFaces(video);
        setDetections(faces);
      } catch (e) {
        console.warn('YOLO face detection error:', e);
        setDetections([]);
      } finally {
        runningRef.current = false;
      }
    };

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (now - lastRunRef.current < DETECTION_INTERVAL_MS) return;
      lastRunRef.current = now;
      runDetection();
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, videoRef]);

  return {
    detections,
    faceCount: detections.length,
  };
}
