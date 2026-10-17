# core/math · 模块章程

自研三维数学库：`Vec3` / `Matrix3` / `Quaternion`。物理引擎的地基，全项目最底层模块。

## 职责边界

- 做：三个类的全部数值方法与常量，语义与原作逐字节等价（含怪癖，见下）
- 禁：任何 import（本模块零依赖）；依赖 DOM/Babylon；改公开签名（接口冻结于 `docs/architecture.md` §4.1）；新增原作没有的方法——需要新能力时先回顾原作再议

## 事实来源

- 接口签名：`docs/architecture.md` §4.1 Vector/Matrix/Quaternion
- 算法语义与原作怪癖：`docs/spec/01-物理内核.md` §3
- 原作源码（语义有争议时以此为准）：`analysis/1.chunk.js`
  - Vec3：L8500-8778（原模 12 命名空间 `www.physicsmath` 入口 `Vec3: i(12)`）
  - Matrix3：L8969-9184（原模 17）
  - Quaternion：L9633-9835（原模 23）

## 必须原样复刻的怪癖（video 不可"改进"）

1. `Vec3`：`normalize()` 零向量 → 全 0（不清除 NaN）；`scaleVector(s, v)` 参序为标量在前；`almostEquals` 阈值固定 `EPSILON=1e-6`，不得参数化
2. `Matrix3`：`set(9参)` 为**行主序入参、列主序存储**（`data[0..2]` 是第一列），`copy/fromArray/clone` 均按此转换；`setInverse` 奇异时仅 `console.warn` 并置 identity
3. `Quaternion`：`normalize()` 零长度 → 重置为 `(0,0,0,1)`；`integrate(ω, dt)` = `q + ½·dt·(ω⊗q)` 后归一；`integrateQuad` 为对称梯形变体，公式照抄不可重排

## 测试要求

`tests/unit/math.spec.ts`：常量断言（EPSILON、UNIT 向量）、每个方法的已知值断言、原作回归语义（上述 3 条怪癖各至少 1 例）、`applyQuaternion` 主动旋转验证（X 绕 Y 90° → −Z）。

## 完成定义（DoD）

`npm run test` + `npm run typecheck` 全绿，接口与 `architecture.md` §4.1 完全对齐，方可提交。
