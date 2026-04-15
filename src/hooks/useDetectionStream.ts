import { useState, useEffect, useRef } from 'react';

// Streams should be on by default; disable only when explicitly set to "true".
const WS_DISABLED = import.meta.env.VITE_DISABLE_WS === 'true';

export interface Detection {
  bbox: number[];
  class_name: string;
  confidence: number;
  plateNumber?: string;
}

type RawDetection = {
  bbox: number[];
  class_name: string;
  confidence: number;
  plateNumber?: string;
};

function isReadablePlate(plateNumber: unknown): plateNumber is string {
  if (typeof plateNumber !== 'string') return false;
  const normalized = plateNumber.replace(/\s+/g, '').toUpperCase();
  return Boolean(normalized) && normalized !== 'NONE' && normalized !== 'BLUR';
}

function isCenterInsideBox(centerX: number, centerY: number, box: number[]) {
  if (!Array.isArray(box) || box.length !== 4) return false;
  const [x1, y1, x2, y2] = box;
  return centerX >= x1 && centerX <= x2 && centerY >= y1 && centerY <= y2;
}

function getBoxCenter(box: number[]) {
  const [x1, y1, x2, y2] = box;
  return {
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
  };
}

function mapVehiclesWithPlateNumbers(vehicles: RawDetection[], plates: RawDetection[]): Detection[] {
  const readablePlates = plates.filter((p) => isReadablePlate(p.plateNumber));

  return vehicles.map((vehicle) => {
    if (!Array.isArray(vehicle.bbox) || vehicle.bbox.length !== 4 || readablePlates.length === 0) {
      return {
        bbox: vehicle.bbox,
        class_name: vehicle.class_name,
        confidence: vehicle.confidence ?? 0,
        plateNumber: undefined,
      };
    }

    const candidates = readablePlates
      .map((plate) => {
        if (!Array.isArray(plate.bbox) || plate.bbox.length !== 4) return null;
        const plateCenter = getBoxCenter(plate.bbox);
        if (!isCenterInsideBox(plateCenter.x, plateCenter.y, vehicle.bbox)) return null;

        const vehicleCenter = getBoxCenter(vehicle.bbox);
        const distance = Math.hypot(plateCenter.x - vehicleCenter.x, plateCenter.y - vehicleCenter.y);
        return { plate, distance };
      })
      .filter((item): item is { plate: RawDetection; distance: number } => item !== null)
      .sort((a, b) => a.distance - b.distance);

    return {
      bbox: vehicle.bbox,
      class_name: vehicle.class_name,
      confidence: vehicle.confidence ?? 0,
      plateNumber: candidates[0]?.plate.plateNumber,
    };
  });
}

/**
 * Subscribes to server-side detection stream via WebSocket.
 * Server captures frames from RTSP and runs YOLO (Option C).
 * No client-side frame capture or API calls.
 */
export function useDetectionStream(
  cameraId: string | undefined,
  enabled: boolean
): {
  detections: Detection[];
  vehicleCount: number;
  plateCount: number;
  isConnected: boolean;
  lastError: string | null;
  workerStatus: string | null;
} {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [workerStatus, setWorkerStatus] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (WS_DISABLED) {
      setDetections([]);
      setIsConnected(false);
      setLastError(null);
      setWorkerStatus(null);
      return;
    }

    if (!enabled || !cameraId?.trim()) {
      setDetections([]);
      setIsConnected(false);
      setLastError(null);
      setWorkerStatus(null);
      return;
    }

    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
    const wsBase = apiBase.replace(/^http/, 'ws').replace(/\/api\/?$/, '');
    const wsUrl = `${wsBase}/api/detect/ws?cameraIds=${encodeURIComponent(cameraId.trim())}`;

    const connect = () => {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          setLastError(null);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'detection' && msg.cameraId === cameraId) {
              const vehicles: RawDetection[] = msg.vehicles ?? [];
              const plates: RawDetection[] = msg.plates ?? [];
              const next: Detection[] = [
                ...mapVehiclesWithPlateNumbers(vehicles, plates),
                ...plates.map((p) => ({
                  bbox: p.bbox,
                  class_name: p.class_name,
                  confidence: p.confidence ?? 0,
                  plateNumber: p.plateNumber,
                })),
              ];
              setDetections(next);
              setLastError(msg.error ? String(msg.error) : null);
            } else if (msg.type === 'status' && msg.cameraId === cameraId) {
              setWorkerStatus(typeof msg.detail === 'string' ? msg.detail : null);
            }
          } catch {
            // Ignore malformed worker messages and keep the stream alive.
          }
        };

        ws.onclose = () => {
          setIsConnected(false);
          wsRef.current = null;
          if (enabled && cameraId) {
            reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
          }
        };

        ws.onerror = () => {
          setLastError('WebSocket connection error');
        };
      } catch (e) {
        setLastError(e instanceof Error ? e.message : 'Failed to connect');
        reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
    };
  }, [enabled, cameraId]);

  const vehicleCount = detections.filter((d) => d.class_name !== 'plate').length;
  const plateCount = detections.filter((d) => d.class_name === 'plate').length;

  return {
    detections,
    vehicleCount,
    plateCount,
    isConnected,
    lastError,
    workerStatus,
  };
}

/** Alias for useDetectionStream - same signature (cameraId, enabled). */
export { useDetectionStream as useYoloDetection };
