/**
 * go2rtc WebSocket API base (no trailing slash, no `/api` segment).
 * The client connects to `${base}/api/ws?src=...`.
 */

/** Public go2rtc origin (e.g. Cloudflare tunnel). Used as an extra WS target after same-origin. */
export function getGo2rtcTunnelWsBase(): string | null {
  const raw = (import.meta.env.VITE_GO2RTC_PUBLIC_ORIGIN as string | undefined)?.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const path = u.pathname.replace(/\/+$/, '');
    const origin = `${wsProto}//${u.host}`;
    if (!path || path === '/') return origin;
    return `${origin}${path}`;
  } catch {
    return null;
  }
}

/** Default bases when `VITE_GO2RTC_WS_URL` is unset (browser only). */
export function mergeGo2rtcWsDefaults(): string[] {
  if (typeof window === 'undefined') {
    return ['ws://127.0.0.1:1984'];
  }

  const onHttps = window.location.protocol === 'https:';
  const proto = onHttps ? 'wss' : 'ws';
  const sameOriginProxy = `${proto}://${window.location.host}/go2rtc`;
  const tunnel = getGo2rtcTunnelWsBase();

  if (onHttps) {
    const list = [sameOriginProxy];
    if (tunnel) list.push(tunnel);
    return list;
  }

  const list = [sameOriginProxy, `${proto}://${window.location.hostname}:1984`];
  if (tunnel) list.splice(1, 0, tunnel);
  return list;
}

/** Stream key in go2rtc when showing a preview without an online API camera. */
export function getGo2rtcPreviewStreamSrc(): string {
  return (import.meta.env.VITE_GO2RTC_PREVIEW_SRC as string | undefined)?.trim() || 'cam1';
}
