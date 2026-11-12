import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/net": { target: process.env.NET_PROXY ?? "http://127.0.0.1:8787", ws: true, changeOrigin: false },
      "/api/rooms": { target: process.env.NET_PROXY ?? "http://127.0.0.1:8787", changeOrigin: false },
      "/api": {
        target: process.env.IDENTITY_PROXY ?? "http://127.0.0.1:8788",
        changeOrigin: false
      }
    }
  }
});
