# core-rules：还原依据与语义约束

本文只保存算法证据与还原注意事项，不维护施工进度或产品交互。原作事实不自动约束已批准的扩展；现行设计由 [文档导航](../README.md) 指定。未明确授权改变的算法语义应保留。

## 事实来源

- 语义与算法：`docs/spec/05-规则引擎.md`（§2 犯规码 / §3 判定流 / §4 彩球重置 / §5 有效区域）
- 桌面碰撞体：`docs/spec/03-袋口几何.md` + `analysis/tiger-club-sno-rgb.json`
- 场景参数：`analysis/1.chunk.js` L9932-9948（tiger-club-sno D 区）
- 原作源码（语义争议时以此为准）：`analysis/1.chunk.js`
  - 犯规文案：L9949-9972（原模 30）/ 平面基类：L9184-9248（模 18）
  - 区段几何：L10028-10170（模 32）/ D 区圆盘：L12470-12551（模 51）
  - 点集多边形：L12552-12610（模 52）/ Ref 基类：L12611-12659（模 53）
  - SnookerRef：L12659-12822（模 54）/ Ref 注册表：L12823-12840（模 55）


## 转写时新发现的怪癖（不可"改进"）

1. **ballOn 位掩码**：RED=2、YELLOW=4、BLACK=128、COLOR_ALL=252（=2^2..2^7 求和）；具体彩球推进 = `ballOn << 1`（4→8→…→128）
2. **首触判定序**：先 jackpot COLOR_ALL 分支（`a ≤ 1`：触母球=MISS_TARGET、触红=ILLEGAL_FIRST_HIT、罚分固定 −7）；再具体球分支 `2^a !== ballOn` → foul、罚分 `min(−a, −log2(ballOn), −4)`
3. **罚分 = 罚上限为 max 语义实现取 min 负数**：`worst = min(o, d, _)` 三候选；`score = worst === 0 ? potScore : worst`
4. **哨兵 65535 分支最先判**（在球号校验前）→ `_liveRespot` 全重置 + `inHand=1`（特殊流程态）+ score 保持 0
5. 黑球终局：源码实际为`ballOn === BLACK && score !== 0 → ballOn = 0`，进袋或犯规均触发；spec原概述>0遗漏犯规路径，流程层扩展处理平分
6. `inHand=2`（手中球）当**只有**母球不活跃（`getBallAtIndex(0).active === false`）且分数为合法分支才投（score≤0 或 RED/COLOR_ALL 阶段路径）
7. **touchBalls 距离参数语义**：第三个参数 = **间隙裕量**（有用性的嵌套 = `gap = clearance + ballRadius`），默认 `1.02·ballRadius`（合并 = 2.02r）
8. `_liveRespotColorBalls` 的 `occupiedSpots[ball.number] = 1` **无论是否成功归位都登记**（有时序性副作用）
9. 重置区段法线：tColorBalls 借 spot 候选按 **getBalls() 末端**倒序（high number 先试）；占用校验用 `occupiedSpots[该 spot 归属球的 number]`
10. **中线扫描的 fallback**：`sectionsBallsAB` 失败 → 沿 `+z` 步进（`UNIT_Z`，最多 10 次），回退距离取自**上次失败扫描的最深穿透值**（`sectionResults[0]`）
11. **D 区扫位**：中母球仓 bit 后位同人 = 直径 A→B 线（半圆盘高度 offset）回退；`(depth += sectionResults[0]) > radius` 放弃回 spot（该球 spot 一定被占）
12. **D 区半径 = 0.29**（tiger-club-sno: sx=−1.33 − cx=−1.04 圆方向），与 spec 08 一致——arcDir=(−1,0,0)、diameterDir=(0,0,1)
13. `findClosestTInSections` 的**平局取左边界**（`t−left > right−t` 严格大于，相等返 left）
14. **sectionsBallsAB 的球心偏轴处理**：线段 1D 投影用球的完整 3D 球面（射线与球心求交，无 y 归零近似）——mock 测试需将线段端点 y 对齐球平面才可预判精确值
15. `Plane.intersectionWithRay` 平共判定 `h < −ε` 侧的近端点**夹 0**（不是简单的远端夹段）
16. `placeCueBallCheck` 是本项目架构补充；原作 L3725 的 reqRespotCueball 将校验逻辑内联于流程层，不能声称原作有同名公开接口。


## 历史记录

早期实现差异、测试次数与逐次施工记录见 [迁移存档](../history/2026-11-07/core-rules.md)，不作为当前验收结果。新增证据写在本文，产品变化写所属设计文档，不再追加到 AGENTS.md。
