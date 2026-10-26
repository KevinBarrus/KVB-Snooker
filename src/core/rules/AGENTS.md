# core/rules · 模块章程

PCOL 斯诺克规则引擎：犯规枚举、有效区域几何、ballOn/ball-in-hand 状态机、彩球/母球花纹重置告警、D 区扫位。

## 职责边界

- 做：`docs/architecture.md` §4.2 定义的 Ref / RulesContext / FOUL 及其内部几何工具
- 禁：import DOM / Babylon / 网络库；import `core/simulator`（兄弟层，不可引用）；改架构冻结的公开签名
- 允许 import：`core/math/*`、本目录文件
- 与 Simulator 的耦合：结构化类型 `RefSimulator`（本目录声明）——`simulator` 实现同一结构即可，无需引反向依赖

## 事实来源

- 语义与算法：`docs/spec/05-规则引擎.md`（§2 犯规码 / §3 判定流 / §4 彩球重置 / §5 有效区域）
- 桌面碰撞体：`docs/spec/03-袋口几何.md` + `analysis/tiger-club-sno-rgb.json`
- 场景参数：`analysis/1.chunk.js` L9932-9948（tiger-club-sno D 区）
- 原作源码（语义争议时以此为准）：`analysis/1.chunk.js`
  - 犯规文案：L9949-9972（原模 30）/ 平面基类：L9184-9248（模 18）
  - 区段几何：L10028-10170（模 32）/ D 区圆盘：L12470-12551（模 51）
  - 点集多边形：L12552-12610（模 52）/ Ref 基类：L12611-12659（模 53）
  - SnookerRef：L12659-12822（模 54）/ Ref 注册表：L12823-12840（模 55）

## 施工单元状态

- [x] `foul.ts`（模 30：FOUL 位掩码 + getFoulDescription 点位文案）
- [x] `region.ts`（模 18 Plane + 模 32 sections + 模 51 DiscRegion + 模 52 PointSetPolygon）
- [x] `snooker.ts`（模 53 Ref 基类 + 模 54 SnookerRef + 模 29 D 区参数 + 模 55 RefRegistry；16 项单测）

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
16. 模zhi的 `placeCueBallCheck` 是架构补充（原作 L3725 reqRespotCueball 的 ref 侧校验逻辑 свед内联于 gameflow 层）

## 登记差异

- 原作已知缺口与作者 README 一致：free ball 未实现、指定彩球未实现、play again 未实现——用户批准的扩展现已补齐指定彩球与普通犯规play again，自由球也已补齐，范围见下文
- `ballOn = 0`（终局态）时 `checkResult` 的 `log2(0) = −∞` 罚分问题为**原作潜在缺陷**，1:1 复刻保留（不应触发于终局后再击的场景，架构依赖 flow 层拦截）

## 测试模型说明

`tests/unit/rules.spec.ts` 内含 `MockBall/MockSim` 直实现 `RefSimulator` 结构契约——模拟器层落地时应改绑真对象做同用例回归（届时不删本 spec，标注兼容）。

## 完成定义（DoD）

`npm run test`（157 项）与 `npm run typecheck` 全绿；AGENTS.md 单元状态同步；Conventional Commits。

## 规则扩展：彩球提名

- GameSession传入本杆冻结的nominatedBallIndex时，COLOR_ALL按指定球而非实际首碰判定和罚分；缺省保留原作Ref直接调用的行为，正式对局必经提名校验。
- nomination.ts以水平球心射线和2r碰撞包络判断最近目标；前方红球遮挡、同时接触歧义、任意贴彩球时不猜测。接触/歧义容差1e-5m，不等于原作touchBalls的摆球间隙。全台计算无辅助线长度限制。
- 新发现的原作缺口：PCOL以实际首触决定COLOR_ALL，此扩展明确替代；原有其余复位与阶段推进不变。规则参照WPBSA §2.12、§3.8/11。

## 规则扩展：贴球

- 可选接触证据用于实际首碰组、贴球首触豁免和PUSH_STROKE(32)。贴合法球可打离无需再碰；贴非目标不算新首碰，仍须打到目标；进红后贴彩球须提名。
- 推杆只依据原接触未分离时母球施加的有效直接冲量，不比较杆尾位移；后来间接碰动或分离后回撞不误判原贴球推杆。两红同时首触允许，其他非合法球同时首触按最高涉及球罚分。
- 此单元是WPBSA §3.8的贴球扩展，不声称模拟了皮头持续接触/二次击球或所有抬杆跳球犯规。

## 规则扩展：自由球

- adjudicate.ts独立计算分数与犯规，SnookerRef继续负责原复位和阶段推进。原COLOR_ALL未提名的直接Ref调用仍兼容，正式流程先冻结提名。
- snookered.ts按合法目标两侧极边判断，其他红不遮红、库不构成斯诺克。按最近阻挡球计算有效障碍；不同红被不同彩球挡住时无共同有效障碍。
- in-hand-visibility.ts将D区投影到局部平面，用目标/障碍2r圆的公切线、交圆切线、摆球禁区圆和D圆构成可达性边界；取交点横坐标及分区内部代表点，检查整个分区，而非固定网格采样。1e-9m射线容差、1e-11m分区去重；实际摆球仍由既有touchBalls/DiscRegion复核。
- 自由球必须显式提名；首碰提名球或与目标同时首碰；按目标值计分，进袋复位。红阶段真红与自由球累加；清彩同进仅计目标一次，只进自由球阶段不推进。自由球犯规涉及该球时按替代分值处罚。
- 无得分时以自由球再次做斯诺克判64，粉黑/黑与另一彩球两子球例外；红黑不能套例外。让犯规方继续取消资格，不要求先判Miss。
- 这些为WPBSA §2.17、§3.12扩展，不改变原物理与袋口几何；未实现Miss自动裁判/原位复打。

末黑判负边界补充：仅剩黑球才因一次犯规结束；黑球与额外彩球仍在台上时保留黑球阶段。全量361项测试、typecheck/build与浏览器规则验收通过。

## 第二轮：简化Miss

miss.ts按首碰犯规位及击球前后双方是否需要罚分判定；分差等于剩余分可追平，只有超过才排除Miss。availablePoints含每颗红后的最高彩球及COLOR_ALL当前彩球机会；清彩只算当前及之后的目标。不判断尽力、故意、完全无解或连续三次判负；这是用户批准的简化规则，不声称完整官规。合法贴球打离沿用adjudicate首碰豁免。
