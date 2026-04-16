import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const go2rtcProxyTarget =
    env.VITE_GO2RTC_URL?.trim() || env.GO2RTC_PROXY_TARGET || "http://127.0.0.1:1984";

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: {
        "/go2rtc": {
          target: go2rtcProxyTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/go2rtc/, ""),
        },
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
