# 模拟器 · 模块章程

继承[全局章程](../../../AGENTS.md)；本文件只保留职责、工作约束和必读入口。

## 职责边界

- 装配物理世界，提供架构约定的结果、预测和只读视图；禁止 DOM、Babylon、网络及反向依赖 rules。
- 通过结构满足 RefSimulator，不导入规则实现；观察证据不得增加求解次数或修改冲量。
- 完整检查点与旧物理 SerialData 分开维护；完整恢复须含不活跃球姿态及上杆证据，先验证再写入。旧 restore 清证据及 predict 隔离语义不变。
- 对外只读快照不得泄漏可变内部对象；预测隔离真实结果、规则证据和声音事件。

## 修改前必读

- [架构契约](../../../docs/architecture.md)：公开接口和依赖方向。
- [本模块还原依据](../../../docs/modules/core-simulator.md)：原作出处与语义约束。
- [controller-design.md](../../../docs/controller-design.md)。
- [rules-v2-design.md](../../../docs/rules-v2-design.md)。
- [audio-v1-design.md](../../../docs/audio-v1-design.md)。
- [snooker-900-design.md](../../../docs/snooker-900-design.md)。

## 测试与文档纪律

手工改 v/w 时执行物理置脏路径；球台使用测试 MeshBody 构造。验证预测、恢复和视图拷贝不会污染真实对局。

全量检查与提交规则继承全局章程。新证据写模块依据，功能要求写设计，验收写对应记录；仅本文件的职责或约束改变时更新本章程。
