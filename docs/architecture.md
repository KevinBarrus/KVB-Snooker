# KVB-Snooker 架构契约（Architecture Constitution）

> 本文只维护系统依赖、正式公开接口和实现边界。工程纪律见根 AGENTS.md，产品设计、技术提案和历史记录入口见 [文档导航](README.md)。
> 原作还原依据见 spec/00–08；用户批准扩展按所属设计执行。若需求、接口与代码不一致，记录差异，不以旧规格撤销新授权。
> 2026-11-07 文档整理：未新增或修改冻结方法签名；尚未冻结的联机报文与存档方案不属于现行 API。

## 1. 技术栈与基本决策

| 项 | 决策 | 理由 |
|---|---|---|
| 语言 | TypeScript（strict，禁 `any`） | 接口即契约，跨模块协作靠类型 |
| 渲染引擎 | Babylon.js | 与原作一致，03 号规格的灯光/材质参数直接可用 |
| 构建 | Vite | 标准配置即可 |
| 测试 | Vitest（核心层必须有单测 + 黄金测试） | 自动化验收基础；交互与手感另需对应验收 |
| 未来 Steam | 复用零 DOM 核心及共用服务端；桌面打包、平台身份和发布另行设计，本轮不实现 | 不过度设计 |

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

## 3. 事件目录（EventBus）

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

从规格 01 §3 实现的方法全集（语义 1:1，含原作怪癖；语义依据见 `docs/modules/core-math.md`）：

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
  // multiply 以存储块为行主序自洽，含原作自乘别名行为（modules/core-math 怪癖 4）
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

终局与普通犯规扩展：`GAME_STATE.DECIDING=32`；`GameSession.decision: Readonly<TurnDecision>|null（TurnDecision现行定义见§4.6）`提供选择权快照，`chooseNextPlayer(playerIndex:number,nextIndex:number):boolean`仅允许持权者在待选择阶段决定下一位。普通犯规从当前位置继续；Miss 复位与固定争黑先手按 §4.6。`getScore(index:number):number`按现有负penalty计算总分；`winnerIndex:number|null`仅在已结束且非平分时有值。reset清空待选择状态。UI只消费文案/按钮回调，装配根负责命令；AI选择自己接手，Node演示同样显式处理选择。

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

规则行为见 [900 设计](snooker-900-design.md)，摆球交互见 [摆球设计](cue-ball-placement-design.md)，实现及待解决差异见 [项目状态](project-status.md)。本节只登记已批准接口；正式联机的完整协议、持久化与恢复仍待后续接线；暂停子集见§4.13，不因文档引用而宣称已接通。

- 规则类型独立于对局方式：经典为默认，900 首版用于人机和独立双人测试。通过 `GameOptions`规则配置，不给 `GameMode`添加测试模式；自由练习维持原行为。
- 900 的局时 900 秒、出杆时限 20 秒；初始台面准备就绪且允许操作时两表立即启动，不等待 W、摆球确认或首次触球。摆球消耗两表；实际触球停止本杆出杆表，全部球静止、结算及必要归位完成且允许操作后才开始下一杆 20 秒。局时自比赛开始持续运行，直到到期或终局；Space/预备动画不算完成出杆，截止前已触球的杆完整结算。
- 时间和规则在零 DOM 的核心对局层裁决，装配根输入单调时间、输出只读计时状态给 UI。物理步进、归位快进、相机起身和回放倍率不得作为比赛计时来源；不得双重推进或每帧重新计算超时罚分。
- 必要扩展能力：规则配置、计时/比赛阶段只读快照、时间推进、有效摆放查询和摆球确认、真实碰库证据。扩展时同步列出方法签名、时间单位、兼容默认值与事件载荷；不修改旧 `ShotResult`/`SerialData`格式或物理公式。
- 核心规则组合负责判分、球权、全台手中球和蓝球决胜；经典的 Miss/自由球/争黑仍限定在经典规则。碰库证据不得依赖音频订阅或非球球接触这一粗分类；模拟器只读观察，预测隔离。
- UI 只显示核心计时快照，不自行判罚。局时用分秒数字；出杆用 20 格进度栏，格数为剩余秒数向上取整并限制在 0–20，通常绿色，实际剩余不超过 3 秒为红色，0 秒为空。触球后停住，下一杆才重置；不再显示“摆球暂停”。 UI的`MatchClock.shotSegments:number`和`shotUrgent:boolean`为已登记的只读派生值（当前代码存在不同字段及显示方式，见项目状态 R01；本轮不擅自改签名）；`MatchClockDom`提供progressbar语义，布局位于比分牌下方。
- controller 通过窄回调处理摆球确认、实际触球和超时取消。新局进入时默认打开摆球模式并显示母球白色光环，点击合法位置或 W 结束，不增加强制确认步骤；默认合法开球位置无需额外点击。摆球只校验最终位置的区域与球间距，不校验移动路径，台外指向不能被转换成台内合法落点。P/ESC 结束摆球模式并在 900 下确认合法当前位置，W 先确认再瞄准。确认不补时、不停表。AI 先完成合法放置，再按真实母球位置激活瞄准及搜索，同样受时限约束。
- 红点母球由装配根选择 render 外观，红点在母球材质内用局部坐标或球面 UV 绘制，与白色部分共享球面、光照和反射，不使用附加小球、圆盘或独立自发光材质。复用 `BallView.renderOrientation`；物理参数不变，表现层不新增横向依赖，既有镜头行为不改。
- 900 官方简介未充分覆盖专门罚值、蓝球程序等细节，来源边界及已确认游戏约定见 900 设计 §1–5。不得用 Shoot Out 对照条款或本项目计时约定冒充已确认的 900 官规。

`core/match-clock.ts`为对局内部计时组件，`advance(seconds:number):"frame"|"shot"|null`只消费外部提供的非负有限秒数；同一截止只返回一次。`view:MatchClockView`返回独立快照，含`frameSeconds:number;shotSeconds:number;phase:ClockPhase;shootout:boolean`；`ClockPhase`为placement/aiming/rolling/settling/frame-expired/shot-expired/finished。`untilExpiry:number`给装配分片使用：正常局 placement/aiming 取两表最早截止，rolling/settling 仍计局时，无待处理截止才为Infinity；蓝球决胜只计本次出杆表。reset、beginTurn(placement:boolean)、beginPlacement/confirmPlacement/strike（返回boolean）、settle、startShootout、finish由对局层管理；表现层不直接改这个组件。placement不是暂停状态，确认放置不重置时间。

核心接线契约：`GameOptions.ruleset?:"classic"|"snooker-900"`默认classic，practice配900拒绝；`GameSession.ruleset`只读。`clock:MatchClockView|null`、`advanceTime(seconds:number):"shot"|"frame"|null`、`timeUntilExpiry:number`提供独立于物理的计时；advanceTime 的返回值据现有实现补正文档，供装配处理到期取消。`beginPlacement(playerIndex:number):boolean`和`confirmPlacement(playerIndex:number):boolean`经权限及有效状态校验进入/结束摆球交互，不暂停、不补时；`canPlaceCueBall(x:number,y:number,z:number):boolean`供装配预检。原stroke布尔返回拒绝超时，prepareStroke不停止计时。`shootout: {readonly attempts:readonly number[];readonly potted:readonly number[]}|null`显示决胜结果，finished/winnerIndex在决胜阶段按轮次结果而非平分比分判断。保持Node和浏览器调用方编译兼容。

900接线补充：`ShotCommands.advanceTime?(dt:number):boolean`在动画每个消耗片段、实际触球之前调用，返回false停止该次更新，由装配处理超时清理；缺省不改变经典出杆顺序。`PlacementCommands`增加可选`begin():boolean`、`focus():Point3|null`、`end():boolean`；装配注入摆球权限、母球聚焦点与P/ESC结束确认，控制器不引用规则。`end`返回false时控制器保持摆球模式。`Input`在鼠标松开时用固定4 CSS像素阈值区分点击与拖动，点击才提交且按当前坐标重新拾取；`app-placement.ts`为浏览器装配拆分，仅在render的DOM工程检查；经典与 900 共用最新摆球手势；具体键位与表现见摆球设计。

专门犯规码预留并冻结：`FOUL.SHOT_TIMEOUT=128;FOUL.NO_CUSHION=256`；均按max(4,本杆目标分值)计罚，COLOR_ALL未完成提名按7；不得与普通犯规简单叠加罚分。正常900犯规直接对方全台手中球。蓝球每次20秒、双方同等次数后比较合法直接进球、本局非开球方先打；900进行中禁用暂停式回放，终局保留¼慢放。严格截止，两表同刻到期先终局不追加超时罚分。以上为用户确认游戏约定。

模拟器扩展：`getCushionEvidence():CushionEvidence|null`，`CushionEvidence {readonly contacts:readonly {readonly ballIndex:number;readonly kind:"cushion"|"jaw";readonly x:number;readonly z:number}[]}`。同球/同面首次有效闭合冲量记录位置，sidehard为cushion、sidesoft为jaw，其他面不计；返回副本，reset/restore/新杆清空，predict隔离。RefSimulator可选同结构消费，无反向import。规则策略允许SnookerRef新增protected adjudicate结果钩子，经典仍调用既有adjudicate，900先合并NO_CUSHION再走相同归位/阶段推进。

### 4.8 联机开发原型窄接口（2026-11-07 登记，原型未冻结）

范围：只覆盖首版联机实施计划 D 的第 0—3 单元子集——开发入口的双固定席位、经典规则、真实出杆、服务端权威物理、球运动同步与仅开发环境可用的延迟注入。不登记账号、游客、数据库、长期存档、重连判负、排行榜、高光、语音或完整 900 协议。产品边界与操作见 [联机开发原型设计](multiplayer-prototype-design.md)，完整提案仍是 [协议设计](multiplayer-protocol-design.md)，不得把本节当作正式接口冻结。

**依赖边界**

- `src/server/**` 是 Node 基础设施，只允许依赖 `src/core/**`、`src/net/protocol.ts` 与 Node 内置模块；`core` 不导入 `server`、`net` 或任何网络模块。
- 浏览器网络适配分为纯状态 `src/net/**`（协议、快照缓冲、插值、客户端状态机）与装配根 `src/app-net*.ts`（建立连接、场景/渲染/控制器装配）。`render/ui/controller/audio` 不导入网络或服务端代码。
- 共享报文类型唯一维护位置是 `src/net/protocol.ts`；当前报文版本 `NET_PROTOCOL_VERSION = 6`。v2增加待击球快照及 `shot-prepared.vars`；v3增加非权威 `cue-pose` 瞄准显示消息；v4增加整场进度与局间命令（§4.10）；v5增加逐步运动采样；v6增加暂停协商与状态（§4.13）。旧客户端须刷新、旧服务器须重启，版本不符拒绝连接。开发令牌与固定两席位不是正式鉴权，不能替代账号与房间权限。
- 现有 `GameSession`、`Simulator`、规则与物理是唯一权威；服务端不复制第二套规则，客户端不推进权威物理、不自行结算触球。

联机运动采样（v5）：`SnapshotMessage.motion?:readonly MotionSample[]`，`MotionSample {readonly serverTimeMs:number;readonly balls:readonly SnapshotBall[]}`。每包最多8个有序服务器推进步，时间不晚于包时间，只属于当前尝试/当前杆；静止可省略。位置来自 Simulator.getBallView().position（真实球位），姿态仍消费 renderOrientation；不使用 renderPosition 的速度外推。客户端按中间采样插值，运动包的发送时间不再追加为重复球位节点，结算仍按阶段边界切换。网络频率与物理参数不变；具体范围见原型设计§5。

**服务端窄接口（`src/server/room.ts`）**

```ts
export interface RoomOptions {
  readonly prepareLeadMs: number        // 接受意图到权威触球的固定提前量
  readonly tickHz: number               // 物理固定步进频率
  readonly snapshotHz: number           // 运动快照广播频率
  readonly seed: number                 // 房间随机源种子（AI 隔离预留）
}
export interface RoomJoinResult {
  readonly seat: SeatIndex
  readonly welcome: WelcomeMessage
}
export interface RoomTickResult {
  readonly snapshot: SnapshotMessage | null
  readonly events: readonly ServerEventMessage[]
}
export interface RoomSession {
  readonly roomId: string
  readonly config: MatchConfigView
  join(connectionId: string, requestedSeat?: SeatIndex): RoomJoinResult | { readonly reason: RejectReason }
  release(connectionId: string): void
  command(connectionId: string, message: CommandMessage, nowMs: number): RoomTickResult
  tick(nowMs: number): RoomTickResult
  snapshot(nowMs: number): SnapshotMessage
  close(): void
}
```

原型基础击球命令为 `prepare-shot` 与 `decide-turn`；整场命令扩展见§4.10。击球意图在服务器校验、冻结并由权威触球时刻施加一次冲量。`RoomSession` 不依赖 `setTimeout` 或真实墙钟，时间由调用方以毫秒单调值传入，便于确定性测试。WebSocket、延迟注入与监听地址属于传输层（`src/server/transport.ts`、`src/server/latency.ts`），不得进入房间裁决。

服务器传输统一通过 `src/server/clock.ts` 的 `serverNowMs()` 取得进程单调毫秒时间（Node `performance.timeOrigin + performance.now()`）。命令投递、pong、物理tick及快照使用同一时基；系统墙钟只可用于日志/持久化日期，不能驱动本原型对局。报文仍是数字毫秒，不改变协议版本。

**隔离与复用登记**

- AI 隔离：`AIController` 增加可选依赖 `{ routeCache?: RouteCache; random?: () => number }`，默认仍共享原模块级缓存与 `coreRandom` 以保持现有单机行为；服务器为每房间注入独立 `RouteCache` 与随机源。该改动不改变 AI 算法、物理或规则。
- 控制器窄接口：`GamingInput` 只依赖 `ShotLauncher { readonly busy: boolean; readonly inputLocked: boolean; launch(person: PersonController): boolean }`；本地 `ShotController` 与联机出杆动画器都实现该接口，镜头、球杆和输入映射算法不变。
- 客户端显示源：`src/net/remote-view.ts` 由权威快照生成 `BallView` 结构视图（插值位置与归一化姿态），装配根把它接到现有 `BallRenderer` 与 `PersonController`。瞄准预测只使用本地 `Simulator` 从快照携带的 `SerialData` 检查点恢复后计算，从不写回服务端，也不推进真实回合。
- 联机显示时序：`RemoteView.interpolationStats.targetServerMs` 为本帧显示时间，装配传给 `NetShotLauncher.update(nowMs, displayServerMs)`；球位和球杆共用它，晚到动画追赶而非重启。`nowMs` 只记录真实观察帧时间。原 `ShotLauncher` 与单机控制器接口不变。DEV 测试句柄 `shotVisual` 只读暴露显示母球位置、球杆前送距离、触球阶段和显示时间，供逐帧回归；不是产品 API；`remoteCueVisual` 只读暴露远端模型可见性、位置、朝向、前送距离及触球状态，`localCueVisual`提供本地实际姿态用于两端显示对照。
- 远端球杆由装配根 `app-net-remote-cue.ts` 消费权威出杆参数，使用同一显示时刻和 `TipMotion`，不创建远端输入或相机控制器。`TipMotion.launch` 的输入类型收窄为只读的触点/方向及既有三个数值方法（`Pick<StickController, "kissPoint" | "kissDir" | "getTouchSpdWithPower" | "getSlowDownDistance" | "getTipRadius">`）；原调用与曲线保持不变。远端球杆只显示，不触发物理或本地出杆命令。
- 瞄准姿态采用 `CuePose {x,y,z,yaw,pitch}`，位置单位米、角度单位弧度，`null`表示隐藏。客户端 `CuePoseMessage {type:"cue-pose",expectedVersion,sequence,pose}`，服务器 `CuePoseState {type:"cue-pose",version,sequence,seat,serverTimeMs,pose}`。只允许已入座、持球权且无准备中出杆的ready阶段发送；服务器校验、限流并提供房间内单调显示序号，不推进比赛版本/规则事件序号，不持久化，不触发物理。`RoomSession.receiveCuePose(connectionId,message,nowMs)`返回可转发状态或null，`cuePose`只读返回当前合法缓存；`NetClient.sendCuePose`无命令重试。装配读取既有StickController计算结果，纯网络层负责节流与平滑；姿态消息不进入物理快照插值缓冲。具体参数与交接见原型设计§10.9。
- 运动播放时间与ping校时分离：`RemoteView.pushSnapshot(snapshot, nowMs)` 的本地到达时刻参与缓冲控制，内部 `PlaybackClock` 在准备/运动/结算显示期间维持单调游标。`setClockOffset` 保留供静止阶段投影及兼容调用，不能在运动中直接跳动游标。参数与恢复边界只在原型设计 §5 维护，不增加对核心的依赖。
- 计时：本原型只实现经典规则；`advanceTime`、900 双表与触球截止竞争不在本次登记范围。

**实现偏差登记（2026-11-07，原型内部扩展，语义不变）**

- `RoomTickResult` 增加可选 `ack: AckMessage`：拒绝命令没有事件，传输层需要直接回传确认。
- `RoomOptions` 增加可选 `latency`（`welcome.latency` 来源，延迟注入仍在传输层）与 `frameSetup`（测试/开发夹具；正式流程不传）。
- `join(connectionId, requestedSeat?, nowMs=0)` 增加可选 `nowMs`，供传输层传入命令投递时刻与确定性测试；`release` 不增加时间参数。
- `RoomSession` 构造接收每房间独立 `MeshBody`（`new RoomSession(roomId, options, mesh)`），并只读暴露 `simulator/session/aiDependencies` 供诊断与测试；权威写入仍只经 `command/tick`。
- 事件序号与去重缓存按房间独立（每房间 seq 从 1 开始）；拒绝命令也进入每房间 256 条 FIFO 去重缓存，按席位与 `commandId` 隔离；缓存内返回原裁决，淘汰后旧 expectedVersion/attemptId 拒绝过期动作，不承诺跨进程幂等。
- 浏览器开发入口额外提供只读 `window.__snkNet` 测试句柄（仅 DEV、仅联机装配），用于验收读取席位/版本/时序/相机状态，不是公开产品接口。
- `window.__snkNet.diagnostics()` 返回本杆诊断副本；开发 HUD 可将同一数据下载为 JSON。采集范围为球位快照、原始 pong、显示帧及相机位置，不含开发令牌，不修改报文或权威状态；格式与使用见原型设计 §10.6。

### 4.9 练球球形（2026-11-08）

需求来源为用户写入的 [练球模式球形预设需求](practise.md)，产品行为、算法与验收见 [练球球形设计](practice-shape-design.md)。范围只到本地练习，不改变物理、相机、回放、经典判罚或正式对局流程。

**依赖边界**

- `src/core/practice/**` 为纯核心：只依赖 `Simulator`、台面网格与 `FrameSetup`，不依赖 DOM、渲染或网络；从真实库边和标准置球点生成 `FrameSetup`，不写屏幕坐标、不使用随机。
- 菜单与 UI 只传球形 id 和用户意图；装配根把 id 解析为 setup + 练习选项，再调用既有 `GameSession` / `setMode`。UI 不直接改写 World、Body 或规则内部状态。

**练习模式窄接口**

- `GameOptions.practice?: PracticeOptions`，仅练习模式允许，非法构造即拒绝。`PracticeOptions` 为 `{ cuePlacement?: "d-area" | "anywhere"; respotTargetBallNumber?: number; targetBallOn?: number; score?: boolean; freeScoring?: boolean; respotColoursAfterReds?: boolean }`。
- 练习模式允许 `GameOptions.setup`；`GameSession.reset()` 恢复该布局。默认 `cuePlacement` 为 `"d-area"`，保持练习原有 D 区手中球；`"anywhere"` 使用既有全台合法落点校验。
- `GameSession.canRestorePreviousShot:boolean` 为只读派生值，表示杆前快照存在且未准备出杆；`practiceScored:boolean` 为只读派生值。
- `restorePreviousShot` 的练习分支在恢复球位/目标阶段/球权之外，额外恢复 `Player.snapshot()` 的比分、罚分、break、杆数与最高单杆；正式比赛仍保持“只恢复球位、保留已记罚分和累计统计”的既有语义。
- `Player.snapshot()` / `restore()` 为练习复位提供完整统计快照，不改变正式比赛路径。
- 五分点通过 `respotTargetBallNumber` 与 `targetBallOn` 在练习结算后把目标球放回标准点并固定目标阶段；`score:false` 时练习结算不累计比分、罚分或 break。
- `GamingInput` 的 `InputGame` 增加可选 `locked?(): boolean`，供装配根在练习犯规选择弹窗期间锁输入。
- 表现层合同：`PracticeControlsDom` 承载常驻「复位上一杆」与「重摆/复位」弹窗；`ScorePanel.visible` 控制不计分练习隐藏比分；`GameMenu.startShapePractice(shapeId, cueBallStyle)` 返回带 `MatchLaunchRequest.shapeId` 与 `cueBallStyle?: "classic" | "red-dot"` 的启动请求，装配根据此选择母球外观，900 对局仍强制红点。练习退出确认、五分点每杆自动重摆属于装配/UI 行为，不改核心规则。

联机房间不启用练习选项；`RoomOptions.frameSetup` 仍是联机开发夹具，不承担练球产品流程。

### 4.10 整场进度（2026-11-08）

行为与验收边界见 [整场身份与换局](match-progress-design.md)。新增纯核心 `core/match-progress.ts`，不改 GameSession 的公开签名：

- `MatchProgress({matchId:string,bestOf:number,firstOpeningPlayer:0|1})`：校验赛制；`view:MatchProgressView` 返回复制的只读状态。
- `reserveShotId():string|null` 预留当前尝试的一杆身份；`recordStrike(shotId:string):boolean` 在真实触球后计数一次。
- `finishFrame(winner:0|1,scores:readonly number[],reason:"played"|"conceded"):FrameResult|null` 只在 active 阶段结算一次。
- `readyNextFrame(player:0|1):boolean` 接受局间准备，双方准备齐后推进一局；`clearReady(player)` 用于断线撤销准备。
- `rerack():boolean` 仅更新当前尝试身份和杆数；不触碰 GameSession 或时钟。本轮不从网络暴露，未来调用方必须先获得双方同意、到达安全边界，并按900规则保留局时。
- `MatchProgressView` 含 matchId/bestOf/firstOpeningPlayer/frameNumber/frameId/attemptNumber/attemptId/openingPlayer/frameWins/phase/ready/shotCount/lastShotId/frames/result；phase 为 active/between-frames/finished。FrameResult 保存 frameId/attemptId/frameNumber/openingPlayer/winner/scores/reason/shotCount；MatchResult 保存 resultId/matchId/winner/frameWins。ID 是业务身份，不能代替账号鉴权。

联机协议升级 v4：`SnapshotMessage.match:MatchProgressView` 必填；RoomPhase 增加 between-frames；服务端事件增加 frame-ended/frame-started/match-ended，分别携带 frame/match/result。动作增加 `{type:"ready-next-frame"|"concede-frame",attemptId:string}`，校验所属尝试、席位、阶段和 expectedVersion。已有击球/规则命令继续使用房间内跨局单调版本隔离旧局，shotId 带完整尝试前缀。

RoomOptions 增加可选 bestOf/firstOpeningPlayer/matchId，测试可固定身份及首局开球；运行服务器默认三局两胜、随机首局、UUID整场身份。RoomSession.session 改为只读 getter，由服务器 room-match 装配整场与当前 GameSession；换局创建新的标准开局，不调用隐含轮换的 reset。服务器允许依赖协议重导出的纯核心 MatchProgressView 等数据类型。快照与局间面板只读消费，不自行计算胜者。开发启动参数 `--best-of` / `--first-opening-player` 后者仅供可重复验收。

### 4.11 我的球形：自建球形与自建练习（2026-11-08）

需求与产品规则见[我的球形设计](my-shapes-design.md)。范围只到本机自建球形，不涉及账号、数据库、云同步、排行榜、分享或联机。

**边界**

- 自建球形记录保存在浏览器 `localStorage`（key `snk.practice.shapes.v1`）；「我的球形」最多 50 条，回收站条目不占名额，保留 30 天。
- 创建/编辑使用空台编辑器，不创建 `GameSession`，不推进物理、AI、计时或回放；只修改 `Simulator` 的球位并显示候选环。
- 自建练习仍使用 `GameSession` + `FrameSetup`，母球全台手摆；不新增正式 `GameMode`。

**窄接口**

- `PracticeOptions.freeScoring?: boolean`：自建练习专用。为 true 时 `GameSession` 跳过斯诺克裁判，任意球合法；进球按球面值加入 `pts` 与 `brk`，未进球的一杆后 `brk=0`；母球落袋不计分、回标准母球点并进入手中球，单杆清零；`context.ballOn=65535`（任意球合法），HUD 隐藏目标球图标。
- `PracticeOptions.respotColoursAfterReds?: boolean`：仅配合 `freeScoring`。为 true 时，最后一颗红球清完后把初始 setup 中实际存在的彩球复位到标准点位，清彩阶段进袋彩球继续复位；为 false 时红球阶段仍复位进袋彩球，但清彩阶段不再复位。复位不影响分数和单杆。
- `CustomShapeRecord { id; name; balls: CustomShapeBall[]; createdAt; deletedAt }`、`CustomShapesSnapshot { active; recycle }` 定义在 `src/core/practice/custom-shapes.ts`；同一模块提供名称校验、`CUSTOM_SHAPE_LIMIT=50`、`CUSTOM_SHAPE_RECYCLE_MS=30天`、过期清理、`toCustomShapeSetup`、`toCustomPracticeOptions`。
- `src/app-my-shapes.ts` 的 `MyShapesStore` 是 localStorage 适配器（可注入存储、时钟、id 生成以满足 Node 测试），提供 load/create/saveLayout/rename/remove/restore/purge；不进入 core。
- 菜单 `MatchLaunchRequest` 增加可选 `customShapeId`；启动自建练习时装配根从 `MyShapesStore` 读取记录并转换为 setup + practice options，再调用既有 `setMode`。`syncExternalMatch` 按 customShapeId 把退出目录设为我的球形。
- `MyShapesPanelDom` 负责我的球形/回收站列表、右键菜单、命名/确认/告示弹层；只通过 `MyShapesPort` 回调操作数据，不直接读写 `localStorage` 或核心状态。
- 创建/编辑器的 DOM 由 `ShapeEditorPanelDom` 维护；`ShapeEditor` 装配根负责空台、摆放合法性（台面内 + 不重叠）、右键回收白环、彩球点位、镜头（鼠标拖动、A/D 环绕，无 W/滚轮）和与弹层解耦。编辑器仅暴露球位与库存给 UI。
- 练习清完最后一颗对象球时，装配根提供「重摆 / 复位 / 继续 / 退出」四选项；继续保留当前台面、分数和单杆并允许继续操作，不锁相机。该规则同时适用于预设球形；五分点因每杆自动重摆不触发。
- 清理提示复用 `PracticeControlsDom` 的输入锁边界，但完成弹层本身不锁镜头，只通过 `canAim` 阻止出杆。
- `GameMenu` 的我的球形页签与 `我的球形 / 球形回收站` 高亮属于 UI 状态；三块始终展示。

**目录**

- 新增 `src/core/practice/custom-shapes.ts`、`src/app-my-shapes.ts`、`src/app-shape-editor.ts`、`src/ui/my-shapes-panel.ts`、`src/ui/shape-editor-panel.ts`、`src/ui/practice-completion.ts`。
- 预设球形布局与既有练习行为不变；正式规则、相机、回放、音频不因自建练习改变。

### 4.12 稳定边界完整检查点（2026-11-09）

本单元落实[持久化设计](match-persistence-design.md)的内存/JSON恢复基础，不接数据库或正式重连；暂停扩展见§4.13。只接受 READY / DECIDING、全部球静止且未 prepareStroke 的边界；运动及已接受待触球动作明确拒绝，不能丢弃后冒充可恢复。

- `Simulator.exportCheckpoint(): SimulatorCheckpoint` / `validateCheckpoint(data: unknown): SimulatorCheckpoint` / `restoreCheckpoint(data: unknown): void` 保存稳定物理状态（含不活跃球姿态、步长余量、滚动摩擦残留和静止接触岛缓存）、上一杆结果和接触证据。旧 serialize/restore 的行为不变。检查点携带场景、几何与物理配置兼容标识；validateCheckpoint只验证并返回独立副本，恢复前完整校验，不匹配拒绝。
- `WorldClient.exportRestingState(): RestingIslandState[]` / `restoreRestingState(data: readonly RestingIslandState[]): void` 为模拟器检查点内部通道，保存接触岛次序、接触数值/矩阵缓存，按球/多边形ID重连引用；只在稳定边界及Simulator已完成校验后调用，不改变原serialize/restore和求解流程。
- `GameSession.exportCheckpoint(): GameCheckpoint` / `static fromCheckpoint(simulator: Simulator, data: unknown): GameSession` 保存配置、球权/分数/统计/目标、待选择判罚、手选提名、自由球资格、上一杆 Miss/练习恢复依据，以及900剩余时长和蓝球轮次。恢复新实例，不调用结算，不重发得分。既有 Player.restore 也用于检查点。
- `MatchProgress.exportCheckpoint(): MatchProgressCheckpoint` / `static fromCheckpoint(data: unknown): MatchProgress` 保存视图及内部杆序号（包括已分配但未计入出杆数的序号）；跨局/尝试/整场结果身份不得重建为新值。未完成的预备杆拒绝导出。
- `MatchClock.restore(view: MatchClockView): void`、`NineHundredMatch.exportCheckpoint()/restoreCheckpoint(data: NineHundredCheckpoint)` 为核心装配内部恢复方法；保存剩余量而非进程时间戳。`SeededRandom.exportState(): number` / `restoreState(state: number): void` 保存房间独立随机游标，不保存运行中的AI任务。
- `RoomSession.exportCheckpoint(): RoomCheckpoint` / `static fromCheckpoint(data: unknown, mesh: MeshBody): RoomSession` 包含整场、单局、服务配置、状态版本、事件位置、两席命令去重记录及随机状态。仅由可信服务端调用，不是客户端报文。恢复不继承旧连接/瞄准姿态/插值缓冲/单调时钟；恢复总是推进一次版本并撤销局间准备，已裁决结果不重新发事件。格式、引擎、规则和配置不兼容均拒绝。

检查点是独立的JSON数据，不含对象引用、函数或TypedArray；所有入口对损坏数据先校验。新增格式维护于各 checkpoint 类型文件；房间暂停扩展及协议版本见§4.13。尚未实现的账号、逐杆归档、统计计时及命令日志不伪造占位状态；接入时须升级格式或迁移，运动故障恢复仍需后续命令日志。

### 4.13 暂停与继续（2026-11-09 施工契约）

产品行为唯一来源为 [比赛生命周期](match-lifecycle-design.md) §2。暂停是外层生命周期，不改物理、规则状态或回放快照；本单元不接数据库暂存、账号或掉线判负。

- `core/match-pause.ts` 的 `MatchPause(policy)` 独立维护 running/requested/waiting/paused/resuming；`request(player)`、`respond(player, accepted)`、`cancel(player)`、`ready(player)` 返回是否接受；`disconnect(player)` 撤销未生效请求或该席旧准备，但不延长已经开始的恢复倒计时；`advance(seconds, stable, finished)` 返回本次可用于真实比赛推进的秒数。只有 stable 才能从 waiting 生效，finished 优先撤销请求；已接受待触球动作不属于稳定边界。
- `PausePolicy { players: number; maxPerPlayer: number|null; maxSeconds: number|null; countdownSeconds: number }` 由装配固定，不接受客户端自定。`view: PauseView` 为独立快照，含阶段、发起人、每人已使用次数、继续准备状态、暂停剩余时长及恢复倒计时。`blocksPlay` 只在 paused/resuming 为 true。`resetFrame()` 仅在新局调用，重摆不重置预算。限额以生命周期的已确认条款为准。
- `exportCheckpoint()` / `restoreCheckpoint(unknown)` 保存暂停阶段、剩余量和预算；恢复必须撤销旧准备，不能用旧连接许可自动继续。时间只接受外部有限非负秒数，无 DOM 或网络依赖。
- `GameSession.canPause` 只读判定 READY/DECIDING、所有球静止、无已准备出杆且未终局。浏览器与服务器在共同安全边界冻结调度；恢复不重建 GameSession、不重算分数、不重置剩余时间或相机。
- 联机协议升级 v6：快照新增 `pause: PauseView`，命令新增 `pause-request/pause-accept/pause-decline/pause-cancel/pause-ready`，均带 attemptId，复用席位校验、版本和命令去重。暂停阻断新出杆、判罚选择、认输和瞄准广播；请求期间动作照常。暂停/恢复变化更新快照版本，间隔广播剩余量。房间检查点格式升级 2，包含暂停状态，旧格式显式拒绝。
- `BrowserGame.pause` 提供本地 `request()/ready()/view/blocksPlay` 装配入口；`app-local-pause.ts` 驱动本地暂停，AI及单机双人测试由一个操作方确认。`app-game-hud.ts`、`app-practice.ts`、`app-net-scene.ts` 只拆分既有装配职责，保持原有算法。
- `ui/pause-panel.ts` 只接只读状态与动作回调。paused/resuming 使用不透明全屏模态遮挡并约束焦点，禁止回放、菜单或快捷键穿透；本地菜单按钮接入相同流程。恢复清理 Input 按键/指针残留，保持瞄准与摆球实际状态。

### 4.14 内测身份、会话与部署（2026-11-10 施工契约）

产品范围见[内测身份设计](internal-beta-identity-design.md)。本轮只完成两个预建内测账号、PostgreSQL 会话、登录门禁、按用户隔离本地球形和部署基础；不开放注册、不接正式联机权限、不修改联机协议/房间/席位。

**依赖与边界**

- 新增 `src/identity/**` 基础设施，只依赖 Node 内置模块与 `pg`；不得依赖 DOM、Babylon、`src/core/**`、`src/net/**`、`src/server/**` 或浏览器表现层。
- 新增 `db/migrations/**` 只管理身份必要表；不提前建排行榜、高光、比赛存档或云球形表。
- 浏览器只通过同源 `/api/auth/*` 和 HttpOnly Cookie 访问身份；用户 ID、角色、状态由服务端会话裁决。
- 现有 `src/server/**` 不导入身份服务或数据库；未来由独立装配注入 `SessionVerifier` 或调用内网校验入口，房间裁决仍不直接查库。服务端由会话取得 `userId/displayName/role` 的窄契约见 [identity-session-verifier.md](identity-session-verifier.md)：`SessionVerifier.verify(token): Promise<VerifiedIdentity|null>`，`VerifiedIdentity { userId; displayName; role }`，不含邮箱。
- 正式构建必须登录；开发构建默认关闭门禁以保留现有无登录测试，`VITE_AUTH_REQUIRED=true` 可开启。身份后端不可用时显示错误，不绕过。

**HTTP 与身份契约**

- `POST /api/auth/login` `{email,password}` → `200 IdentitySessionView` 并设置 `snk_session`；错误统一 `401 invalid_credentials`，限流 `429`。
- `GET /api/auth/me` → `200 IdentitySessionView`；未登录 `401 unauthenticated`。
- `POST /api/auth/logout` → `204`，撤销当前服务端会话并清 Cookie。
- `GET /api/health` → `200 {ok,database}`；数据库不可用 `503`。
- `IdentityUser { id; email; displayName; role: "player"|"admin"; createdAt }`；`id` 为稳定 UUID，是后续联机和存档唯一用户身份，`displayName` 只用于展示。`IdentitySessionView { user; expiresAt }`。
- 密码使用 `crypto.scrypt` 哈希；会话 token 随机生成，数据库只存 SHA-256。Cookie 为 `HttpOnly; Path=/; SameSite=Lax; Max-Age`，生产加 `Secure`。退出、改密、停用都撤销旧会话。
- 管理员命令 `migrate/create-user/reset-password/disable-user/enable-user/list-users` 通过 CLI 执行；`create-user` 重复运行不重建 ID、不覆盖密码。密码仅交互隐藏输入，不写 Git、日志或命令行参数。

**本地球形**

- 登录用户的 `MyShapesStore` 使用 `snk.user.<userId>.practice.shapes.v1` 命名空间；旧匿名键 `snk.practice.shapes.v1` 原样保留，提供手动导入入口，不自动归属第一个登录账号。
- 身份单元交付时禁用正式双人入口；后续§4.15接入真实房间后开放，仍禁止把房间码转换成本地双USER测试。

**部署**

- 同源 HTTPS；PostgreSQL 与身份服务不暴露公网端口，反向代理只暴露 80/443。数据卷持久化账号。
- `public/assets/**` 保持 Git 忽略；部署前准备并校验资源，缺失即失败。配置示例、迁移、健康检查、更新和回滚见设计 §6—§7。
- 本地/正式构建浏览器验收记录写入项目状态；无公网服务器时远程上线列为待完成，不虚报。

### 4.15 可玩经典联机接线（2026-11-10）

范围与分工见 [内测联机接线](multiplayer-playable-design.md)。网络协议v7扩展经典规则操作与只读展示，不改变GameSession接口：

- `RuleAction`：`place-cue {x,z}`、`nominate {ballIndex:number|null}`、`replace-shot`，均携带attemptId，复用CommandMessage的版本、席位与去重。服务端使用GameSession公开操作，暂停/已准备/运动/非持权者拒绝；place-cue仅校验最终落点，不做路径障碍判定。
- `SnapshotMessage.rules:RulesView`：双方pts/penalty/brk、犯规待选项、自由球资格、手动提名与可选球、贴球编号；只读展示，不授权客户端判罚。自动彩球提名仍由prepareStroke以真实方向判定。
- `shot-impact`事件包含shotId及原ImpactEvent，事件时间来自权威运动推进的显示时间；声音在客户端播放游标到达时消费一次，预测和重连不补播旧音效。
- `PlayerAccess { origin; authenticate(IncomingMessage): Promise<NetIdentity|null> }` 注入传输，内部HTTP适配调用§4.14的会话校验器；`NetIdentity {userId;name}`只保存在服务器。每次命令和每秒心跳重新验证，会话撤销不能继续操作。身份不可用拒绝连接，不回退开发令牌。
- `POST /api/rooms {ruleset:"classic",bestOf}`创建、`POST /api/rooms/:code/join {}`加入、`GET /api/rooms/current`找回当前房间、`GET /api/rooms/:code`成员查看、`POST /api/rooms/:code/leave {}`离开等待/已结束房间。响应 `{room:LobbyView|null}`，leave为`{ok:true}`；仅同源Cookie，服务端生成六码、分配席位，创建时固定赛制。进行中不能单方删除；房间仍是进程内存，不构成长久存档。
- `LobbyView {roomId,bestOf,ruleset,phase,players:[{seat,name,connected,ready}]}`不含邮箱、凭证或内部用户ID。WebSocket新增服务器`lobby {lobby}`、客户端`lobby-ready {ready}`；双方连接且资源就绪后主动准备才开始。未准备拒绝所有游戏命令。掉线前的身份保留原席位，但正式重连宽限/裁决后续接入。
- `?room=CODE`正式入口固定同源`/net`；`?multiplayer`创建/加入页，均先经登录门禁；`?net=`仅开发。GameMenu构造新增可选`onMultiplayer()`装配回调，由首页双人按钮导航，不再把房间码转换成本地双USER。
- app-net-rules用已登记的SnookerRef公开落点检查和inferColour作只读预览；最终判定仅由服务器GameSession执行。app-net-presentation复用Hud、通知和BrowserAudio，网络模块不引DOM，表现模块不引网络。

### 4.16 电影外观（2026-11-13 用户批准）

需求唯一入口为 `cinema-visual-design.md`。装配根解析 `visual=cinema`，`loadTableScene(engine, jawShift, options?)` 接收可选电影配置；缺省调用保持当前默认场景。电影配置包含装配根从 `applyTableGeometry` 复制的 `CushionOutline`（只读 x/z 点及到下一点是否为 pocket 的标记），不传 World/Body。该数据只用于生成显示库鼻，不产生新的碰撞或规则。

程序化球台生成器接受可选只读 TableStyle，缺省为 TABLE_STYLE，不修改共享预设。BallRenderer 的既有 options 增加可选球材质工厂，仍只消费 getBallCount/getBallView；球材质归 renderer，场景共享贴图归 scene。loadCue 可选材质工厂，不改控制器动作。

电影观察装配位于 app-visual.ts；ui 只提供镜头选择 DOM，render 只提供相机。装配控制观察输入的独占权，既有控制器仍拥有瞄准姿态。观察中不发出击球；回到瞄准、菜单、摆球、编辑或回放时恢复原相机与输入。场景切换不增加核心事件或存档字段，不修改联机装配。

### 4.17 Blender 视觉资产（2026-11-13 用户批准）

需求见 blender-table-design.md。`SceneAppearance.blender?: {outline:CushionOutline}` 与 cinema 互斥；`visual=blender` 只改变静态资产和球/球杆材质，不改变物理或镜头控制。`loadBlenderCue(scene):Promise<B.Mesh>` 返回皮头原点、向 -X 延伸的单网格，与原 cue 姿态/显隐接口相同。PBR 子材质通过 MultiMaterial 保留，禁止强制转成 StandardMaterial。

`loadBlenderAsset(scene, filename)` 使用离线、固定版本校验的官方 glTF 加载器；导出为米制、基础 glTF 2.0 PBR。加载后验证资产记录的物理轮廓与装配传入值相同；几何变更须重新导出，不能静默使用过期袋角。资产不包含动态球和碰撞网格。BallRenderer.options.highDetail 可使彩球采用与母球相同的32段球体，缺省保持32/20档及快照契约。资源归 Scene，加载失败释放 Scene；原作缺省路径不加载新的资源或全局插件。

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
│   ├── practice/            # 练球球形：table-geometry.ts、layout-reds.ts、layout-mixed.ts、shapes.ts
│   └── ai/                  # route-cache.ts task-pipeline.ts profiles.ts
├── render/                  # scene.ts table.ts balls.ts materials.ts light-probes.ts
├── controller/              # person-controller.ts stick-controller.ts camera-rig.ts input.ts ai-runner.ts
├── ui/                      # hud.ts score-panel.ts power-bar.ts practice-controls.ts
├── audio/                   # mixer.ts hooks.ts
├── net/                     # 联机原型：protocol.ts、remote-view.ts、net-session-state.ts（零 DOM）
├── server/                  # Node 权威房间：room.ts、room-manager.ts、transport.ts、latency.ts、main.ts
├── app-net.ts               # 已认证房间与隔离开发入口的浏览器装配
└── app.ts                   # 本地装配根
public/assets/physics/table.json
tests/
├── unit/                    # 每模块一文件，常量断言从规格抄
└── golden/                  # determinism.spec.ts：serialize→deserialize 逐位一致
```

## 6. 施工任务的输入

具体任务必须指定所属设计、接口章节、修改目录与验收用例。阅读路线见 [文档导航](README.md)，首版联机依赖见 [实施计划](multiplayer-implementation-plan.md)。旧 M1/M2 模型分工表与施工顺序保存在 [迁移前架构记录](history/2026-11-07/architecture.md)，不是当前排期。

## 7. 工程规范

继承 [根章程](../AGENTS.md)，不在此重复维护 TS 风格、提交和文档纪律。核心不引入计时调度器或同步 I/O；Node 演示和浏览器/服务端装配在各自边界执行环境操作，不把基础设施侵入物理与规则。

## 8. 验收门

每个实现单元通过全量测试及类型检查，按改动追加真实浏览器、对局或故障验收。命令见 [开发操作](development.md)，结果和限制见 [项目状态](project-status.md)。已有测试通过不能作为新需求已实现的证明。

## 9. 声音第一版扩展（2026-10-27 用户授权）

契约详见 docs/audio-v1-design.md。Simulator 增加 onImpact(listener:(event:ImpactEvent)=>void):()=>void，EventBus 增加 sim/impact:ImpactEvent；类型定义于 core/simulator/impact.ts，返回只读普通值。cue/ball/surface 联合事件记录实际击球与新接触，不改旧 ContactEvent、ShotResult、存档或物理算法。表现层继续经 Simulator/EventBus 接线，预测不发布事件。

audio 保留纯决策与 SoundBackend 边界，允许独立 browser-backend.ts 消费原生 Web Audio（独立 DOM tsconfig）；app-audio.ts 为浏览器装配根拆分文件。采样分类与校准配置由清单维护，原始素材及准备输出不提交。首版范围与不做项以设计文档为准。

声音校准补充：surface载荷包含entrySpeed（最近台面高度的水平速度，缺失时回退即时水平速度）；horizontalSpeed保留即时观测。Simulator在step前及真实球球冲量后更新只读采样，低于台面时使用离台前值，避免漏斗将竖直下落转换为水平运动后放大轻入袋声。ContactRecorder增加内部可选afterSolve观察回调，不改变公开规则证据或物理求解。
