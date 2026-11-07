# AI · 模块章程

继承[全局章程](../../../AGENTS.md)；本文件只保留职责、工作约束和必读入口。

## 职责边界

- 只消费 core 下层与架构接口，不依赖 DOM、Babylon、网络或视觉控制器。
- 随机统一走 coreRandom，禁止 Math.random；视觉出杆与无画面路线适配分开。
- 正式出杆遵守和人类相同的规则、提名与计时，不能绕过对局权限。

## 修改前必读

- [架构契约](../../../docs/architecture.md)：公开接口和依赖方向。
- [本模块还原依据](../../../docs/modules/core-ai.md)：原作出处与语义约束。
- [snooker-900-design.md](../../../docs/snooker-900-design.md)。
- [multiplayer-protocol-design.md](../../../docs/multiplayer-protocol-design.md)。

## 测试与文档纪律

固定种子和测试时钟，避免执行调度改变统计回归；单球台命中率不得宣称完整比赛胜率。多房间前核查共享缓存和随机源隔离。

全量检查与提交规则继承全局章程。新证据写模块依据，功能要求写设计，验收写对应记录；仅本文件的职责或约束改变时更新本章程。
