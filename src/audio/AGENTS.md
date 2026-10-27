# audio · 音效表现层章程

## 职责边界

- 只通过 `core/event-bus.ts` 消费事件；不 import core 内部实现、DOM、Babylon、ui/render/controller 或音频库。
- mixer 生成只读纯数据播放决策；`SoundBackend.play` 接收决策，默认 no-op。资产、实际发声与事件发布由集成方接入。
- 本模块不改核心状态、不增加事件或载荷字段，不把 `sim/shooting-start` 当作皮头撞击事件。

## 文件

| 文件 | 内容 | 依据 |
|---|---|---|
| mixer.ts | 接触音色、响度映射、SoundBackend 与 no-op 实现 | 规格 02 §7、EventBus 契约；项目映射见下文 |
| hooks.ts | 碰撞、出界、犯规事件订阅与释放 | EventBus 契约、HUD 订阅模式 |

## 施工单元状态

- [x] mixer：纯播放决策与 no-op 后端。
- [x] hooks：事件触发与订阅清理。
- [x] 验收：audio 21 项、全量 222 项测试通过；`npm run typecheck` 通过。

## 事件映射

| 事件 | 播放决策 |
|---|---|
| `sim/touch-presolve` | `mixContact` 生成音色与响度；仅 volume>0 才调用后端 |
| `sim/out-of-bounds` | 通用 out-of-bounds，volume=1 |
| `game/foul` | foulCode≠0 时一次 foul，volume=1；组合位不重复播放 |

`new AudioHooks(backend).attach(bus)` 接入；省略 backend 使用 no-op。`detach()` 释放全部订阅，可重复调用；重新 attach 先释放旧订阅，避免重复播放。只订阅上述三种事件。

## 转写时新发现的怪癖（不可"改进"）

1. 普通接触 label 是 `idi + "->" + idj`，不是材质名（PCOL L9426-9428）；皮头 label 固定 `tip`，且 isSS=false（L13650-13655）。按 tip 优先，其余按 isSS 分类，不能把所有 false 都当普通球库碰撞。
2. touchPresolveHandler 仅在新接触 life=0、startResting 后调用；持续接触走 markRecheck（L12091-12094）。audio 按事件播放，不自行按帧补发或去重。
3. World.shoot 直接求解 TipContact 并释放，没有调用 touchPresolveHandler（L11864-11870）。集成方若需皮头声，必须在相应时机提供现有契约的 tip 接触事件。
4. Simulator 通过 end 接触记录 POTTED、tunnel 接触记录 PREPOT，另由 outOfBoundsHandler 记录 OUT_OF_BOUNDS（L12351-12365）；进袋与出界不是同一事件。

## 项目映射与登记差异

- 规格 01 §4.2、02 §7 提供声音挂载点，没有给出音量曲线、素材名或音量系数。以下为用户确认的项目策略，不声称是原作算法；源码行号仅标注对应接触语义。
- `mixContact` 选择 tip / ball-ball / ball-cushion；响度为 `min(1, max(abs(speedI), abs(speedJ)))`。非有限速度令整次接触静音；零速度输出 volume=0。输入保持只读，结果为新对象。
- 归一化意味着速度达到 1 后响度饱和；素材接入时仍需校准，不能把当前系数当作已还原的原作常量。
- 规格 02 §7 将 outOfBoundsHandler 列为进袋钩子，但原作区分进袋/出界，且 EventPayloads 的出界载荷只有 ballIndex/ballNumber，没有袋区 label。沿用冻结契约，仅产生通用 out-of-bounds 提示，不推断袋口或进袋。
- 出界与犯规提示固定 volume=1 是项目占位映射。犯规提示是本次任务新增播放策略；PCOL L8012-8016 只能证明 UI 犯规消息，不能证明原作有犯规音效。事件载荷没有 ballOn，本层不推断终局状态，也不复用 UI 的终局抑制逻辑。
- 原作素材未提供，no-op 后端不发声；本模块不会下载或提交 analysis/ 内容。

## 测试

`src/audio/__tests__/smoke.test.ts`：21 项测试，覆盖纯函数映射、正负双侧速度、饱和/静音、非有限速度、只读输入、真实 EventBus 到 stub 后端的三种接触音色与出界/犯规提示、订阅释放与重绑、默认 no-op。Node 下运行，不依赖 DOM / Babylon。

## 完成定义（DoD）

`npm run test`、`npm run typecheck` 全绿；代码、测试和本章程同一模块提交并推送。

## 第一版真实音效（2026-10-27 用户授权扩展）

旧 mixer/hooks 的无素材调用保持兼容；传入 SampleMixer 后 AudioHooks 仅订阅 sim/impact，不播放犯规/出界占位音。sound 决策增加 pocket-clean/pocket-jaw 及可选 AudioSample；sound backend 仍只接受决策，不判定物理。

sample-mixer.ts 按实际击点和力度选 cue 组、按相对闭速度选 ball 组；同组洗牌，跨轮不连续重复。相邻力度档概率连续过渡，音量连续变化。calibration.ts 集中维护曲线、击点分档、袋口历史时空窗口、主增益与混音参数，sample-manifest.ts 校验资产边界；不依赖 coreRandom 或表现层横向模块。

browser-backend.ts 是本轮批准的浏览器薄后端，独立 audio/tsconfig 开 DOM，根 Node 编译仅排除此文件。预解码 AudioBuffer、用户手势恢复 AudioContext、有限并发声部、主音量及压缩器防连续碰撞叠加过响；dispose 释放源/连接/请求/context。app-audio.ts 装配加载、音量持久化、生命周期，不阻塞无音频时的对局。

原 local-audio 与生成 public/assets/audio 不提交。npm run audio:prepare 使用 scripts/audio-sources.json 的分类和 SHA-256 校验复制，测量最响20ms窗口RMS，按配置生成最多±6dB的播放增益以及起音前3ms的播放偏移；原文件完全不变，不降噪、不补尾音。响度档标签来源于用户目录，不从已归一化文件峰值推断出杆力度。

### 转写时新发现的怪癖

- pocket 标志是袋喉内壁，不是磕袋角；sidesoft 才用于袋角历史，必须满足时间/距离邻近，不能见 pocket 就当磕袋角。
- tunnel 会连续多次接触，end 更晚才负责进袋计分；声音首次 tunnel 播放一次，end 只兜底，保留首次近期 pocket 接触前水平速度。母球/子球均使用自身速度，不受竖直下落速度影响。
- sim/shooting-start 是后拉开始，不能播放皮头声；实际 cue 事件由 Simulator.stroke 产生。

首版回放静音；切新局、复位、回放和销毁不保留旧声音。未新增长短台/抬杆/起跳/普通碰库音，也没有修改物理或摄像机算法。自动化只能验证信号、时序和数值，听感由用户试听验收。

验收完成：新增13项纯策略/清单测试，全量401项通过，typecheck/build通过；Chrome audio/controller/rules/replay通过。audio专项实测79段解码、实际输出非零且峰值<1、皮头触球时序、球球/空心/磕袋角/子球入袋、轻推进袋静音、音量持久化、预测/回放隔离和缺资产降级。校准后使用surface.entrySpeed，horizontalSpeed只保留即时证据。
