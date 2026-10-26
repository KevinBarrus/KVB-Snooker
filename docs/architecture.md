# KVB-Snooker 架构契约（Architecture Constitution）

> 本文档是所有编码工作的最高约束：接口、依赖方向、验收标准以本文为准。
> 依据：`docs/spec/00-06` 六份还原规格。任何实现与规格冲突时，以规格文档的行号证据为准。
> 日期：2026-10-17

## 1. 技术栈与基本决策

| 项 | 决策 | 理由 |
|---|---|---|
| 语言 | TypeScript（strict，禁 `any`） | 接口即契约，跨模块协作靠类型 |
| 渲染引擎 | Babylon.js | 与原作一致，03 号规格的灯光/材质参数直接可用 |
| 构建 | Vite | 标准配置即可 |
| 测试 | Vitest（核心层必须有单测 + 黄金测试） | 模块验收的唯一标准 |
| 未来 Steam | **本决策已天然支持**：core 层零 DOM 依赖，未来包一层 Tauri/Electron 即可本地运行。现在不做任何额外设计 | 不过度设计 |

## 2. 架构分层与依赖规则（铁律）

```
─── 表现层（可 import Babylon/DOM）────────────
  ui / audio / controller / render
─── 模拟核心（禁 import Babylon/DOM，Node 可跑）─
  ai / rules / simulator / physics / math
──────────────────────────────────────────────

依赖方向：只允许上层 import 下层，禁止反向。
表现层访问核心的唯一通道：
  1. Simulator 接口（§4.2）
  2. EventBus（§3）
违反此规则的 PR 一律不合并。
```

## 3. 事件目录（EventBus，唯一跨层通信方式）

| 事件名 | 载荷 | 发生源 → 消费方 |
|---|---|---|
| `sim/shooting-start` | `{ playerIndex }` | simulator → controller/ui/audio |
| `sim/touch-presolve` | `ContactEvent`（label、双方相对法向速度、isSS） | world 回调 → **audio（声音挂载点）** |
| `sim/out-of-bounds` | `{ ballIndex, ballNumber }` | world 回调 → rules（计分）/audio |
| `ai/shot` | —（走同一击球管线） | ai 控制器 → simulator |
| `ctrl/state-change-start/end` | `{ from, to }` | controller → render/ui |
| `game/ball-on-changed` | `{ ballOn, inHand }` | rules → ui（目标球指示） |
| `game/foul` | `{ foulCode, description, score }` | rules → ui/audio |
| `game/frame-events` | `{ potted, respotted,… }` | rules → ui |

EventBus 实现放 `core/event-bus.ts`：`on/off/emit`，类型化载荷，≤100 行。

## 4. 核心接口契约（TypeScript）

### 4.1 数学库 `src/core/math/`

从规格 01 §3 实现的方法全集（语义 1:1，含原作怪癖；怪癖清单见 `src/core/math/AGENTS.md`）：

```ts
export class Vec3 {
  x: number; y: number; z: number
  static readonly ZERO / UNIT_X / UNIT_Y / UNIT_Z: Vec3
  static readonly EPSILON: number          // 1e-6
  constructor(x?, y?, z?)
  // 基础
  set(v3) / setZero() / copy(v) / copyNeg(v) / clone()
  toArray(target, offset) / fromArray(source, offset?) → 3
  // 度量
  length() / lengthSq() / distanceTo(v) / distanceToSq(v) / dot(v) / isZero()
  normalize() (零向量→全0) / normalizeVector(v) (安全)
  almostZero(eps?) 默认 EPSILON / almostEquals(v) 阈值固定 EPSILON，无参重载
  // 组合
  add(v) / addScaled(v, s) / addVectors(a, b) / sub(v) / subVectors(a, b) / interpolate(a, b, ratio)
  scale(s) / scaleVector(s, v) (标量在前) / multiply(v) 逐分量 / negate() / lerp(v, r)
  cross(v) / crossVectors(a, b) / setCrossThenAdd(a, b, c)   // this = a×b + c，整体覆盖
  applyQuaternion(q) / vectorApplyQuaternion(p, q)            // 标准右手系主动旋转
}

export class Matrix3 {                        // Float32Array(9)
  data: Float32Array
  // 语义约定：set(9参) 落位后 transform 的有效矩阵是参数矩阵的转置；
  // multiply 以存储块为行主序自洽，含原作自乘别名行为（AGENTS 怪癖 4）
  set(9参) / identity() / copy(m) / clone() / fromArray(arr, o?) → 9 (原始按序拷贝)
  toArray(target, offset) / toString()
  transform(v, out) / transformTranspose(v, out)
  multiply(m) / multiplyScalar(s) / add(m) / addToDiagonal(d)
  setInverse(m) (奇异→warn+identity) / setTranspose(m) / transpose()
  setSkewSymmetric(v) ([v]×) / setComponents(a, b, c) (无返回值)
}

export class Quaternion {                     // (x, y, z, w)
  constructor(x?, y?, z?, w?)                 // 默认 identity
  set(x, y, z, w) / copy(q) / clone() / toArray(...) / fromArray(...) → 4 / toString()
  setFromAngleAxis(axis, angle)
  setFromEuler(x, y, z, order?) 缺省序=XYZ；六序可选；未知序抛 "Unknown order"
  normalize() (零长度→重置(0,0,0,1)，区别于 Vec3)
  integrate(w, dt) (q + ½·dt·(ω⊗q) 后归一) / integrateQuad(q, wPrev, dt)
  slerpQuaternions(a, b, t) (无返回值，写入自身)
  multiply(q) (this = this ⊗ q)
}
```

### 4.2 模拟核心 `src/core/`

```ts
// ---- 数据契约 ----
/** 击球参数 e[0..7]，规格 02 §4：皮头触点(3) + 方向(3) + 击球速度标量 + 皮头半径 */
export type StrokeVars = Float32Array // length 8

/** 一杆结果（原作模 50 clearResult 字段，规格 02 §4） */
export interface ShotResult {
  nKissed: number
  firstKissIndex: number            // 0 = 无碰撞
  pottedIndices: number[]           // 进袋球索引列表
  outOfBoundsIndices: number[]      // 出界球索引列表
}

/** 世界序列化（规格 01 §4.4：determinism 保障） */
export interface SerialData { balls: number[]; mbid: string; evolution: number }

// ---- World（物理棋盘，规格 01 §4） ----
export interface WorldContactEvent { label: string; isSS: boolean; relNormalSpeed: number }

export interface World {
  readonly evolution: number
  reset(): void
  setMeshBody(mesh: MeshBody): void
  addBall(ball: Ball): void
  shoot(cueIndex: number, vars: StrokeVars): void   // 原作 shoot(t, e)
  step(dt: number): number                          // 返回本帧模拟时间（s×stepSize）
  serialize(data: SerialData): SerialData
  deserialize(data: SerialData): void
  onTouchPresolve(cb: (e: WorldContactEvent) => void): void
  onOutOfBounds(cb: (ball: Ball) => void): void
}

// ---- Ball ----
export interface Ball {
  readonly index: number; readonly number: number   // 0=母球，1..7 斯诺克
  active: boolean
  readonly position: Vec3; readonly spot: Vec3
  readonly radius: number
  serialize(balls: number[]): void                  // 规格 01 §4.4
}

// ---- MeshBody（台面碰撞体，规格 03；id 由加载缓存赋值=任务名，spec 03 §1） ----
export interface MeshBody {
  id: string
  readonly nPolygons: number
  readonly nEdges: number
  readonly groups: PolyGroup[]            // name 见 STRUCTURAL_ORDER: ground/side/tunnel
  readonly ground: CollisionPolygon | null
  readonly lowestPosition: Vec3           // 落袋判定阈值（实测台面 y≈0.6033）
  getGroupByName(name: string): PolyGroup | null
  getPolygonByID(uid: number): CollisionPolygon | null
  slice(name: string): { groups: PolyGroup[] }   // 原作鸭子类型：WorldClient 预测只留 ground
}

// ---- Simulator（模 50 等价：表现层唯一入口） ----
export interface SimulatorListener {
  onTouchPresolve(e: WorldContactEvent): void
  onOutOfBounds(ballIndex: number): void
}
export interface Simulator {
  stroke(vars: StrokeVars): void                    // 击球（清结果→shoot）
  step(dt: number): number                          // 物理步进 + 结果累计
  getResult(): Readonly<ShotResult>
  getCueBallPosition(): Readonly<Vec3>
  getBallCount(): number
  getBallView(i: number): BallView                  // 表现层只读视图
  reset(hard: boolean, respot: boolean): void
  serialize(): SerialData; restore(data: SerialData): void
  predict(vars: StrokeVars, maxDist?: number): PredictionContext // 无损瞄准预测（规格 02 §6）
}
export interface BallView {
  index: number; number: number; active: boolean; position: Vec3; async: boolean
  readonly renderPosition: Readonly<{ x: number; y: number; z: number }>
  readonly renderOrientation: Readonly<{ x: number; y: number; z: number; w: number }>
}
export interface PredictionContext {
  impactV1: Vec3; impactOccured: boolean /* 原作字段名 */
  readonly p0: Readonly<{ x: number; y: number; z: number }>
  readonly p1: Readonly<{ x: number; y: number; z: number }>
  readonly cue: Readonly<{ x: number; y: number; z: number }>
  readonly cueVSq: number
  readonly p2: Readonly<{ x: number; y: number; z: number }>
  readonly target: Readonly<{ x: number; y: number; z: number }>
  readonly targetVSq: number
  readonly targetNumber: number
  readonly hasImpactTarget: boolean
}

// ---- 规则引擎（规格 05） ----
export interface RulesContext { inHand: 0 | 1 | 2; ballOn: number; playerIndex: number; nRounds: number }
export interface Ref {
  syncAreaWithSimulator(sim: Simulator): void
  resetGContext(ctx: RulesContext): void                 // 默认 inHand=2, ballOn=RED(2)
  checkResult(ctx: RulesContext, sim: Simulator, out: { score: number; foulCode: number }): void
  readonly sysReservedBallOn: number                     // 65535（编辑器/自由练习）
  placeCueBallCheck(x: number, y: number, z: number, sim: Simulator): boolean // reqRespotCueball 校验
}
export const FOUL = { MISS_TARGET: 1, ILLEGAL_FIRST_HIT: 2, ILLEGAL_POTTING: 4, POTTING_CUE_BALL: 8, OFF_TABLE: 16 } as const

// ---- AI（规格 06） ----
export interface AIProfile { name: string; level: number; range: number; abf: number; bcf: number; chaoticSeed: number; mpm: number; bpm: number }
export interface AIController { /* 挂在controller层状态机上的AI大脑：详见投喂包 */
  checkRestart(sim: Simulator, ctx: RulesContext): boolean
  step(view: GameView, sim: Simulator): AIRoute | null
}
export interface AIRoute { dx: number; dy: number; dz: number; fbSpin: number; powerFactor: number; priority: number }
```

**表现层数据只读原则**：`BallView`/`PredictionContext` 是控制器/渲染可感知的全部核心状态，禁止把 `World`/`Vec3` 内部引用直接交给渲染层改写。

**BallView 显示快照（2026-10-19 用户批准扩展）**：`position` 保留物理位置拷贝；`renderPosition` / `renderOrientation` 为独立的只读数值快照，分别取原作 `states.position` / `states.orientation`（PCOL L1886-1900）。正常 `step` 复用 WorldClient 的剩余时间外推（L14706-14714）；构造、重摆及显式 `restore` 后，在下一次步进前按物理姿态同步显示状态。`stroke` 不立即移动姿态，`predict` 保留预测前显示状态。存档格式不变，不增加显示状态或剩余时间字段。

**PredictionContext 辅助线快照（2026-10-24 用户批准扩展）**：新增9个只读字段，源于 PCOL L14626-14681。位置为普通对象副本，不暴露刚体引用；`p1` 仅在 `impactOccured` 时有效，`p2/target/targetVSq/targetNumber` 仅在 `hasImpactTarget` 时有效。保留无撞击时未清空旧值的原作行为，显示层按标志取用；物理算法与存档格式不变。

### 4.3 物理台面数据 `public/assets/physics/table.json`

直接采用原作 `tiger-club-sno-rgb.json`（`04acfb24…`）格式：

```ts
interface CollisionMeshData {
  [group: string]: {
    p: number[]                       // 顶点 xyz 平铺
    q: { i: number[]; n: [number,number,number]; f: string[]; s?: number[]; uv?: number[] }[]
    nt?: string                       // 法线图（render 层可忽略；core 只用 p/q/f）
  }
}
```


### 4.4 击球观察与回放扩展（2026-10-24 用户批准）

需求与施工契约见 `docs/camera-replay-design.md`。自然起身、母球/子球观察共享原有相机位置轨迹，只改变视线焦点；V切换、短提示与偏好保存由表现层及装配根完成。

controller可新增观察/回放状态类及装配回调；ui只接受普通状态值与回调；render继续消费`Pick<Simulator, "getBallCount" | "getBallView">`结构视图，装配根切换实时与录制快照。上一杆回放不写回真实模拟器，不推进真实回合或AI。§3事件、§4.2核心接口与序列化格式不变。

实现边界：`ShotView`/`FocusSmoothing`仅输出焦点，`CameraRig.position`仍由原站立/瞄准过渡驱动；`ShotReplay`提供begin/record/finish与open/update/toggle/seek/restart/close，通过getBallCount/getBallView/getResult输出复制的播放快照。ReplayFrame记录time、balls、eye、target、aimRatio、firstKissIndex、struck及cue姿态。`BrowserReplay`为装配根，连接独立Input、ReplayControls与实际TargetCamera；真实BrowserGame.update在回放期间不调用AI或Simulator.step。2026-10-25批准修正：BrowserReplay默认固定原作全台机位，V仅改变焦点；自然焦点与起身过渡同步到位，FocusSmoothing同时约束水平和俯仰转动。

### 4.5 规则完善与开发测试装配（2026-10-26用户批准）

分步契约见`docs/rules-v2-design.md`。规则完善为用户批准的原作扩展；Miss判定另行定稿。正式规则与开发测试共用核心，核心不得导入测试工具。

首单元新增`GameOptions { players?: readonly ("USER" | "AI")[]; setup?: FrameSetup }`，用于`GameSession(simulator, mode?, options?)`与`BrowserGame.setMode(mode, difficulty?, options?)`。`FrameSetup { balls: readonly { index: number; x: number; z: number; active: boolean }[]; ballOn: number; inHand: 0 | 1 | 2; playerIndex: number; scores: readonly number[] }`。GameSession.reset完整恢复初始配置，不增加正式GameMode值；Simulator/ShotResult不变。

PersonController.playerIndex可在非出杆阶段重绑，新增只读locallyControlled构造参数区分本地玩家与AI。ShotController依据此标志管理本地观察与输入锁；不改变CameraRig/ShotView算法。开发装配`src/devtools/`通过DEV条件动态加载，VITE_RULES_TEST=0可关闭；浏览器类型仅由render工程检查。

终局与普通犯规扩展：`GAME_STATE.DECIDING=32`；`GameSession.decision: Readonly<{kind:"foul"|"black";playerIndex:number}>|null`提供选择权快照，`chooseNextPlayer(playerIndex:number,nextIndex:number):boolean`仅允许持权者在待选择阶段决定下一位。普通犯规仅从当前位置继续，不恢复台面；黑球平分抽签后选择下一位并获得D区手中球。`getScore(index:number):number`按现有负penalty计算总分；`winnerIndex:number|null`仅在已结束且非平分时有值。reset清空待选择状态。UI只消费文案/按钮回调，装配根负责命令；AI选择自己接手，Node演示同样显式处理选择。

提名扩展：`RulesContext.nominatedBallIndex?:number`为本杆冻结的彩球索引，不改变阶段ballOn。`GameSession.nominate(playerIndex:number,ballIndex:number|null):boolean`手选/恢复自动；`getNomination(dx:number,dz:number):{required:boolean;ballIndex:number|null;manual:boolean}`返回意图快照；`prepareStroke(playerIndex:number,vars:StrokeVars):boolean`在动画开始前冻结意图，stroke也调用此校验以覆盖Node。不明确时拒绝开始而不罚分。`AIRoute.ballBIndex?:number`暴露已有路线目标元数据，安全球/翻库/随机解围也记录意图，拟人误差不能改变提名。UI仅接受选项/文案和回调。

接触证据扩展：`Simulator.getContactEvidence():ContactEvidence|null`返回复制的`{touchingIndices:readonly number[];firstContactIndices:readonly number[];pushedIndices:readonly number[]}`；RefSimulator可选消费同结构方法，旧ShotResult不改。模拟器内观察Solver.solveContact前后速度及接触时位置，不改冲量/积分/休眠/CCD；predict隔离，reset/restore清空。接触容差1e-5m，水平方向速度变化阈值1e-7m/s；firstContactIndices记录同evolution、同母球位置的第一组实际接触。`FOUL.PUSH_STROKE=32`。`GameSession.touchingBallIndices`为杆前贴球索引只读快照，UI提示打离要求；合法贴球满足首触义务，非目标贴球不免除首触义务。

## 5. 目录结构（骨架）

```
src/
├── core/                    # 零 DOM，Vitest 直接跑
│   ├── event-bus.ts
│   ├── math/                # vec3.ts quaternion.ts matrix3.ts
│   ├── physics/             # constants.ts body.ts ball.ts contact.ts tip-contact.ts
│   │                        # collision-polygon.ts mesh-body.ts solver.ts island.ts world.ts
│   ├── simulator/           # shot-result.ts simulator.ts（模50 等价）
│   ├── rules/               # foul.ts region.ts snooker.ts
│   └── ai/                  # route-cache.ts task-pipeline.ts profiles.ts
├── render/                  # scene.ts table.ts balls.ts materials.ts light-probes.ts
├── controller/              # person-controller.ts stick-controller.ts camera-rig.ts input.ts ai-runner.ts
├── ui/                      # hud.ts score-panel.ts power-bar.ts
├── audio/                   # mixer.ts hooks.ts
└── app.ts                   # 装配根
public/assets/physics/table.json
tests/
├── unit/                    # 每模块一文件，常量断言从规格抄
└── golden/                  # determinism.spec.ts：serialize→deserialize 逐位一致
```

## 6. 模块投喂包（给各模型的"任务说明书"模板）

每个任务的输入固定三件套：**规格文档章节 + 接口文件 + 验收测试**。产出只许在指定目录。

| # | 模块 | 投喂规格 | 实现接口 | 建议模型 | 验收测试 |
|---|---|---|---|---|---|
| 1 | math | `01 §3` | `architecture §4.1` | 强推理模型 | `tests/unit/math.spec.ts`：向量/四元数已知值断言 |
| 2 | physics-constants + body | `01 §2-3` | `§4.2` | 强推理模型 | 常量表逐项断言（gravity -19 等） |
| 3 | physics-world（CCD/求解器/睡眠） | `01 §4-5` | `§4.2 World` | **最强模型**（本项最难） | 黄金：两球对碰动能守恒 ±1%；serialize 往返逐位一致；落袋判定 |
| 4 | simulator | `02 §4,6` | `§4.2 Simulator` | 强推理模型 | stroke 后 result 字段语义断言 |
| 5 | rules | `05 §2-4` | `§4.2 Ref` | 强推理模型 | 罚分 min4 / ballOn 推进 / 重置策略逐条用例 |
| 6 | ai | `06 §2-5` | `§4.2 AIController` | 强推理模型 | 千局烧机：无 NaN、无穿台、AI-1 命中率显著低于 AI-3 |
| 7 | render | `03 §4` | —（消费 `BallView`） | Babylon 经验模型 | 目检清单：灯光角度/强度、球色表、ACES |
| 8 | controller | `04 全文` —（驱动 `Simulator` + EventBus） | Kimi K3 或手感调参能力强者 | 手感 checklist：惯性/椭圆补偿/蹲起 |
| 9 | ui | `01-06` 的 UI 相关 | — | **Kimi K3** | 目检 + 事件联动 smoke test |
| 10 | audio | `02 §7` 钩子表 | — | 小任务 | touch-presolve→音量映射 smoke test |

## 7. 工程规范

- **风格**：命名用语义英文（还原对照表见各 spec 文档）；禁止 `any`/`as unknown as`；单文件 ≤400 行，超限拆分
- **注释**：只在"算法来自原作哪一段"处标注（如 `// PCOL L12046-12105 事件驱动CCD`），其余靠命名
- **提交**：Conventional Commits；模块完成 = 模块代码 + 单测 + 文档同步，一次提交
- **禁止**：表现层 import babylon 以外的全局状态；core 层 setTimeout/同步 IO；为未来功能预留的空抽象

## 8. 施工顺序与验收门

```
math → physics(常量/刚体→世界) → simulator → rules → ai
  ── 里程碑 M1：Node 终端跑通"回合权机"完整对局（gState 循环+轮换+break 累计，
     复刻 practice/single play 两模式，机制见 `docs/spec/07-游戏流程.md`；
     自动化测试可由 AI 大脑驱动玩家列表，仅为测试装置，非游戏模式）
render → controller → ui → audio
  ── 里程碑 M2：可玩，手感对照原作
  ── 里程碑 M3：声音 + 打磨
```

每层完成：`vitest run` 全绿 → `git commit` → push。M1 是最大风险关口（物理正确性在此一次验收）。
