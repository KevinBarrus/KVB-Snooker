# 联机服务获取内测身份：SessionVerifier

状态：2026-11-10 已登记的窄接口。本文件是未来房间、语音、存档服务从浏览器会话取得稳定用户 ID 和显示名的唯一入口；不改变现有 `src/net` 协议、房间入座或席位绑定。产品范围见 [内测身份与部署](internal-beta-identity-design.md)。

## 1. 接口

```ts
// src/identity/verify.ts
export interface VerifiedIdentity {
  readonly userId: string;       // 稳定 UUID，唯一身份依据
  readonly displayName: string;  // 内测显示名，不含邮箱；可用于房间内展示
  readonly role: "player" | "admin";
}

export interface SessionVerifier {
  verify(token: string): Promise<VerifiedIdentity | null>;
}

export function createDatabaseSessionVerifier(options: {
  readonly pool: Pool;
  readonly now?: () => Date;
}): SessionVerifier;
```

- `token` 是浏览器 Cookie `snk_session` 的值，不是用户 ID、邮箱或自报字段。
- 未登录、会话过期、已退出、已撤销、账号停用或 token 格式非法都返回 `null`，调用方应拒绝进入房间/语音/存档。
- `userId` 是数据库中的稳定 UUID；后续昵称、头像、邮箱变化都不改变它。
- `displayName` 当前取邮箱本地部分（最多 32 字符），不是邮箱全量，也不得写回身份或作为主键。未来昵称资料可在同一 `userId` 上替换显示名；房间应在加入时快照显示名，不自行从浏览器接收。
- 该接口不返回密码哈希、邮箱、会话 token 或数据库对象。

## 2. 两种接入方式

### 2.1 进程内注入（优先）

未来服务端顶层装配创建 `createDatabaseSessionVerifier({ pool })`，把 `SessionVerifier` 注入房间/传输装配；`src/server/**` 仍只依赖接口，不导入 `src/identity/**` 的数据库实现。

浏览器 WebSocket 握手时，传输层读取 `Cookie: snk_session=...`，调用 `verifier.verify(token)`；只有返回非 `null` 才建立已认证连接。房间协议可以把 `userId`、`displayName`、`role` 放进服务器内部 welcome/日志，不得把会话 token 再广播给另一端。

### 2.2 内网 HTTP 校验（独立进程）

设置 `INTERNAL_TOKEN` 后，身份服务提供：

```
POST /api/internal/session/verify
Authorization: Bearer <INTERNAL_TOKEN>
Content-Type: application/json

{ "token": "<snk_session 的值>" }
```

成功 `200`：

```json
{ "userId": "uuid", "displayName": "内测玩家", "role": "player" }
```

失败：

- `401 unauthorized`：内部调用方 Bearer 不对；
- `401 unauthenticated`：会话无效/过期/撤销/停用；
- `400 invalid_request`：body 不是 `{token:string}`；
- `404 not_found`：未配置 `INTERNAL_TOKEN`。

公开反向代理必须屏蔽 `/api/internal/*`；该端点只用于同机/私网服务间调用。`INTERNAL_TOKEN` 不得进入前端构建或 Git。

## 3. 边界与约束

- 浏览器仍只通过 HttpOnly Cookie 认证；不把 `userId` 或 token 放进 URL、localStorage 或前端构建变量。
- 房间、语音、存档只接受服务器校验得到的 `VerifiedIdentity.userId`，不接受客户端提交的身份。显示名只用于展示。
- 现有开发令牌、固定 `seat=0/1` 和 `src/net` 协议在本轮不改变；正式联机接入时由后续单元完成 Cookie 读取、verifier 注入和席位绑定。
- 身份服务不可用时，联机接入必须拒绝连接或显示真实错误，不得回退到开发令牌、默认玩家或匿名身份。

## 4. 验收

- `tests/identity/http-runtime.spec.ts`：内部端点 Bearer、body、无效会话和返回值。
- `tests/identity/accounts.spec.ts`：稳定 UUID、重置/停用后旧会话失效。
- 后续联机单元应新增双客户端验收：两个浏览器会话分别变成不同 `userId`，伪造/过期 Cookie 被拒绝，显示名只读展示。
