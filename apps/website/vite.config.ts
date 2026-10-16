import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// strictPort: the tray's settings item opens :5173, so a silent fallback to :5174 would open nothing.
// The proxy keeps the browser on one origin, so the API needs no CORS while both run locally.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:3000", rewrite: (path) => path.replace(/^\/api/, "") } },
  },
});
