# 身份服务 · 模块章程

继承[全局章程](../../AGENTS.md)；本文件只保留职责、边界和必读入口。

## 职责边界

- `src/identity/**` 是 Node 身份基础设施：PostgreSQL 用户/会话、密码哈希、HttpOnly Cookie、登录限流、管理员 CLI、可选静态文件和内网会话校验。
- 只依赖 Node 内置模块与 `pg`；不得导入 DOM、Babylon、`src/core/**`、`src/net/**`、`src/server/**` 或浏览器表现层。核心、房间和联机裁决不反向依赖本目录。
- 浏览器只通过同源 `/api/auth/*` 和 Cookie 访问；不在 URL、localStorage、前端构建变量或日志中保存长期凭证。
- 未来房间/语音/存档通过 `src/identity/verify.ts` 的 `SessionVerifier` 或内网端点取得 `VerifiedIdentity { userId, displayName, role }`；不把数据库或账号 SDK 塞进 `src/server/**`。契约见 [identity-session-verifier.md](../../docs/identity-session-verifier.md)。
- 本轮只支持两个预建内测账号，不做开放注册、邮箱验证、找回密码、游客权限或完整个人资料。

## 修改前必读

- [内测身份、会话与部署](../../docs/internal-beta-identity-design.md)
- [架构 §4.14](../../docs/architecture.md#414-内测身份会话与部署2026-11-10-施工契约)
- [联机会话校验](../../docs/identity-session-verifier.md)
- [部署说明](../../deploy/README.md)
- [开发操作](../../docs/development.md)

## 测试与文档纪律

- 密码用 `crypto.scrypt` 和 `timingSafeEqual`；会话 token 随机生成，数据库只存 SHA-256。
- 登录错误不泄露账户细节；退出、改密和停用必须撤销对应旧会话；日志不得包含 Cookie、请求体、密码、邮箱或数据库 URL。
- 真实数据库测试使用 `TEST_DATABASE_URL` 和独立 schema；不 mock 数据库或判分。迁移、CLI、HTTP 和会话撤销都要有真实测试。
- 全量 `npm run test`、`npm run typecheck` 与身份专项通过后再提交；验收结果写项目状态或设计，不把施工日志放进本章程。
