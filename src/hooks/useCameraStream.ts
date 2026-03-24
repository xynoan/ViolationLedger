import { useState, useEffect, useRef, useCallback } from 'react';

interface UseCameraStreamOptions {
  /**
   * For go2rtc this is the stream name (src=...) configured in go2rtc.yaml.
   * We keep the prop name `deviceId` to match the existing Camera type.
   */
  deviceId?: string;
  isOnline: boolean;
}

const DEFAULT_GO2RTC_WS_URL = (() => {
  // Default to same-origin via reverse proxy path to avoid mixed-content/CORS issues.
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/go2rtc`;
})();

const normalizeGo2rtcWsUrl = (rawUrl?: string): string => {
  const fallback = DEFAULT_GO2RTC_WS_URL;
  const trimmed = rawUrl?.trim();
  if (!trimmed) return fallback;

  // Prevent mixed-content WS errors on HTTPS pages (production domains).
  if (window.location.protocol === 'https:' && trimmed.startsWith('ws://')) {
    return `wss://${trimmed.slice('ws://'.length)}`;
  }

  return trimmed;
};

const GO2RTC_WS_URL = normalizeGo2rtcWsUrl((import.meta.env as any).VITE_GO2RTC_WS_URL);

export function useCameraStream({ deviceId, isOnline }: UseCameraStreamOptions) {
  const [stream, setStream] = useState<MediaStream | null>(null);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const currentSrcRef = useRef<string | undefined>(undefined);
  const isConnectingRef = useRef(false);

  const cleanupConnection = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (peerRef.current) {
      try {
        peerRef.current.ontrack = null;
        peerRef.current.onicecandidate = null;
        peerRef.current.close();
      } catch {
        // ignore
      }
      peerRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
        }
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    setStream(null);
    currentSrcRef.current = undefined;
    isConnectingRef.current = false;
  }, []);

  const connect = useCallback(
    async (src: string) => {
      if (!isOnline || !src || isConnectingRef.current) {
        return;
      }

      isConnectingRef.current = true;
      currentSrcRef.current = src;

      try {
        const wsUrl = `${GO2RTC_WS_URL.replace(/\/+$/, '')}/api/ws?src=${encodeURIComponent(
          src,
        )}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onerror = (event) => {
          // Browser WebSocket errors are intentionally opaque; log URL to debug reachability/config.
          console.error('go2rtc WebSocket error', { wsUrl, event });
          isConnectingRef.current = false;
        };

        ws.onclose = (event) => {
          // Helps distinguish server-not-listening vs policy/reverse-proxy closes.
          console.warn('go2rtc WebSocket closed', {
            wsUrl,
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          });
          isConnectingRef.current = false;
          // Attempt simple reconnect if camera is still marked online
          if (isOnline && currentSrcRef.current) {
            reconnectTimeoutRef.current = window.setTimeout(() => {
              connect(currentSrcRef.current as string);
            }, 2000);
          }
        };

        ws.onopen = async () => {
          if (!isOnline) {
            ws.close();
            return;
          }

          const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          });
          peerRef.current = pc;

          pc.onicecandidate = (event) => {
            if (event.candidate && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'webrtc/candidate',
                  value: event.candidate.toJSON().candidate,
                }),
              );
            }
          };

          pc.ontrack = (event) => {
            // Prefer first stream if provided, otherwise build one from tracks
            const inbound =
              event.streams && event.streams[0]
                ? event.streams[0]
                : new MediaStream([event.track]);

            if (mediaStreamRef.current && mediaStreamRef.current !== inbound) {
              mediaStreamRef.current.getTracks().forEach((t) => t.stop());
            }

            mediaStreamRef.current = inbound;
            setStream(inbound);
          };

          // Receive video (and optionally audio)
          pc.addTransceiver('video', { direction: 'recvonly' });

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'webrtc/offer',
                value: offer.sdp,
              }),
            );
          }
        };

        ws.onmessage = async (event) => {
          const msg = JSON.parse(event.data);
          const pc = peerRef.current;
          if (!pc) return;

          if (msg.type === 'webrtc/answer') {
            const answer = new RTCSessionDescription({
              type: 'answer',
              sdp: msg.value,
            });
            await pc.setRemoteDescription(answer);
          } else if (msg.type === 'webrtc/candidate' && msg.value) {
            try {
              const candidateInit =
                typeof msg.value === 'string'
                  ? { candidate: msg.value, sdpMid: '0' }
                  : msg.value;
              await pc.addIceCandidate(candidateInit);
            } catch (err) {
              console.error('Failed to add ICE candidate from go2rtc:', err);
            }
          }
        };
      } catch (error) {
        console.error('Error connecting to go2rtc WebRTC stream:', error);
        isConnectingRef.current = false;
        cleanupConnection();
      }
    },
    [cleanupConnection, isOnline],
  );

  useEffect(() => {
    const src = deviceId?.trim();

    // If camera is offline or no src configured, tear everything down
    if (!isOnline || !src) {
      cleanupConnection();
      return;
    }

    // If src changed, reset and reconnect
    if (src !== currentSrcRef.current) {
      cleanupConnection();
      connect(src);
    }

    return () => {
      // On unmount, fully clean up
      cleanupConnection();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, isOnline]);

  const refresh = useCallback(() => {
    const src = deviceId?.trim();
    if (!src || !isOnline) return;

    cleanupConnection();
    connect(src);
  }, [cleanupConnection, connect, deviceId, isOnline]);

  const stopStream = useCallback(() => {
    cleanupConnection();
  }, [cleanupConnection]);

  return {
    stream,
    refresh,
    stopStream,
  };
}