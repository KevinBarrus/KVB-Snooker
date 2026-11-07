# 联机开发服务器 · 模块章程

继承[全局章程](../../AGENTS.md)；本文件只保留职责、工作约束和必读入口。

## 职责边界

- 仅服务开发原型的 Node 权威房间：每房间一个真实 `Simulator` + 一个 `GameSession`，负责物理推进、规则裁判、版本与去重、唯一一次权威触球。
- 只允许依赖 `src/core/**`、`src/net/protocol.ts` 与 Node 内置模块；禁止导入 DOM、Babylon、浏览器表现层或数据库/账号 SDK。`core` 不得反向依赖本目录。
- 传输（WebSocket、开发令牌、延迟/故障注入）与裁决分离；延迟注入不得阻塞物理循环或改变房间结果。
- 开发席位固定两席、必须经开发令牌，不是正式账号/游客鉴权；默认只监听 `127.0.0.1`，`0.0.0.0` 必须显式且仅限可信开发机。
- 不复制自由球/Miss/900 判罚，不改物理参数、镜头算法或已验收规则；物理台面与调参只读。
- 每房间独立 `MeshBody`/`Simulator`、AI 路线缓存与随机源；模块级共享状态必须先证明不会串扰。

## 修改前必读

- [架构契约](../../docs/architecture.md) §4.8 与 §5。
- [联机开发原型设计](../../docs/multiplayer-prototype-design.md)：命令/版本/去重、出杆时序、延迟注入、双机操作与限制。
- [联机通信与状态同步](../../docs/multiplayer-protocol-design.md)。
- [核心装配章程](../core/AGENTS.md) 与 [联机客户端章程](../net/AGENTS.md)。

## 测试与文档纪律

- 房间裁决用真实 `Simulator`/`GameSession` 与测试台面，不 mock 判分；房间时间由调用方传入 `nowMs`，测试不依赖真实定时器。
- 传输测试用真实 WebSocket 客户端覆盖双客户端、重复命令、两房间隔离与延迟注入；不接受“单页面连接成功”充当联机验收。
- 全量 `npm run test`、`npm run typecheck` 与 `npx vitest run tests/server` 通过后再提交。验收结果写项目状态或原型设计，不把施工日志塞进本章程。
