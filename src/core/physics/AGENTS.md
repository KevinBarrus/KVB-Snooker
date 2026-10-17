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
- [ ] `island.ts`
- [ ] `world.ts` / `world-client.ts`

## 必须原样复刻的怪癖（不可"改进"）

1. Body 构造时 `energy = Body.minEnergy`（World.stepSize 未设定前为 NaN）
2. `predVelocities(dt)`：rfDir 被复用为"归一化力"（先归一自身，再按各轴钳制 w），随后整体置零——原作复用技巧，不得重排
3. `step()`：`minEnergy 且 canSleep` → 立即 `setSleep()` 并 return true；`penetration≠0` 时位置追加 peneOffset 且 `canSleep=false`
4. `updateVProps`：vSq 低于 `Vec3.EPSILON` 时 v/dir/sq 三者原地清零
5. `applyImpulseAtPoint`：rfDir 累加的是**扭矩**（e×t），rfPower 取 max
6. v/w 的可信值必须经 `predVelocities`/`applyImpulse`/`solveContact` 路径置脏——直接 set 不置脏读到旧缓存是**原作语义**（测试即按此模型：手工 set 必先 markDirty）
7. `serialize` 非可序列化体 push `-1−floor(10·rand)`；**登记差异**：原作 Math.random → 本实现走 `coreRandom()` 播种（09-扩展规划 §0.1）
8. `deserialize` 不恢复 uid（由 World 重建环境时重排；stream 第 0 位仅残留轨迹值）
9. `Sphere invInertia = diag(1/(0.4·m·r²))`；`getMotion() = vSq + wSq·r²`
10. Solver 摩擦上限直接取 `d.x * friction`，不额外取绝对值（L9347-9352）；滚动摩擦标量独立经 `p/armLen` 传入 `applyImpulseAtPoint`（L9354-9358）
11. Solver 每轮最多贪心求解 `totalItems` 次，最多 4 轮；单接触最多求解一次即退出；穿透 `< -EPSILON` 才登记双方各半偏移，由 `Body.step` 应用（L9373-9413）

## Solver 登记差异

- 原模 20 性能统计尚未移植，省略 `startTick` / `stopTick` / `count`（L9361、L9371、L9384、L9396）；仅影响诊断，不影响求解行为。
- 岛屿实现尚未施工，Solver 内仅声明 `dirty` / `totalItems` / `itemEntry` / `next` 的结构类型供链表输入使用，不实现岛屿管理。

## 测试模型说明

测试中手工 set v/w 后调用 `markDirty();`（对应原作数据流必然经过的置脏路径）。这是保真写法，不是绕过。

## 完成定义（DoD）

`npm run test` 与 `npm run typecheck` 全绿；AGENTS.md 单元状态同步；Conventional Commits 提交并推送。
`dispose()` 未实现（原作仅置空引用，属 World 池销毁路径，落地 World 时统一补）。
