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

规则行为见 [900 设计](snooker-900-design.md)，摆球交互见 [摆球设计](cue-ball-placement-design.md)，实现及待解决差异见 [项目状态](project-status.md)。本节只登记已批准接口；正式联机的暂停、协议与完整存档尚待独立实现，不因文档引用而宣称已接通。

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
- 共享报文类型唯一维护位置是 `src/net/protocol.ts`；报文版本 `NET_PROTOCOL_VERSION = 1`。开发令牌与固定两席位不是正式鉴权，不能替代账号与房间权限。
- 现有 `GameSession`、`Simulator`、规则与物理是唯一权威；服务端不复制第二套规则，客户端不推进权威物理、不自行结算触球。

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

房间命令只有 `prepare-shot` 与 `decide-turn` 两种；击球意图在服务器校验、冻结并由权威触球时刻施加一次冲量。`RoomSession` 不依赖 `setTimeout` 或真实墙钟，时间由调用方以毫秒单调值传入，便于确定性测试。WebSocket、延迟注入与监听地址属于传输层（`src/server/transport.ts`、`src/server/latency.ts`），不得进入房间裁决。

**隔离与复用登记**

- AI 隔离：`AIController` 增加可选依赖 `{ routeCache?: RouteCache; random?: () => number }`，默认仍共享原模块级缓存与 `coreRandom` 以保持现有单机行为；服务器为每房间注入独立 `RouteCache` 与随机源。该改动不改变 AI 算法、物理或规则。
- 控制器窄接口：`GamingInput` 只依赖 `ShotLauncher { readonly busy: boolean; readonly inputLocked: boolean; launch(person: PersonController): boolean }`；本地 `ShotController` 与联机出杆动画器都实现该接口，镜头、球杆和输入映射算法不变。
- 客户端显示源：`src/net/remote-view.ts` 由权威快照生成 `BallView` 结构视图（插值位置与归一化姿态），装配根把它接到现有 `BallRenderer` 与 `PersonController`。瞄准预测只使用本地 `Simulator` 从快照携带的 `SerialData` 检查点恢复后计算，从不写回服务端，也不推进真实回合。
- 计时：本原型只实现经典规则；`advanceTime`、900 双表与触球截止竞争不在本次登记范围。

**实现偏差登记（2026-11-07，原型内部扩展，语义不变）**

- `RoomTickResult` 增加可选 `ack: AckMessage`：拒绝命令没有事件，传输层需要直接回传确认。
- `RoomOptions` 增加可选 `latency`（`welcome.latency` 来源，延迟注入仍在传输层）与 `frameSetup`（测试/开发夹具；正式流程不传）。
- `join(connectionId, requestedSeat?, nowMs=0)` 增加可选 `nowMs`，供传输层传入命令投递时刻与确定性测试；`release` 不增加时间参数。
- `RoomSession` 构造接收每房间独立 `MeshBody`（`new RoomSession(roomId, options, mesh)`），并只读暴露 `simulator/session/aiDependencies` 供诊断与测试；权威写入仍只经 `command/tick`。
- 事件序号与去重缓存按房间独立（每房间 seq 从 1 开始）；拒绝命令也进入每房间 256 条 FIFO 去重缓存，同一 `commandId` 永远返回原裁决。
- 浏览器开发入口额外提供只读 `window.__snkNet` 测试句柄（仅 DEV、仅联机装配），用于验收读取席位/版本/时序/相机状态，不是公开产品接口。

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
├── net/                     # 联机原型：protocol.ts、remote-view.ts、net-session-state.ts（零 DOM）
├── server/                  # Node 权威房间：room.ts、room-manager.ts、transport.ts、latency.ts、main.ts
├── app-net.ts               # 联机原型装配根（仅开发入口动态加载）
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
