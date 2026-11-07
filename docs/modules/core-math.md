# core-math：还原依据与语义约束

本文只保存算法证据与还原注意事项，不维护施工进度或产品交互。原作事实不自动约束已批准的扩展；现行设计由 [文档导航](../README.md) 指定。未明确授权改变的算法语义应保留。

## 事实来源

- 接口签名：`docs/architecture.md` §4.1 Vector/Matrix/Quaternion
- 算法语义与原作怪癖：`docs/spec/01-物理内核.md` §3
- 原作源码（语义有争议时以此为准）：`analysis/1.chunk.js`
  - Vec3：L8500-8778（原模 12 命名空间 `www.physicsmath` 入口 `Vec3: i(12)`）
  - Matrix3：L8969-9184（原模 17）
  - Quaternion：L9633-9835（原模 23）


## 必须原样复刻的怪癖（不可"改进"）

1. `Vec3`：`normalize()` 零向量 → 全 0（不清除 NaN）；`scaleVector(s, v)` 参序为标量在前；`almostEquals` 阈值固定 `EPSILON=1e-6`，不得参数化
2. `Matrix3`：`set(9参)` 落位后 transform 的有效矩阵为参数矩阵的转置；`setInverse` 奇异时仅 `console.warn` 并置 identity
3. `Quaternion`：`normalize()` 零长度 → 重置为 `(0,0,0,1)`；`integrate(ω, dt)` = `q + ½·dt·(ω⊗q)` 后归一；`integrateQuad` 为对称梯形变体，公式照抄不可重排
4. `Matrix3.multiply(this)` **自乘别名**：写入先于读取污染后续行（结果见回归测试"原作自乘别名语义"），上层 need 双份时由调用方自行 clone——与原作逐字节一致


## 与原作的已登记差异

- `Matrix3.clone()`：原作 L9017-9019 返回数字 9（`fromArray` 返回值泄漏，游戏内无调用点），本实现返回 `Matrix3`。其余方法与原作逐字节等价。


## 历史记录

早期实现差异、测试次数与逐次施工记录见 [迁移存档](../history/2026-11-07/core-math.md)，不作为当前验收结果。新增证据写在本文，产品变化写所属设计文档，不再追加到 AGENTS.md。
