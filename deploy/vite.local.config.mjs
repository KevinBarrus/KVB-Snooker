// 本地演练的回退 Vite 配置：仅当仓库没有根 vite.config.ts 时由 identity-local.mjs 使用。
// 仓库已有根 vite.config.ts（读 IDENTITY_PROXY）时优先使用根配置，本文件不参与构建。
import { defineConfig } from "vite";

const identityOrigin = process.env.IDENTITY_ORIGIN ?? "http://127.0.0.1:8788";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.VITE_DEV_PORT ?? 5173),
    strictPort: true,
    proxy: {
      // 浏览器仍认为请求发往 5173，因此 dev.env 的 PUBLIC_ORIGIN 应为 http://127.0.0.1:5173。
      "/api": {
        target: identityOrigin,
        changeOrigin: false,
      },
    },
  },
});
