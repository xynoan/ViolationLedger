/**
 * go2rtc WebSocket API base (no trailing slash, no `/api` segment).
 * The client connects to `${base}/api/ws?src=...`.
 */

/** HTTP(S) origin for go2rtc (api + WebRTC signaling). Default matches local go2rtc listen. */
export function getGo2rtcHttpBaseUrl(): string {
  const raw = (import.meta.env.VITE_GO2RTC_URL as string | undefined)?.trim();
  return raw || 'http://localhost:1984';
}

/** Convert `VITE_GO2RTC_URL` (http/https) to a WebSocket origin + optional path prefix. */
export function go2rtcHttpUrlToWsBase(httpUrl: string): string {
  try {
    const u = new URL(httpUrl);
    const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const path = u.pathname.replace(/\/+$/, '');
    const origin = `${wsProto}//${u.host}`;
    if (!path || path === '/') return origin;
    return `${origin}${path}`;
  } catch {
    return 'ws://localhost:1984';
  }
}

/** Default WS bases when `VITE_GO2RTC_WS_URL` is unset. */
export function mergeGo2rtcWsDefaults(): string[] {
  return [go2rtcHttpUrlToWsBase(getGo2rtcHttpBaseUrl())];
}

/** Stream key in go2rtc when showing a preview without an online API camera. */
export function getGo2rtcPreviewStreamSrc(): string {
  return (import.meta.env.VITE_GO2RTC_PREVIEW_SRC as string | undefined)?.trim() || 'cam1';
}
