# core/physics · 模块章程

PCOL 自研物理引擎：物理常量、刚体（Body/Sphere）、接触（Contact/TipContact）、
台面（CollisionPolygon/MeshBody）、求解器（Solver）、世界（World/WorldClient）。

## 职责边界

- 做：`docs/architecture.md` §4.2 定义的 World / Ball / MeshBody / MeshBody 数据 API 及其内部机制
- 禁：import DOM / Babylon / 网络库；import `core/` 以外的模块；改 `architecture.md` 冻结的公开签名
- 允许 import：`core/math/*`、`core/rng`、本目录文件

## 事实来源

- 语义与常量：`docs/spec/01-物理内核.md`（§2 常量表 / §3 Body / §4 World / §5 TipContact）
- 桌面碰撞体：`docs/spec/03-袋口几何.md` + `analysis/tiger-club-sno-rgb.json`
- 原作源码（语义争议时以此为准）：`analysis/1.chunk.js`
  - 常量：L8932-8968（原模 16）/ Body：L11324-11576（原模 35）/ Sphere：L11577-11602（原模 36）
  - Contact：L11603-11707（原模 37）/ TipContact：L13645-13684（原模 86）
  - Polygon：L13360-13452（原模 82）/ MeshBody：L13472-13579（原模 84）
  - 求解器：L9322-9417（原模 21）/ 岛屿：L11048-11323（原模 34）
  - World：L11776-12105（原模 39）/ WorldClient：L14609-14745（原模 95）

## 施工单元状态

- [x] `rng.ts`（core/rng：播种 RNG，09-扩展规划 §0.1）+ `constants.ts` + `body.ts` + `ball.ts`
- [x] `contact.ts`（ContactBase 模22 + ContactSS 模37）/ `tip-contact.ts`（模86）
- [x] `collision-polygon.ts`（MeshEdge 模83 + CollisionPolygon 模82）/ `mesh-body.ts`（PolyGroup 模81 + MeshBody 模84 + schema 类型）
- [x] `solver.ts`（模21：接触冲量 / 贪心岛屿求解 / 穿透偏移，`Solver.sharedInstance`，24 项单测）
- [x] `pool.ts`（模38 对象池）/ `sp-contact.ts`（模92 SP 接触）/ `island.ts`（模93）/ `actings.ts`（模94 cActings）/ `ccd.ts`（模34：CCD/TOI/岛屿维护全套，11 项单测）
- [x] `pendings.ts`（模91 双栈撞击簇）/ `world.ts`（模39 步进主循环）/ `world-client.ts`（模95 预测客户端）+ `solver.ts` 追加 `SolverEngine`（模85 callback/interrupt 变体）+ `Body.dispose`（L11436）
- **physics 全域完成（141 项测试）→ M1 物理底盘闭合**

## 转写时新发现的怪癖（不可"改进"）

10. `__pureIsland`（模94）：组件收束**先捕残留再断链**（`leftoverNext = componentEnd.next` 先于置空）——顺序颠倒第二个分量永远不生成（曾出错，测试已冻结）
11. 同岛联通合并：A-b 有 SS 接触时，b 的 SP 接触会 push 进**合并岛**（不是新岛）——island 归属由 idMap 并查集语义决定
12. Actings 网格：列下标 = idj（多边形 uid 或球 uid 混用）；手工构造接触时**必须赋 uid**（−1 会写入 typed array 陷阱静默失败）

## 必须原样复刻的怪癖（不可"改进"）

1. Body 构造时 `energy = Body.minEnergy`（World.stepSize 未设定前为 NaN）
2. `predVelocities(dt)`：rfDir 被复用为"归一化力"（先归一自身，再按各轴钳制 w），随后整体置零——原作复用技巧，不得重排
3. `step()`：`minEnergy 且 canSleep` → 立即 `setSleep()` 并 return true；`penetration≠0` 时位置追加 peneOffset 且 `canSleep=false`（返回值语义：true = 已睡/入睡，false = 仍活动）
4. `updateVProps`：vSq 低于 `Vec3.EPSILON` 时 v/dir/sq 三者原地清零
5. `applyImpulseAtPoint`：rfDir 累加的是**扭矩**（e×t），rfPower 取 max
6. v/w 的可信值必须经 `predVelocities`/`applyImpulse`/`solveContact` 路径置脏——直接 set 不置脏读到旧缓存是**原作语义**（测试即按此模型：手工 set 必先 markDirty）
7. `serialize` 非可序列化体 push `-1−floor(10·rand)`；**登记差异**：原作 Math.random → 本实现走 `coreRandom()` 播种（09-扩展规划 §0.1）
8. `deserialize` 不恢复 uid（由 World 重建环境时重排；stream 第 0 位仅残留轨迹值）
9. `Sphere invInertia = diag(1/(0.4·m·r²))`；`getMotion() = vSq + wSq·r²`
10. Solver 摩擦上限直接取 `d.x * friction`，不额外取绝对值（L9347-9352）；滚动摩擦标量独立经 `p/armLen` 传入 `applyImpulseAtPoint`（L9354-9358）
11. Solver 每轮最多贪心求解 `totalItems` 次，最多 4 轮；单接触最多求解一次即退出；穿透 `< -EPSILON` 才登记双方各半偏移，由 `Body.step` 应用（L9373-9413）
12. **碰撞门反向**（L11118-11119）：`A.collGroup & B.collMask 真则跳过`——即 **mask & group == 0 才参与碰撞**（mask = "禁撞位"语义，非常规引擎的"允许位"）
13. `ScenePendings.step2`（模91）：弹出的是"同撞刻簇"（toi ∈ [最早, 最早+tPrecision]），**返回值 = 组内最大 toi（e[out.length−1]），非最早**——球推进到最后撞点，簇内毫秒级误差由原作有意统一
14. `ScenePendings` 双栈：`stack`/`idleStack` swap；`add` 置脏 → 下轮 step2 才 resort（TOISorter 降序 + 同 toi 大穿透优先）
15. `WorldClient.predict`：预测台面 = `meshBody.slice("ground")`（只有地面多边形）；碰撞锁定后双方 `collisionMask = 12`（禁类型位——绝不能再撞）；其余球 inactivate；`getMotion() < 1` 收束阈值 + 迭代 ≤ 70
16. `World.deserialize` 先逐球恢复 23 字段、后 `reset()`（重算岛）再回填 evolution（覆盖 reset 的 ++）——顺序不得换
17. `World.reset` 中 `nRechecks !== 0` 必须抛错（确定性回放的强校验）

## 登记差异

- 原模 20 性能统计尚未移植，省略 `startTick`/`stopTick`/`count`（World.step/internalStep/求解器多处）；仅影响诊断，不影响行为。
- 原模 91 `log()` 调试方法未移植。
- 模 85 的 `interrupt` 在 callback 为 null 时退化为基础 Solver；`SolverEngine.sharedInstance` 供预测路径专用。

## 测试模型说明

测试中手工 set v/w 后调用 `markDirty();`（对应原作数据流必然经过的置脏路径）。这是保真写法，不是绕过。

## 完成定义（DoD）

`npm run test` 与 `npm run typecheck` 全绿；AGENTS.md 单元状态同步；Conventional Commits 提交并推送。
`dispose()` 未实现（原作仅置空引用，属 World 池销毁路径，落地 World 时统一补）。
