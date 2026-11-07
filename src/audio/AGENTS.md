# 声音 · 模块章程

继承[全局章程](../../AGENTS.md)；本文件只保留职责、工作约束和必读入口。

## 职责边界

- 纯选样/混音决策与实际发声后端分开，策略保持 Node 可测试。
- 只消费类型化 Simulator/EventBus 事件；不读取物理内部，不导入 ui/render/controller 或 Babylon。
- 原生 Web Audio 只在已批准的浏览器后端和独立 DOM 工程内使用；不是整个模块禁止 DOM，也不是策略层可任意用 DOM。
- 声音随机不消费 core 随机序列；缺失资产和播放失败不能阻塞对局；媒体不提交。

## 修改前必读

- [架构契约](../../docs/architecture.md)：公开接口和依赖方向。
- [本模块还原依据](../../docs/modules/audio.md)：原作出处与语义约束。
- [audio-v1-design.md](../../docs/audio-v1-design.md)。
- [audio-resampling.md](../../docs/audio-resampling.md)。
- [audio-v2-listening-handoff.md](../../docs/audio-v2-listening-handoff.md)。

## 测试与文档纪律

验证事件时序、纯策略、资源释放和真实发声；自动数值检查不代替人工试听。历史 no-op 调用兼容不代表当前真实音效链路没有实现。

全量检查与提交规则继承全局章程。新证据写模块依据，功能要求写设计，验收写对应记录；仅本文件的职责或约束改变时更新本章程。
