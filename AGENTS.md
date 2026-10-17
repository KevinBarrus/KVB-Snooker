# KVB-Snooker · 全局工作章程

PCOL（tq.ztr8.uk 斯诺克游戏）的 1:1 复刻项目。

> 阅读顺序：本文档 → `docs/architecture.md`（接口与施工契约）→ 本目录下辖的模块章程。

## 铁律

1. **依赖方向**（详见 `docs/architecture.md` §2）：`ui/audio/controller/render → ai/rules/simulator/physics/math`，只许上层依赖下层；表现层访问 core 的唯一通道是 `Simulator` 接口 + `EventBus`。
2. `src/core/**` 禁止 import 任何 DOM / Babylon.js / 网络库；必须可在 Node 下运行。
3. 不用默认导出（`app.ts` 装配根除外）；接口唯一来源是 `docs/architecture.md`，实现不得擅自增删公开签名。

## 事实来源（写代码前必读对应章节）

| 内容 | 出处 |
|---|---|
| 接口契约 / 分层 / 验收 | `docs/architecture.md` |
| 物理算法与常量 | `docs/spec/01-物理内核.md` |
| 击球链路 | `docs/spec/02-击球链路.md` |
| 台面/袋口几何 | `docs/spec/03-袋口几何.md` |
| 相机/走位 | `docs/spec/04-相机走位.md` |
| 斯诺克规则 | `docs/spec/05-规则引擎.md` |
| AI | `docs/spec/06-AI.md` |
| 游戏流程/模式 | `docs/spec/07-游戏流程.md` |
| 手中球（D 区） | `docs/spec/08-手中球D区.md` |

原作源码的真实性判据：`analysis/1.chunk.js` 的行号（禁止把 `analysis/` 原作文件提交进仓库，已在 `.gitignore` 排除）。

## 工程规范

- TypeScript strict；禁 `any`；单文件 ≤400 行；命名用语义英文，与原作 mangled 名对照关系可在注释中以 `// PCOL L8500-8778` 形式标注
- 注释纪律：只标注"此算法来自原作何处"，其余靠命名；不复述显而易见的逻辑
- 提交：Conventional Commits（`feat:` / `fix:` / `docs:` / `test:` / `refactor:` / `chore:`），每个模块小单元完成即提交并推送
- 测试：`npm run test`（Vitest）与 `npm run typecheck` 必须全绿才可提交
- 修改某模块时必须同步该目录的 `AGENTS.md`（同一个提交内）

## 施工期顺序

math → physics → simulator → rules → ai（里程碑 M1：Node 终端跑通回合权机对局）→ render → controller → ui → audio。扩展规划见 `docs/09-扩展规划.md`。
