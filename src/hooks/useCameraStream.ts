import { useState, useEffect, useRef, useCallback } from 'react';

interface UseCameraStreamOptions {
  /**
   * For go2rtc this is the stream name (src=...) configured in go2rtc.yaml.
   * We keep the prop name `deviceId` to match the existing Camera type.
   */
  deviceId?: string;
  isOnline: boolean;
}

const DEFAULT_GO2RTC_WS_BASE_URLS = (() => {
  // Prefer same-origin proxy first. Under HTTPS, never fall back to ws:// to avoid mixed-content blocks.
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const sameOriginProxy = `${proto}://${window.location.host}/go2rtc`;
  if (window.location.protocol === 'https:') {
    return [sameOriginProxy];
  }
  return [sameOriginProxy, `${proto}://${window.location.hostname}:1984`];
})();

const isPrivateOrLocalHost = (host: string): boolean => {
  const normalized = host.toLowerCase();
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
    return true;
  }
  if (/^10\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  return false;
};

const normalizeGo2rtcWsUrls = (rawUrl?: string): string[] => {
  const fallback = DEFAULT_GO2RTC_WS_BASE_URLS;
  const trimmed = rawUrl?.trim();
  if (!trimmed) return fallback;

  const onHttpsPage = window.location.protocol === 'https:';

  // Relative path form (e.g. /go2rtc) resolves to same-origin ws(s) endpoint.
  if (trimmed.startsWith('/')) {
    const proto = onHttpsPage ? 'wss' : 'ws';
    return [`${proto}://${window.location.host}${trimmed}`];
  }

  // In HTTPS production, avoid private-IP WS hosts (not publicly reachable / cert mismatch);
  // same-origin /go2rtc proxy is the supported route.
  if (onHttpsPage) {
    try {
      const parsed = new URL(trimmed);
      if (isPrivateOrLocalHost(parsed.hostname)) {
        return DEFAULT_GO2RTC_WS_BASE_URLS;
      }
    } catch {
      // Ignore parse issues and continue normal handling.
    }
  }

  // If app is HTTPS, auto-upgrade ws:// to wss:// to prevent mixed-content errors.
  if (trimmed.startsWith('ws://')) {
    if (onHttpsPage) return [`wss://${trimmed.slice('ws://'.length)}`];
    return [trimmed];
  }
  if (trimmed.startsWith('wss://')) {
    return [trimmed];
  }

  // Support http(s) inputs by converting to ws(s).
  if (trimmed.startsWith('http://')) {
    if (onHttpsPage) return [`wss://${trimmed.slice('http://'.length)}`];
    return [`ws://${trimmed.slice('http://'.length)}`];
  }
  if (trimmed.startsWith('https://')) return [`wss://${trimmed.slice('https://'.length)}`];

  return [trimmed];
};

const GO2RTC_WS_BASE_URLS = normalizeGo2rtcWsUrls((import.meta.env as any).VITE_GO2RTC_WS_URL);
// Streams should be on by default; disable only when explicitly set to "true".
const WS_DISABLED = (import.meta.env as any).VITE_DISABLE_WS === 'true';

export function useCameraStream({ deviceId, isOnline }: UseCameraStreamOptions) {
  const [stream, setStream] = useState<MediaStream | null>(null);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const currentSrcRef = useRef<string | undefined>(undefined);
  const isConnectingRef = useRef(false);
  const wsBaseIndexRef = useRef(0);

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
      if (WS_DISABLED || !isOnline || !src || isConnectingRef.current) {
        return;
      }

      isConnectingRef.current = true;
      currentSrcRef.current = src;

      try {
        const wsBase = GO2RTC_WS_BASE_URLS[wsBaseIndexRef.current] || GO2RTC_WS_BASE_URLS[0];
        const wsUrl = `${wsBase.replace(/\/+$/, '')}/api/ws?src=${encodeURIComponent(
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
            wsBase,
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          });
          isConnectingRef.current = false;

          // If using defaults and current target failed, try next target.
          if ((import.meta.env as any).VITE_GO2RTC_WS_URL?.trim() !== '' &&
              (import.meta.env as any).VITE_GO2RTC_WS_URL != null) {
            // Explicit URL configured - don't rotate automatically.
          } else if (GO2RTC_WS_BASE_URLS.length > 1) {
            wsBaseIndexRef.current = (wsBaseIndexRef.current + 1) % GO2RTC_WS_BASE_URLS.length;
          }

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

    if (WS_DISABLED) {
      cleanupConnection();
      return;
    }

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
    if (WS_DISABLED) return;

    const src = deviceId?.trim();
    if (!src || !isOnline) return;

    cleanupConnection();
    wsBaseIndexRef.current = 0;
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