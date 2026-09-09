import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          if (id.includes("node_modules/lucide-react")) return "lucide";
          if (id.endsWith("/src/pages/useSettingsPageController.tsx")) return "settings-controller";
          if (id.endsWith("/src/components/settings/SettingsDisplayView.tsx")) return "settings-display";
          if (id.endsWith("/src/components/settings/SettingsEditors.tsx")) return "settings-editors";
          if (id.endsWith("/src/components/settings/ProfileSettings.tsx")) return "settings-profiles";
          if (id.endsWith("/src/pages/useWatchPageController.tsx")) return "watch-controller";
          if (id.includes("/src/components/watch/") || id.endsWith("/src/components/LocalPlayer.tsx") || id.endsWith("/src/components/useVideoHlsSource.ts")) return "watch-player";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      // Keep the public page on the Vite/UI origin during development while
      // forwarding only its token-scoped data and media resources to the API.
      "^/share/[^/]+/(data|thumbnail|avatar|subtitles|media)(?:[/?]|$)": "http://localhost:3001",
      "/favicon.svg": "http://localhost:3001",
      "/icon-maskable.svg": "http://localhost:3001",
      "/apple-touch-icon.png": "http://localhost:3001",
      "/icon-192.png": "http://localhost:3001",
      "/icon-512.png": "http://localhost:3001",
    },
  },
});
