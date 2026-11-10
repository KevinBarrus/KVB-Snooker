import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: process.env.IDENTITY_PROXY ?? "http://127.0.0.1:8788",
        changeOrigin: false
      }
    }
  }
});
