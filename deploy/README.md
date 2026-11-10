# 内测部署

本目录是本轮内测部署基础设施：[Dockerfile](../Dockerfile)、[docker-compose.yml](../docker-compose.yml)、
[.dockerignore](../.dockerignore)、Caddy 同源反向代理、受控 env 文件示例与本地演练说明。
产品范围、HTTP 契约与部署边界见[内测身份与部署设计](../docs/internal-beta-identity-design.md) §6—§7，
接口契约见[架构 §4.14](../docs/architecture.md)。

当前限制：**没有公网服务器、域名和 TLS 权限，真实远程上线尚未执行**；本轮交付可静态校验的配置，
并在本机用真实 PostgreSQL 验证了身份服务运行时路径。Docker 镜像拉取在本构建机被镜像注册表网络阻止，
`docker build` 未完成，属未验证项，见 §9。

## 1. 运行边界

```
浏览器 ── HTTPS 同源（80/443）──> Caddy ──> identity:8788（dist + /api，内部网络）
                                              └──> postgres:5432（仅内部网络，命名卷持久化）
```

- 只暴露 80/443（Caddy）；PostgreSQL 与身份服务都不映射公网端口。
- 身份服务与浏览器只通过同源 HTTPS + HttpOnly Cookie 通信。
- `public/assets/**` 在 Git 外，必须由构建机准备；镜像构建会校验，缺失即失败，不解除 `.gitignore`。
- 数据卷 `snk-pgdata` 持久化账号和稳定用户 ID，容器重启不丢数据。
- 配置只来自环境变量与受控 env 文件；仓库不提交真实密码。`deploy/production.env`、`deploy/dev.env`
  已被 [deploy/.gitignore](.gitignore) 忽略，示例文件只含占位符。

## 2. 构建机准备与资源校验

在仓库根执行（首次部署或资源变更后）：

```bash
npm ci
npm run assets:prepare     # 校验 SHA-256 后复制原作模型与物理台面到 public/assets
npm run audio:install      # 安装音效集并写 public/assets/audio/manifest.json
npm run deploy:check       # 只读校验资源，缺失逐条打印路径并非零退出
```

`deploy:check` 实际检查：`public/assets/render`（清单 28 项，逐个 SHA-256 与 `.babylon` 场景）、
`public/assets/physics/table.json`（摘要与 JSON）、`public/assets/audio/manifest.json` 引用的每个音频文件。
`--prod` 额外检查 `dist/index.html`、`dist/assets` 中复制后的资源、`.cache/identity/identity/main.js`
与 `db/migrations/*.sql`（供镜像构建阶段与部署后自检使用）。

```bash
npm run build                 # 前端构建，public/ 复制到 dist/
npm run identity:build        # tsc -p tsconfig.identity.json → .cache/identity/
node scripts/deploy-check.mjs --prod
```

## 3. 镜像构建

```bash
docker build -t kvb-snooker-identity:$(git rev-parse --short HEAD) .
# 或由 compose 构建（标签取 IDENTITY_IMAGE，默认 kvb-snooker-identity:local）：
docker compose build identity
```

多阶段：`build` 阶段用 `node:22-bookworm-slim` + `npm ci`，校验资源 → `npm run build` →
`npm run identity:build` → `deploy-check --prod` → `npm prune --omit=dev`；`runtime` 阶段只复制
`dist`、`.cache/identity`、`db/migrations`、生产 `node_modules` 与 `package.json`，以非 root `node`
用户运行，`EXPOSE 8788`，健康检查走 `/api/health`，`CMD node .cache/identity/identity/main.js`。

构建上下文的 [.dockerignore](../.dockerignore) 排除 `node_modules`、`.cache`、`dist`、`.git`、`analysis`、
`vendor-original`、`local-audio*`、测试与本地日志等，但**保留 `public/assets`**（构建机准备的真实资源）。

## 4. 首次上线

```bash
cp deploy/production.env.example deploy/production.env
chmod 600 deploy/production.env
# 填写：POSTGRES_PASSWORD/DATABASE_URL（两处密码一致）、PUBLIC_ORIGIN、COOKIE_SECURE=1、TRUST_PROXY=1
docker compose config                       # 只校验语法与变量，不启动
docker compose build
docker compose up -d postgres               # 先起数据库
docker compose run --rm identity node .cache/identity/identity/cli.js migrate
docker compose up -d                        # 起身份服务
```

迁移必须显式执行：身份服务 `main.js` **不会自动迁移**，按设计由运维在切换容器前跑
`cli.js migrate`（幂等，按文件名排序、事务内执行、`schema_migrations` 记录版本）。

两个预建内测账号（密码交互隐藏输入，不写进命令行/日志；容器内用 `docker compose run` 保留 TTY）：

```bash
docker compose run --rm identity node .cache/identity/identity/cli.js create-user --email beta1@example.com --role player
docker compose run --rm identity node .cache/identity/identity/cli.js create-user --email beta2@example.com --role player
```

可选 HTTPS 反代（域名已解析、80/443 可达后）：

```bash
docker compose --profile https up -d caddy
docker compose logs -f caddy
```

[Caddyfile](Caddyfile) 用 `PUBLIC_ORIGIN` 作为站点地址申请/续期证书，同源反代到 `identity:8788`，
并对 `/api/internal/*` 返回 404（设计 §7：内网校验端点不公开）。HSTS 与安全响应头一并设置。

健康检查（反代与容器使用同一入口）：

```bash
curl -fsS https://<PUBLIC_ORIGIN>/api/health        # 期望 {"ok":true,"database":"up"}
docker compose exec identity node -e "fetch('http://127.0.0.1:8788/api/health').then(async (r) => console.log(r.status, await r.text()))"
```

日志：`docker compose logs -f identity`。身份服务只记录方法/路径/状态/耗时/来源地址，不记录 Cookie、
请求体、密码、邮箱或数据库 URL；反代不记录请求头。登录限流是单实例内存实现，多实例部署前需换共享存储。

## 5. 更新

```bash
# 1. 构建机拉取代码后重新准备/校验（资源有变更时）
npm ci
npm run assets:prepare && npm run audio:install   # 仅在资源来源或音效集变更时
npm run deploy:check
npm run build && npm run identity:build && node scripts/deploy-check.mjs --prod

# 2. 构建带新标签的镜像（compose 的 image 名与 run/up 都跟随 IDENTITY_IMAGE）
export IDENTITY_IMAGE=kvb-snooker-identity:<new-tag>
docker build -t "$IDENTITY_IMAGE" .

# 3. 备份数据库（迁移前必须）
mkdir -p "$HOME/snk-backups"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "$HOME/snk-backups/snk-$(date +%Y%m%dT%H%M%S).sql"

# 4. 应用迁移（对当前运行中的数据库），然后切换到新镜像
docker compose run --rm identity node .cache/identity/identity/cli.js migrate
docker compose up -d identity
curl -fsS https://<PUBLIC_ORIGIN>/api/health
```

更新只重建/切换身份服务容器，PostgreSQL 容器与 `snk-pgdata` 数据卷保持不动。
账号、密码与会话仍有效；若管理员执行了 `reset-password`/`disable-user`，相关旧会话按设计撤销。

## 6. 备份与回滚

**不做“删库重建”**。迁移是前向的（只记录已应用版本，不提供 down 脚本），回滚 = 恢复迁移前备份 +
切回上一镜像。

```bash
# 备份（建议每次迁移前 + 每日定时）
mkdir -p "$HOME/snk-backups"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "$HOME/snk-backups/snk-$(date +%Y%m%dT%H%M%S).sql"

# 回滚：停身份服务 → 恢复备份 → 切回上一镜像 → 校验健康
docker compose stop identity
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$HOME/snk-backups/snk-<时间戳>.sql"
export IDENTITY_IMAGE=kvb-snooker-identity:<previous-tag>
docker compose up -d identity
curl -fsS https://<PUBLIC_ORIGIN>/api/health
```

回滚注意：

- 恢复备份会覆盖备份之后的账号/会话变更；仅在确认新版本不可用时执行，先保留现场备份。
- 不要删除 `snk-pgdata` 卷来“重置”部署；卷丢失等于账号和稳定用户 ID 全部丢失。
- 若新版本已写入备份中不存在的迁移版本，回滚后旧代码仍可运行（旧代码不检查新表），
  但新版本写入的新表数据会留在恢复后的旧库中，属已知限制；必要时在维护窗口执行。
- 备份文件包含账号与会话哈希，只存受控位置，不提交仓库、不入镜像。

## 7. 本地演练

两种方式共用同一身份服务代码；推荐脚本一键编排：

```bash
node scripts/identity-local.mjs --db docker            # Docker 起 PostgreSQL（127.0.0.1:55433）
node scripts/identity-local.mjs --db local             # 使用已运行的本机 PostgreSQL（读 DATABASE_URL）
node scripts/identity-local.mjs --db docker --serve-dist  # 不启动 Vite，身份服务直接服务 dist
node scripts/identity-local.mjs --help
```

脚本行为：

1. `--db docker` 首次运行生成 `deploy/dev.env`（随机密码，`chmod 600`，已被忽略），用
   [deploy/docker-compose.dev.yml](docker-compose.dev.yml) 把 PostgreSQL 映射到 `127.0.0.1:55433`
   （只绑回环地址，避开本机已有 5432/55432）；等待健康后继续。
2. `--db local` 只读取 `DATABASE_URL`，不创建账号/数据库；连不上时打印可操作提示。
3. 执行 `npm run identity:build` 与 `cli.js migrate`（可用 `--no-build`/`--no-migrate` 跳过）。
4. 启动身份服务到 `127.0.0.1:8788`，轮询 `/api/health`，失败即停止并说明。
5. 启动 Vite 到 `127.0.0.1:5173`（可用 `--vite-port` 改端口）。仓库存在 `vite.config.ts` 时使用
   其 `/api` 代理（读 `IDENTITY_PROXY`）；没有根配置时回退到
   [deploy/vite.local.config.mjs](vite.local.config.mjs)。脚本只以命令行参数覆盖 host/port，
   不修改仓库 Vite 配置，也不改变 `npm run dev` 的默认行为。
6. 打印创建账号命令；脚本**不会**代替执行 `create-user`（密码必须交互隐藏输入）：

```bash
set -a; . deploy/dev.env; set +a
npm run identity:create-user -- --email beta1@example.com --role player
```

手动分步命令（不用脚本时）：

```bash
cp deploy/dev.env.example deploy/dev.env && chmod 600 deploy/dev.env   # 填写占位值
docker compose -f docker-compose.yml -f deploy/docker-compose.dev.yml up -d postgres
npm run identity:build && npm run identity:migrate
set -a; . deploy/dev.env; set +a
npm run identity:dev                                    # 或 node .cache/identity/identity/main.js
npx vite --host 127.0.0.1 --port 5174                   # 另开终端；根 vite.config.ts 已代理 /api → 8788
# 若仓库没有根 vite.config.ts，改用：npx vite --config deploy/vite.local.config.mjs
```

本地验收顺序：`npm run deploy:check` → 登录/退出 → `/api/auth/me` → 两个账号本地球形隔离 →
停掉身份服务后页面显示真实错误而不是进入游戏 → `docker compose config`。

## 8. 环境变量

| 变量 | 用途 | 生产建议 |
|---|---|---|
| `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` | PostgreSQL 初始化 | 强随机密码，仅存 `deploy/production.env` |
| `DATABASE_URL` | 身份服务数据库连接 | 与上项密码一致，主机名 `postgres` |
| `PUBLIC_ORIGIN` | 同源校验与 Caddy 站点地址 | `https://<域名>` |
| `COOKIE_SECURE` | Cookie 加 `Secure` | `1` |
| `SESSION_TTL_SECONDS` | 会话有效期 | 默认 `604800`（7 天） |
| `TRUST_PROXY` | 经反代时按 `X-Forwarded-For` 计限流 | `1` |
| `INTERNAL_TOKEN` | 启用内网会话校验端点 | 仅在需要时设置；反代已屏蔽 `/api/internal/*` |
| `HOST`/`PORT` | 身份服务监听 | 容器内 `0.0.0.0`/`8788`（compose 已设） |
| `STATIC_DIR` | 静态站点目录 | 容器内 `/app/dist`（compose 已设） |
| `MIGRATIONS_DIR` | 迁移目录覆盖 | 默认 `/app/db/migrations`，无需设置 |

`COOKIE_NAME`、`LOGIN_RATE_LIMIT_*`、`DATABASE_CONNECT_TIMEOUT_MS` 等可选变量以身份服务实现为准，
默认值见[内测身份设计](../docs/internal-beta-identity-design.md) §3.1 与源码。

## 9. 验证记录与未完成项（2026-11-10）

已实际执行并通过：

- `node scripts/deploy-check.mjs`：render 28 项 + `.babylon`、`table.json` 摘要、audio manifest 34 项全部通过；
  `node scripts/deploy-check.mjs --prod`：追加 dist、身份服务编译入口、`db/migrations` 共 6 组通过。
- 缺失资源必须失败：临时移走 `public/assets/audio/pocket-jaw-050-1.wav`、`public/assets/physics/table.json`、
  `dist/index.html` 时脚本逐条打印路径并以退出码 1 结束；恢复文件后重新通过（已确认真实文件恢复）。
- `docker compose config`、`docker compose --profile https config`、
  `docker compose -f docker-compose.yml -f deploy/docker-compose.dev.yml config` 均通过。
- 本机 PostgreSQL（127.0.0.1:55432）端到端运行身份服务：`cli.js migrate` 首次应用 1 个迁移、再次运行
  0 应用 1 跳过（幂等）；服务以 `STATIC_DIR=dist` 启动后 `/api/health` 返回 200 `{"ok":true,"database":"up"}`，
  `GET /` 返回 dist 首页，`/assets/audio/manifest.json`、`/assets/physics/table.json` 返回 200，
  `/api/auth/me` 未登录 401，错误凭证登录 401（测试用临时库已删除，未触碰既有库）。
- `node scripts/identity-local.mjs --db local --no-build --vite-port 5174` 真实跑通：迁移 → 身份服务 →
  健康检查 → Vite 就绪且 `/api` 同源反代，Ctrl+C 干净退出。

未验证/未完成：

- **真实远程上线未完成**：无公网服务器、域名、TLS 权限；Caddy 证书申请、80/443 防火墙、DNS 解析均未执行，
  只提供可静态校验的配置。`caddy validate` 也因本机无 Caddy 二进制/镜像未运行。
- **Docker 镜像构建未验证**：本构建机 Docker 镜像注册表（镜像加速）网络被阻止，
  `docker build`/`docker pull postgres:16-alpine` 在执行到基础镜像解析时失败（`docker.rainbond.cc` EOF），
  未能实际产出或运行镜像；`docker build --check` 仅解析了 Dockerfile 结构，随后同样卡在拉取
  `node:22-bookworm-slim` 元数据。
- **`identity-local.mjs --db docker` 未完整跑通**：因同一镜像拉取限制停在 PostgreSQL 启动步骤；脚本按设计
  非零退出并提示。`--db local` 路径已按上述记录验证。
- **未验证**：Compose 中容器化身份服务的实际启动、HTTPS 证书自动续期、真实域名 Cookie 行为、
  `docker stop` 的 10 秒优雅退出预算、限流跨实例、备份恢复演练。
