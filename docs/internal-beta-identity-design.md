# 内测身份、会话与部署基础

状态：2026-11-10 用户批准的范围；施工中。本文维护两位受邀内测账号的身份服务、数据库、浏览器登录和部署边界。正式注册、邮箱验证、找回密码、游客权限、排行榜、云球形和联机房间绑定不在本轮；正式账号产品规则仍以 [账号与游客](accounts-and-guests-design.md) 为准。

## 1. 范围

- 两位预建内测账号，管理员通过命令行创建；不开放网页注册。
- 邮箱 + 密码登录、`GET /api/auth/me` 查看当前身份、`POST /api/auth/logout` 退出。
- 稳定内部用户 ID、角色和状态由服务器数据库持有；重启不改变 ID。
- 密码使用 Node `crypto.scrypt` 哈希；服务端可撤销 HttpOnly Cookie 会话。
- 登录后可使用现有预设球形、自由练习、我的球形和人机/900 功能。
- 正式构建必须有登录门禁；身份后端不可用时显示真实错误，不自动进入游戏。
- 我的球形仍只保存在本机，但按用户 ID 隔离；旧匿名数据保留并提供手动导入入口。
- 正式双人/联机入口保持不可用，不把开发房间测试包装成好友联机。

## 2. 边界

```
浏览器
  ├─ 静态网页（Vite build）
  ├─ /api/auth/* ───────────────┐
  └─ Cookie Only               │
                               ▼
                      身份服务（Node HTTP）
                        ├─ PostgreSQL 用户/会话
                        └─ 可选静态文件（dist）
                               ▲
未来房间/语音/存档服务 ────────┘
  只通过窄会话校验接口取得 IdentityUser
```

- `src/identity/**` 是基础设施：只依赖 Node 内置模块与 `pg`，不依赖 DOM、Babylon、核心物理、规则、房间或浏览器表现层。
- 身份服务与游戏前端只通过 HTTP 和 Cookie 通信；浏览器不读取数据库，不把长期凭证放进 URL、localStorage 或构建变量。
- `src/server/**` 本轮不导入身份服务或数据库；未来由顶层装配注入会话校验器或调用内部校验接口，房间裁决不直接查库。
- 游戏前端只消费服务器返回的只读身份视图；所有权限判断的最终依据在服务端，前端隐藏入口不能代替服务端拒绝。

## 3. 公开 HTTP 契约

服务基础路径 `/api`，同源部署；响应均为 `application/json`，错误形如 `{ "error": "code" }`。

| 方法与路径 | 请求 | 成功 | 失败 |
|---|---|---|---|
| `POST /api/auth/login` | `{ "email": string, "password": string }` | `200 { user, expiresAt }` 并设置 Cookie | `400 invalid_request`、`401 invalid_credentials`、`429 rate_limited` |
| `GET /api/auth/me` | 无 | `200 { user, expiresAt }` | `401 unauthenticated` |
| `POST /api/auth/logout` | 无 | `204` 并清除 Cookie | 总是幂等 |
| `GET /api/health` | 无 | `200 { "ok": true, "database": "up" }` | `503 { "ok": false, "database": "down" }` |

`user` 为：

```ts
interface IdentityUser {
  readonly id: string;          // 稳定 UUID，后续联机和存档只认这个值
  readonly email: string;       // 仅登录标识，不声明已验证
  readonly displayName: string; // 内测显示名，取邮箱本地部分，不含完整邮箱
  readonly role: "player" | "admin";
  readonly createdAt: string;   // ISO 8601
}
interface IdentitySessionView {
  readonly user: IdentityUser;
  readonly expiresAt: string;   // ISO 8601
}
```

登录失败统一返回 `invalid_credentials`，不区分邮箱不存在、密码错误或账号停用；停用账号不能登录。登录成功、修改密码、停用账号都使旧 Cookie 无法继续使用。

### 3.1 Cookie

- 名称默认 `snk_session`，随机 32 字节 token；数据库只保存其 SHA-256。
- `HttpOnly; Path=/; SameSite=Lax; Max-Age=<SESSION_TTL_SECONDS>`；`COOKIE_SECURE=1` 时加 `Secure`。
- 会话在服务器端有 `expires_at`；退出、改密和停用都会撤销。
- 只接受 Cookie，不接受从 query、请求体或前端构建变量传来的身份。

### 3.2 请求保护

- 仅同源：若请求带 `Origin`，必须匹配 `PUBLIC_ORIGIN`；未配置时要求 Origin 的 host 与请求 Host 一致。跨源请求拒绝。
- `POST` 要求 `Content-Type: application/json`，请求体上限 16 KiB。
- 登录限流：按来源 IP + 邮箱固定窗口，默认 10 次 / 15 分钟；失败响应带 `Retry-After`。成功登录清空该键。进程重启会清空内存限流，作为单实例内测的可接受限制记录。
- 来源 IP 仅在 `TRUST_PROXY=1` 时读取 `X-Forwarded-For` 的最左值；否则使用 socket 地址。
- 日志只记录方法、路径、状态、耗时和来源地址，不记录 Cookie、请求体、密码、邮箱或数据库 URL。

## 4. 数据库

只建本轮必要表，迁移文件位于 `db/migrations/`：

```sql
users (
  id uuid primary key,
  email text not null unique,          -- 存储 trim + lowercase
  password_hash text not null,         -- scrypt$N$r$p$salt$hash
  role text not null default 'player' check (role in ('player','admin')),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
sessions (
  token_hash text primary key,         -- sha256(session token)
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
)
```

索引：`sessions(user_id)`、`sessions(expires_at)`。不提前创建排行榜、比赛存档、高光或云球形表。

迁移由 `schema_migrations(version text primary key, applied_at timestamptz)` 记录；按文件名排序，每个迁移在事务中执行，重复运行跳过已应用版本。回滚是恢复到上一应用版本并配合数据库备份，不是删库重建；具体操作见 §7。

## 5. 身份与管理员命令

命令入口统一为 `node .cache/identity/identity/cli.js <command>`，由 `npm run identity:*` 包装：

| 命令 | 行为 |
|---|---|
| `migrate` | 应用未执行迁移；可重复运行 |
| `create-user --email <email> [--role player|admin]` | 不存在时隐藏输入密码并创建；存在时只打印已有用户 ID，不覆盖密码 |
| `reset-password --email <email>` | 隐藏输入两次新密码；更新哈希并撤销该用户全部旧会话 |
| `disable-user --email <email>` | 设 `disabled` 并撤销全部旧会话 |
| `enable-user --email <email>` | 恢复 `active`，不恢复旧会话 |
| `list-users` | 只输出 id、email、role、status、created_at；不输出哈希 |

密码通过 `readline` raw-mode 隐藏输入；拒绝空密码；不使用命令行参数传密码，不写日志。初始化两个账号用两次 `create-user`，重复运行安全。

## 6. 部署

优先同源 HTTPS。两种运行方式共用同一服务代码：

- 本地：Docker Compose 启动 PostgreSQL；Node 身份服务监听 `127.0.0.1:8788`；Vite dev 通过 `/api` 代理到 8788。正式构建验收时身份服务直接服务 `dist` 和 `/api`。
- 生产：Docker Compose 启动 PostgreSQL + 身份服务；Caddy/Nginx 终止 HTTPS，反向代理到身份服务。只暴露 80/443，数据库和身份服务不映射公网端口。
- 数据卷持久化 PostgreSQL；容器重启不丢失账号或用户 ID。
- `public/assets/**` 在 Git 外；部署前在构建机执行 `npm run assets:prepare` 和 `npm run audio:install`，`npm run deploy:check` 校验资源，再 `npm run build`。缺失资源明确失败，不用占位图冒充。
- 配置全部来自环境变量或受控 env 文件；仓库不提交 `.env`。`deploy/production.env.example` 只放占位符。
- 健康检查：`GET /api/health` 同时检查数据库；反向代理和容器使用该入口。
- 更新：拉取代码 → 准备资源/构建镜像 → `identity:migrate` → 切换容器；回滚使用上一镜像并恢复迁移前备份。文档不写“删库重建”。

## 7. 后续联机取用户 ID

未来房间/语音/存档服务不得直接相信浏览器提交的 `userId`。身份服务提供窄校验边界，完整接口登记在 [identity-session-verifier.md](identity-session-verifier.md)：

- 首选：在进程内注入 `SessionVerifier`，校验 `snk_session` Cookie token 并返回 `VerifiedIdentity { userId, displayName, role }`；调用方只依赖接口，不依赖数据库实现。
- 独立服务进程：设置 `INTERNAL_TOKEN` 后，身份服务提供仅内网可用的会话校验端点；未设置时该端点不存在。公开反向代理必须屏蔽 `/api/internal/*`。
- 房间、语音和存档只使用返回的 `userId`，不保存邮箱作为身份；`displayName` 可用于展示，当前由邮箱本地部分派生，房间加入时应快照。本轮不修改 `src/net` 或 `src/server` 协议、席位或房间入座逻辑。

## 8. 浏览器与本地球形

- 正式构建默认要求登录；开发构建默认关闭门禁以保留现有无登录浏览器测试。需要本地登录演练时设 `VITE_AUTH_REQUIRED=true`。生产构建不得关闭门禁。
- 登录成功后主菜单显示当前邮箱和退出入口；退出调用服务端撤销会话后整页重载，清空受保护 UI 和运行状态。
- 身份服务不可用、返回 5xx 或网络失败时，登录页显示真实错误并提供重试，不进入游戏。
- 本地球形键按用户 ID 命名空间隔离：`snk.user.<userId>.practice.shapes.v1`。旧匿名键 `snk.practice.shapes.v1` 保留，不删除、不自动归给第一个登录账号；我的球形页面提供手动导入旧数据的入口。
- 未登录状态下不创建本地球形；正式双人入口在正式构建中明确禁用，`enterCreatedMatch`/`enterJoinedMatch` 在状态层拒绝。

## 9. 验收

自动：

- 单元：密码哈希/校验、Cookie 解析与标志、邮箱规范化、登录限流、请求 Origin 校验。
- 真实数据库集成：迁移幂等、两账号不同稳定 ID、重复 create-user 不重建/不改密码、重置密码和停用使旧会话失效、重启服务后账号仍存在。
- HTTP：正确/错误/空凭证、未登录受保护接口、登录后刷新 `/me`、退出后旧 Cookie 失效、后端停库时返回受控错误。
- 正式构建浏览器：登录 → 菜单 → 预设球形真实出杆、自由练习、人机玩家+AI+计分、900 起表出杆、自建球形保存/刷新打开、两个账号本地球形隔离、退出登录清场、身份后端不可用不绕过登录。
- 现有 `npm run test`、`npm run typecheck`、`npm run build` 和受影响浏览器专项保持通过。

限制与未完成：

- 无公网服务器时只完成本地/部署配置演练，真实远程上线待服务器、域名和权限具备后执行。
- 未做开放注册、邮箱验证、找回密码邮件、头像/国家、游客指南、云球形、排行榜、高光、正式联机绑定。
- 登录限流为单实例内存实现；多实例部署需改共享存储，见未来运维事项。
