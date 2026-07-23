import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/favicon.svg": "http://localhost:3001",
      "/icon-maskable.svg": "http://localhost:3001",
      "/apple-touch-icon.png": "http://localhost:3001",
      "/icon-192.png": "http://localhost:3001",
      "/icon-512.png": "http://localhost:3001",
    },
  },
});
