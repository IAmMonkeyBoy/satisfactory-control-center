import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard is served by Vite in dev and proxies the API (SSE stream + REST)
// to the control-center server so the browser talks to one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4317",
        changeOrigin: true,
      },
    },
  },
});
