# 核心装配 · 模块章程

继承[全局章程](../../AGENTS.md)；本文件只保留职责、工作约束和必读入口。

## 职责边界

- 装配 simulator、rules、ai、玩家与回合流程；下层不得反向依赖本目录的装配根。
- 核心时间由外部输入，测试使用可控数值；不以显示帧、物理快进或 UI 状态代替规则时钟。
- 业务结果由核心裁决，浏览器和未来服务端通过已登记命令消费；基础设施不进入核心。
- 整场进度与单局裁判分离；MatchProgress 只接收已裁决的局结果，开球选择由装配注入，重摆尝试不得推进局序号或已完成局分。
- demo 是 Node 验收装配，允许读取命令行指定的本地台面；不提交原作资源。

## 修改前必读

- [架构契约](../../docs/architecture.md)：公开接口和依赖方向。
- [本模块还原依据](../../docs/modules/core.md)：原作出处与语义约束。
- [rules-v2-design.md](../../docs/rules-v2-design.md)。
- [snooker-900-design.md](../../docs/snooker-900-design.md)。
- [match-lifecycle-design.md](../../docs/match-lifecycle-design.md)。
- [match-persistence-design.md](../../docs/match-persistence-design.md)。
- [match-progress-design.md](../../docs/match-progress-design.md)。

## 测试与文档纪律

回合测试使用真实 Simulator 与规则；预设通过公开初始化/归位路径准备，不替换判分。恢复必须清理派生缓存，不能拿 evolution 当完整比赛存档。

全量检查与提交规则继承全局章程。新证据写模块依据，功能要求写设计，验收写对应记录；仅本文件的职责或约束改变时更新本章程。
