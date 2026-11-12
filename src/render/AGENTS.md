# 渲染 · 模块章程

继承[全局章程](../../AGENTS.md)；本文件只保留职责、工作约束和必读入口。

## 职责边界

- 负责 Babylon 场景、材质与显示，只消费 Simulator 的只读 BallView 或等价回放视图。
- 不访问 World/Body，不驱动物理，不导入 ui/audio/controller；跨层装配由 app 完成。
- 独立 DOM 编译环境，不向 core 引入浏览器类型；原模型、贴图和生成资产不提交。
- 涉及外观与布局须阅读 UI 章程中的用户设计原则；物理姿态不能被视觉效果反向修改。

## 修改前必读

- [架构契约](../../docs/architecture.md)：公开接口和依赖方向。
- [本模块还原依据](../../docs/modules/render.md)：原作出处与语义约束。
- [controller-design.md](../../docs/controller-design.md)。
- [camera-replay-design.md](../../docs/camera-replay-design.md)。
- [snooker-900-design.md](../../docs/snooker-900-design.md)。

## 测试与文档纪律

NullEngine 测试快照与资源所有权，浏览器验证真实显示；截图与软件 WebGL 测试不能冒充真实 GPU 性能或逐像素还原。

全量检查与提交规则继承全局章程。新证据写模块依据，功能要求写设计，验收写对应记录；仅本文件的职责或约束改变时更新本章程。
