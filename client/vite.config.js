import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    strictPort: true,
  },

  resolve: {
    alias: {
      stream: "stream-browserify",
      buffer: "buffer",
      process: "process",
      events: "events",
      util: "util",
    },
  },

  define: {
    global: "globalThis",
  },
});