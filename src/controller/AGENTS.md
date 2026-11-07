# 控制器 · 模块章程

继承[全局章程](../../AGENTS.md)；本文件只保留职责、工作约束和必读入口。

## 职责边界

- 负责输入、相机/球杆数值控制和出杆调度，不负责规则裁判或持久化。
- 通过 Simulator/EventBus 和装配注入的窄回调消费核心；不得读写 World、Body 或规则内部。
- 不导入 ui/render/audio。Babylon 数学与 DOM 使用本目录隔离编译，核心仍无 DOM。
- 规则拒绝、失焦和球权切换均须清理旧输入/预备动作；镜头所有权与玩家编号分离。

## 修改前必读

- [架构契约](../../docs/architecture.md)：公开接口和依赖方向。
- [本模块还原依据](../../docs/modules/controller.md)：原作出处与语义约束。
- [controller-design.md](../../docs/controller-design.md)。
- [camera-replay-design.md](../../docs/camera-replay-design.md)。
- [cue-ball-placement-design.md](../../docs/cue-ball-placement-design.md)。
- [snooker-900-design.md](../../docs/snooker-900-design.md)。

## 测试与文档纪律

数值与状态测试之外，输入变更用真实浏览器验证点击/拖动、焦点和取消。摆球产品行为只在对应设计维护，不再把旧入口描述追加回章程。

全量检查与提交规则继承全局章程。新证据写模块依据，功能要求写设计，验收写对应记录；仅本文件的职责或约束改变时更新本章程。
