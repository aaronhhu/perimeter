import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// strictPort: the tray's settings item opens :5173, so a silent fallback to :5174 would open nothing.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
