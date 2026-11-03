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

分步契约见`docs/rules-v2-design.md`。规则完善为用户批准的原作扩展；Miss第二轮简化标准及边界见设计文档。正式规则与开发测试共用核心，核心不得导入测试工具。

首单元新增`GameOptions { players?: readonly ("USER" | "AI")[]; setup?: FrameSetup }`，用于`GameSession(simulator, mode?, options?)`与`BrowserGame.setMode(mode, difficulty?, options?)`。`FrameSetup { balls: readonly { index: number; x: number; z: number; active: boolean }[]; ballOn: number; inHand: 0 | 1 | 2; playerIndex: number; scores: readonly number[] }`。GameSession.reset完整恢复初始配置，不增加正式GameMode值；Simulator/ShotResult不变。

PersonController.playerIndex可在非出杆阶段重绑，新增只读locallyControlled构造参数区分本地玩家与AI。ShotController依据此标志管理本地观察与输入锁；不改变CameraRig/ShotView算法。开发装配`src/devtools/`通过DEV条件动态加载，VITE_RULES_TEST=0可关闭；浏览器类型仅由render工程检查。

终局与普通犯规扩展：`GAME_STATE.DECIDING=32`；`GameSession.decision: Readonly<TurnDecision>|null（TurnDecision现行定义见§4.6）`提供选择权快照，`chooseNextPlayer(playerIndex:number,nextIndex:number):boolean`仅允许持权者在待选择阶段决定下一位。首轮普通犯规仅从当前位置继续，黑球平分抽签选择先手；第二轮由§4.6的Miss复位与固定争黑先手覆盖。`getScore(index:number):number`按现有负penalty计算总分；`winnerIndex:number|null`仅在已结束且非平分时有值。reset清空待选择状态。UI只消费文案/按钮回调，装配根负责命令；AI选择自己接手，Node演示同样显式处理选择。

提名扩展：`RulesContext.nominatedBallIndex?:number`为本杆冻结的彩球索引，不改变阶段ballOn。`GameSession.nominate(playerIndex:number,ballIndex:number|null):boolean`手选/恢复自动；`getNomination(dx:number,dz:number):{required:boolean;ballIndex:number|null;manual:boolean}`返回意图快照；`prepareStroke(playerIndex:number,vars:StrokeVars):boolean`在动画开始前冻结意图，stroke也调用此校验以覆盖Node。不明确时拒绝开始而不罚分。`AIRoute.ballBIndex?:number`暴露已有路线目标元数据，安全球/翻库/随机解围也记录意图，拟人误差不能改变提名。UI仅接受选项/文案和回调。

接触证据扩展：`Simulator.getContactEvidence():ContactEvidence|null`返回复制的`{touchingIndices:readonly number[];firstContactIndices:readonly number[];pushedIndices:readonly number[]}`；RefSimulator可选消费同结构方法，旧ShotResult不改。模拟器内观察Solver.solveContact前后速度及接触时位置，不改冲量/积分/休眠/CCD；predict隔离，reset/restore清空。接触容差1e-5m，水平方向速度变化阈值1e-7m/s；firstContactIndices记录同evolution、同母球位置的第一组实际接触。`FOUL.PUSH_STROKE=32`。`GameSession.touchingBallIndices`为杆前贴球索引只读快照，UI提示打离要求；合法贴球满足首触义务，非目标贴球不免除首触义务。

自由球扩展：`GameSession.freeBallAvailable:boolean`只读资格，犯规结算/归位完成后按目标两侧可达性判断；手中球检查整个D区。持权者接手保留资格，让对方继续则取消；nominate在此阶段选择非目标球，null表示不用自由球。prepareStroke写入`RulesContext.freeBallIndex?:number`，不改阶段ballOn；结算清空。本杆首触、替代分值、复位及`FOUL.FREE_BALL_SNOOKER=64`由规则层处理。UI复用提名面板，辅助线按当前提名标色，AI当前选择不用自由球、正常解原目标。

### 4.6 Miss复位与开球轮换（用户批准第二轮）

- `GameSession.restorePreviousShot(playerIndex:number):boolean`：正式比赛仅DECIDING且持权者有Miss复位权时可调用；练习仅READY、当前玩家、未准备出杆且有上一杆时可调用。共用同一个杆前存档，不新增存档格式；练习不接UI。恢复清空当前杆结果/接触证据/提名/自由球；比赛保留已记罚分和累计统计，球权回犯规方。原位快照在prepareStroke第一次成功时捕获，reset清除。
- `TurnDecision`收敛为`{readonly kind:"foul";readonly playerIndex:number;readonly canReplace:boolean}`。canReplace按本杆合法首碰、杆前及判罚后分差/台面分值确定；不复用FOUL.MISS_TARGET作Miss裁判码，不改EventBus载荷。黑球平分改为直接READY，无抽签选择面板。
- `GameOptions.openingPlayerIndex?:number`指定本局开球方（默认0，必须为有效席位）；`GameSession.openingPlayerIndex`只读记录本局开球方。无setup的正式GameSession.reset交替开球；setup重置始终恢复其初始配置，不交替。BrowserGame在重新创建正式session时传入连续轮换的开球方，练习及setup不消费轮换；争黑直接给非本局开球方。
- `Simulator.restore`复用既有签名，显式恢复成功后清除ShotResult及ContactEvidence并同步显示，predict内部的World恢复不改此语义。禁止从表现层直接改核心；复位命令成功后浏览器装配清理回放/摆球/动画、重新激活当前玩家并同步HUD。
- UI RuleChoiceView增加可选restoreLabel；RuleChoiceDom增加可选复位回调。贴球提示接受普通文案，复用中心消息视图，不订阅新事件或在UI判定规则。

2026-10-27贴球提示验收修正：提示标题/正文/关闭按钮仅用英文，与当前犯规提示一致，不增加语言切换系统。`FoulNotice.show(head:string,body:string):void`复用原作自动关闭公式，showFoul委托它；`FoulNoticeDom(doc?:Document,onClose?:()=>void)`可选展示×按钮。装配根按回合/贴球文案去重，手动关闭或超时不在同杆反复弹出，新局/复位重置去重状态；出杆/回放隐藏提示。

2026-10-27统一临时消息关闭：FoulNoticeDom默认提供×，绑定最近sync的消息状态并调用close，再通知可选onClose；HudDom(doc?,onNoticeClose?)转发关闭通知，由装配根恢复画布焦点。ViewNotice增加close():void，ViewNoticeDom(doc?,onClose?)同样提供×并保留2.2秒计时。关闭只隐藏提示，不修改犯规/待选择状态；规则选择、提名、回放控件不是临时消息，不自动消失。

### 4.7 斯诺克 900（设计阶段，2026-11-02）

需求及施工说明见 [snooker-900-design.md](snooker-900-design.md)。第一版已接线，但人工验收发现问题；2026-11-03 用户确认的计时、摆球、UI 与球面红点修订见该文档 §5、§8、§12，覆盖旧“双暂停”要求。本轮仅修订文档，尚未实现这些修复。既有接口兼容，新增契约集中登记在本节。

- 规则类型独立于对局方式：经典为默认，900 首版用于人机和独立双人测试。计划通过 `GameOptions`新增规则配置，不给 `GameMode`添加测试模式；自由练习维持原行为。
- 900 的局时 900 秒、出杆时限 20 秒；初始台面准备就绪且允许操作时两表立即启动，不等待 W、摆球确认或首次触球。摆球消耗两表；实际触球停止本杆出杆表，全部球静止、结算及必要归位完成且允许操作后才开始下一杆 20 秒。局时自比赛开始持续运行，直到到期或终局；Space/预备动画不算完成出杆，截止前已触球的杆完整结算。
- 时间和规则在零 DOM 的核心对局层裁决，装配根输入单调时间、输出只读计时状态给 UI。物理步进、归位快进、相机起身和回放倍率不得作为比赛计时来源；不得双重推进或每帧重新计算超时罚分。
- 必要扩展能力：规则配置、计时/比赛阶段只读快照、时间推进、有效摆放查询和摆球确认、真实碰库证据。扩展时同步列出方法签名、时间单位、兼容默认值与事件载荷；不修改旧 `ShotResult`/`SerialData`格式或物理公式。
- 核心规则组合负责判分、球权、全台手中球和蓝球决胜；经典的 Miss/自由球/争黑仍限定在经典规则。碰库证据不得依赖音频订阅或非球球接触这一粗分类；模拟器只读观察，预测隔离。
- UI 只显示核心计时快照，不自行判罚。局时用分秒数字；出杆用 20 格进度栏，格数为剩余秒数向上取整并限制在 0–20，通常绿色，实际剩余不超过 3 秒为红色，0 秒为空。触球后停住，下一杆才重置；不再显示“摆球暂停”。
- controller 通过窄回调处理摆球确认、实际触球和超时取消。默认合法开球位置无需强制确认；主动拖动必须受 D 区/全台权限及路径障碍约束，不穿越其他球。确认不补时、不停表。AI 先完成合法放置，再按真实母球位置激活瞄准及搜索，同样受时限约束。
- 红点母球由装配根选择 render 外观，红点在母球材质内用局部坐标或球面 UV 绘制，与白色部分共享球面、光照和反射，不使用附加小球、圆盘或独立自发光材质。复用 `BallView.renderOrientation`；物理参数不变，表现层不新增横向依赖，既有镜头行为不改。
- 900 官方简介未充分覆盖专门罚值、蓝球程序等细节，证据缺口见设计文档 §2.3，用户已确认的游戏约定见 §11–12。不得用 Shoot Out 对照条款或本项目计时约定冒充已确认的 900 官规。

`core/match-clock.ts`为对局内部计时组件，`advance(seconds:number):"frame"|"shot"|null`只消费外部提供的非负有限秒数；同一截止只返回一次。`view:MatchClockView`返回独立快照，含`frameSeconds:number;shotSeconds:number;phase:ClockPhase;shootout:boolean`；`ClockPhase`为placement/aiming/rolling/settling/frame-expired/shot-expired/finished。`untilExpiry:number`给装配分片使用：正常局 placement/aiming 取两表最早截止，rolling/settling 仍计局时，无待处理截止才为Infinity；蓝球决胜只计本次出杆表。reset、beginTurn(placement:boolean)、beginPlacement/confirmPlacement/strike（返回boolean）、settle、startShootout、finish由对局层管理；表现层不直接改这个组件。新计时语义尚待实现，不能把 placement 当成暂停状态。

核心接线契约：`GameOptions.ruleset?:"classic"|"snooker-900"`默认classic，practice配900拒绝；`GameSession.ruleset`只读。`clock:MatchClockView|null`、`advanceTime(seconds:number):"shot"|"frame"|null`、`timeUntilExpiry:number`提供独立于物理的计时；advanceTime 的返回值据现有实现补正文档，供装配处理到期取消。`beginPlacement(playerIndex:number):boolean`和`confirmPlacement(playerIndex:number):boolean`经权限及有效状态校验进入/结束摆球交互，不暂停、不补时；`canPlaceCueBall(x:number,y:number,z:number):boolean`供装配预检。原stroke布尔返回拒绝超时，prepareStroke不停止计时。`shootout: {readonly attempts:readonly number[];readonly potted:readonly number[]}|null`显示决胜结果，finished/winnerIndex在决胜阶段按轮次结果而非平分比分判断。保持Node和浏览器调用方编译兼容。

900接线补充：`ShotCommands.advanceTime?(dt:number):boolean`在动画每个消耗片段、实际触球之前调用，返回false停止该次更新，由装配处理超时清理；缺省不改变经典出杆顺序。`PlacementCommands`增加可选`begin():boolean`、`origin():Point3|null`、`constrain(from:Point3,to:Point3):Point3`；装配注入摆球权限、可见起始预览与连续路径约束，控制器不引用规则。`app-placement.ts`为浏览器装配拆分，仅在render的DOM工程检查；经典不提供连续预览起点，仍走原点击放置行为。

专门犯规码预留并冻结：`FOUL.SHOT_TIMEOUT=128;FOUL.NO_CUSHION=256`；均按max(4,本杆目标分值)计罚，COLOR_ALL未完成提名按7；不得与普通犯规简单叠加罚分。正常900犯规直接对方全台手中球。蓝球每次20秒、双方同等次数后比较合法直接进球、本局非开球方先打；900进行中禁用暂停式回放，终局保留¼慢放。严格截止，两表同刻到期先终局不追加超时罚分。以上为用户确认游戏约定。

模拟器扩展：`getCushionEvidence():CushionEvidence|null`，`CushionEvidence {readonly contacts:readonly {readonly ballIndex:number;readonly kind:"cushion"|"jaw";readonly x:number;readonly z:number}[]}`。同球/同面首次有效闭合冲量记录位置，sidehard为cushion、sidesoft为jaw，其他面不计；返回副本，reset/restore/新杆清空，predict隔离。RefSimulator可选同结构消费，无反向import。规则策略允许SnookerRef新增protected adjudicate结果钩子，经典仍调用既有adjudicate，900先合并NO_CUSHION再走相同归位/阶段推进。

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

## 9. 声音第一版扩展（2026-10-27 用户授权）

契约详见 docs/audio-v1-design.md。Simulator 增加 onImpact(listener:(event:ImpactEvent)=>void):()=>void，EventBus 增加 sim/impact:ImpactEvent；类型定义于 core/simulator/impact.ts，返回只读普通值。cue/ball/surface 联合事件记录实际击球与新接触，不改旧 ContactEvent、ShotResult、存档或物理算法。表现层继续经 Simulator/EventBus 接线，预测不发布事件。

audio 保留纯决策与 SoundBackend 边界，允许独立 browser-backend.ts 消费原生 Web Audio（独立 DOM tsconfig）；app-audio.ts 为浏览器装配根拆分文件。采样分类与校准配置由清单维护，原始素材及准备输出不提交。首版范围与不做项以设计文档为准。

声音校准补充：surface载荷包含entrySpeed（最近台面高度的水平速度，缺失时回退即时水平速度）；horizontalSpeed保留即时观测。Simulator在step前及真实球球冲量后更新只读采样，低于台面时使用离台前值，避免漏斗将竖直下落转换为水平运动后放大轻入袋声。ContactRecorder增加内部可选afterSolve观察回调，不改变公开规则证据或物理求解。
