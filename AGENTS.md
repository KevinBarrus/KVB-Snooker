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

## M1 终端装配

`src/core/game.ts` / `player.ts` / `demo.ts` 为 Node 装配根；章程见 `src/core/AGENTS.md`。`npm run demo` 跑 single play，`npm run demo -- --mode practice` 跑自由练习；读取本地台面数据，不提交 analysis/ 原作文件。

## Render 浏览器验收

`src/app.ts` 为最小浏览器装配根，`src/render/AGENTS.md` 记录分步状态。`npm run assets:prepare` 校验本地原作资源，`npm run dev` 启动，`npm run test:render` 用已有 Chrome 验证；`npm run build` 构建。DOM lib 按 ui/render 目录隔离，core 继续用根 tsconfig 的 ES2022 环境。

render 三步已完成：完整场景与22球只读显示同步。app.ts 装配已有 Simulator 并驱动步进；控制器与交互接入状态见下文。资源准备同时校验物理台面并复制到 public/assets/physics/table.json，原始资源不提交。

## Controller 施工

设计与源码证据见 docs/controller-design.md，单元状态见 src/controller/AGENTS.md。相机/球杆数值控制、键鼠输入、出杆时序、手中球与 AI 接入已完成，球杆/摆球显示及既有 HUD 已接线；完整辅助线已完成（2026-10-24批准的 PredictionContext 只读扩展）；npm run test:gunsight 验证五段显示、交互时序与预测无损。app-game.ts 拆分浏览器装配，npm run test:controller 验证练习与人机回合。controller 使用独立 DOM tsconfig，根核心编译继续无 DOM。

浏览器入口的布局在 src/app.css，模式/难度/新局控件在 index.html，由 app.ts 接线；资源仍仅本地准备，不提交原始资产。

## 观察模式与回放扩展

用户确认的任务与分层见 docs/camera-replay-design.md。三模式共享起身位置轨迹，仅改变焦点；V切换，app-game.ts负责localStorage偏好和UI提示接线。回放通过装配根选择只读显示快照，不修改真实对局；各单元完成后分别提交推送。

app-replay.ts为浏览器回放装配拆分文件，与app.ts/app-game.ts一起从根无DOM编译排除，继续由render工程检查。npm run test:camera验收三模式；npm run test:replay验收摄像机入口、播放控件、真实存档/分数/回合及AI隔离。

AI回合为自由旁观：app-game.ts不启动用户ShotView，也不写其触球状态；实时V仅在human.active时可用，回放保持独立。npm run test:camera:ai检查三种偏好下AI出杆前后视线不跳变、V无效、拖动可用及下一杆玩家观察恢复。

## 规则完善与双人测试

用户已批准分步实施，契约见docs/rules-v2-design.md及architecture.md §4.5。双人规则测试为独立开发工具，正式构建排除，本地可关闭；与正式对局共享规则。先提供标准开局、最后一红、清彩和完整重置，再推进已明确的规则。Miss第二轮已按用户简化标准定稿；测试重置与比赛复位重打不得混用。普通犯规选择与黑球平分现已由GameSession处理，app-game连接轻量选择面板，等待选择时不启动控制器或AI。

回放默认机位已按PCOL L7160-7188修正为全台固定斜俯视，当前球台位置(3.43,2.08,0)，注视(0,.88,.00001)；V只改焦点，重播/进度定位回到全台，保留¼慢放。test:replay同时检查机位稳定和台面四角可见且未被控件遮挡；回放控制条在底部，隐藏重复状态条。

彩球提名由GameSession校验和冻结，app-game连接自动目标提示及手动下拉；AI使用路线目标元数据。原练习/镜头算法不变，提名意图不从事后碰撞反推。

贴球规则通过模拟器只读接触记录实现，World/CCD/求解公式不改；原ShotResult保持兼容。规则区分打离合法目标、打离非目标仍需首碰和直接推杆。

规则扩展已接入普通犯规选择、末黑平分、彩球提名、贴球及自由球；docs/rules-v2-design.md记录验收与边界。自由球判定含D区可达性，UI复用提名控件；Miss与原位重打的第二轮契约见下文。

第二轮规则需求已确认，执行docs/rules-v2-design.md第二轮及architecture §4.6：简化Miss与可复用原位恢复、中央贴球提示、黑球平分预设及非开球方争黑、重开也轮换先手；练习复位按钮暂不接入。

开球轮换恢复PCOL L3700-3714：正式新局及中途重开均交换先手，练习/预设不消费正式序列；本局非开球方直接争黑，取消抽签选择。

Miss UI只在核心授予canReplace时提供“复位，让对手重打”；成功后清回放/旧提示/摆球/动画并重建AI搜索（原位evolution可能与旧搜索相同）。贴球用独立英文中心消息，按犯规消息公式自动关闭且可点×关闭，同杆不重弹，出杆/回放/练习隐藏。
