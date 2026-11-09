# core-physics：还原依据与语义约束

本文只保存算法证据与还原注意事项，不维护施工进度或产品交互。原作事实不自动约束已批准的扩展；现行设计由 [文档导航](../README.md) 指定。未明确授权改变的算法语义应保留。

## 事实来源

- 语义与常量：`docs/spec/01-物理内核.md`（§2 常量表 / §3 Body / §4 World / §5 TipContact）
- 桌面碰撞体：`docs/spec/03-袋口几何.md` + `analysis/tiger-club-sno-rgb.json`
- 原作源码（语义争议时以此为准）：`analysis/1.chunk.js`
  - 常量：L8932-8968（原模 16）/ Body：L11324-11576（原模 35）/ Sphere：L11577-11602（原模 36）
  - Contact：L11603-11707（原模 37）/ TipContact：L13645-13684（原模 86）
  - Polygon：L13360-13452（原模 82）/ MeshBody：L13472-13579（原模 84）
  - 求解器：L9322-9417（原模 21）/ 岛屿：L11048-11323（原模 34）
  - World：L11776-12105（原模 39）/ WorldClient：L14609-14745（原模 95）


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


## 检查点恢复补充

2026-11-09真实台面续杆对照：原 Body.serialize（PCOL L11324-11576 内序列字段）不包含 `rfPower/rfDir/peneOffset/penetration`，而睡眠/重置路径未统一清除这些残留。旧 World.deserialize 按既有规则重建接触岛，不能单凭球的23字段声称完整检查点。

完整检查点另外保存这些数值和静止接触岛的顺序/缓存；旧 serialize/restore 和物理公式保持原样。不以清零滚动摩擦残留作为恢复方案。原作还原接口继续用于既有预测/复位语义，完整对局存档走架构§4.12的新通道。

## 历史记录

早期实现差异、测试次数与逐次施工记录见 [迁移存档](../history/2026-11-07/core-physics.md)，不作为当前验收结果。新增证据写在本文，产品变化写所属设计文档，不再追加到 AGENTS.md。
