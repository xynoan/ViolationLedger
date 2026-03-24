import { useState, useEffect, useRef } from 'react';

const WS_DISABLED = (import.meta.env as any).VITE_DISABLE_WS !== 'false';

export interface Detection {
  bbox: number[];
  class_name: string;
  confidence: number;
  plateNumber?: string;
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
} {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (WS_DISABLED) {
      setDetections([]);
      setIsConnected(false);
      setLastError(null);
      return;
    }

    if (!enabled || !cameraId?.trim()) {
      setDetections([]);
      setIsConnected(false);
      setLastError(null);
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
              const vehicles = msg.vehicles ?? [];
              const plates = msg.plates ?? [];
              const next: Detection[] = [
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
              setLastError(msg.error ? String(msg.error) : null);
            }
          } catch (_) {}
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
  };
}

/** Alias for useDetectionStream - same signature (cameraId, enabled). */
export { useDetectionStream as useYoloDetection };
