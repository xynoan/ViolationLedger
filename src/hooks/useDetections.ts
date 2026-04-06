import { useState, useEffect, useRef, useCallback } from 'react';
import { detectionsAPI } from '@/lib/api';

interface Detection {
  bbox: number[];
  class_name: string;
  confidence: number;
}

interface UseDetectionsOptions {
  cameraId: string;
  isOnline: boolean;
  pollInterval?: number;
}

const DEFAULT_POLL_INTERVAL = 10000; // 10 seconds

export function useDetections({
  cameraId,
  isOnline,
  pollInterval = DEFAULT_POLL_INTERVAL,
}: UseDetectionsOptions) {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadDetections = useCallback(async () => {
    if (!isOnline || !cameraId) {
      setDetections([]);
      setVehicleCount(0);
      return;
    }

    // Cancel previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setIsLoading(true);

    try {
      const latest = await detectionsAPI.getLatest(cameraId);
      
      if (latest && latest.bbox) {
        try {
          const bbox = typeof latest.bbox === 'string' ? JSON.parse(latest.bbox) : latest.bbox;
          if (Array.isArray(bbox) && bbox.length === 4) {
            const detection: Detection = {
              bbox,
              class_name: latest.class_name || 'vehicle',
              confidence: latest.confidence || 0,
            };
            setDetections([detection]);
            setVehicleCount(1);
          } else {
            setDetections([]);
            setVehicleCount(0);
          }
        } catch {
          setDetections([]);
          setVehicleCount(0);
        }
      } else {
        setDetections([]);
        setVehicleCount(0);
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Error loading detections:', error);
      }
      setDetections([]);
      setVehicleCount(0);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [isOnline, cameraId]);

  useEffect(() => {
    if (!isOnline) {
      setDetections([]);
      setVehicleCount(0);
      return;
    }

    loadDetections();
    const interval = setInterval(loadDetections, pollInterval);

    return () => {
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isOnline, cameraId, pollInterval, loadDetections]);

  return {
    detections,
    vehicleCount,
    isLoading,
    refresh: loadDetections,
  };
}

