# 多阶段构建：构建阶段产出前端 dist 与身份服务编译产物，运行阶段只带运行所需。

# 构建阶段：安装全部依赖 → 校验构建机准备的资源 → 构建前端 → 编译身份服务。
# public/assets/** 在 Git 外，必须在构建机上先执行 npm run assets:prepare 与 npm run audio:install；
# 缺失或摘要不符时在构建阶段明确失败，不用占位资源顶替。
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV CI=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.identity.json index.html ./
COPY src ./src
COPY public ./public
COPY scripts/deploy-check.mjs ./scripts/deploy-check.mjs
COPY db/migrations ./db/migrations
RUN node scripts/deploy-check.mjs
RUN npm run build \
 && npm run identity:build \
 && node scripts/deploy-check.mjs --prod
# 只保留运行期依赖（pg 等），避免把 vite/typescript 带进运行镜像。
RUN npm prune --omit=dev

# 运行阶段：只带 dist、身份服务编译产物、迁移与生产依赖；非 root 运行。
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8788 \
    STATIC_DIR=/app/dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/.cache/identity ./.cache/identity
COPY --from=build --chown=node:node /app/db/migrations ./db/migrations
USER node
EXPOSE 8788
# 健康检查与 /api/health 一致，同时验证数据库；镜像无 curl，使用 Node 内置 fetch。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8788/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", ".cache/identity/identity/main.js"]
