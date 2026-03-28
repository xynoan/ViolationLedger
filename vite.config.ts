import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Dev/preview: browser uses same-origin ws://host/go2rtc/... — proxy to go2rtc HTTP API (see server/go2rtc/go2rtc.yaml, default :1984).
  const env = loadEnv(mode, process.cwd(), "");
  const go2rtcTarget = env.GO2RTC_PROXY_TARGET || "http://127.0.0.1:1984";
  const go2rtcProxy = {
    "/go2rtc": {
      target: go2rtcTarget,
      changeOrigin: true,
      ws: true,
      rewrite: (p: string) => p.replace(/^\/go2rtc/, "") || "/",
    },
  };

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: go2rtcProxy,
    },
    preview: {
      proxy: go2rtcProxy,
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
