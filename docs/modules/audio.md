# audio：还原依据与语义约束

本文只保存算法证据与还原注意事项，不维护施工进度或产品交互。原作事实不自动约束已批准的扩展；现行设计由 [文档导航](../README.md) 指定。未明确授权改变的算法语义应保留。

## 转写时新发现的怪癖（不可"改进"）

1. 普通接触 label 是 `idi + "->" + idj`，不是材质名（PCOL L9426-9428）；皮头 label 固定 `tip`，且 isSS=false（L13650-13655）。按 tip 优先，其余按 isSS 分类，不能把所有 false 都当普通球库碰撞。
2. touchPresolveHandler 仅在新接触 life=0、startResting 后调用；持续接触走 markRecheck（L12091-12094）。audio 按事件播放，不自行按帧补发或去重。
3. World.shoot 直接求解 TipContact 并释放，没有调用 touchPresolveHandler（L11864-11870）。集成方若需皮头声，必须在相应时机提供现有契约的 tip 接触事件。
4. Simulator 通过 end 接触记录 POTTED、tunnel 接触记录 PREPOT，另由 outOfBoundsHandler 记录 OUT_OF_BOUNDS（L12351-12365）；进袋与出界不是同一事件。


## 历史记录

早期实现差异、测试次数与逐次施工记录见 [迁移存档](../history/2026-11-07/audio.md)，不作为当前验收结果。新增证据写在本文，产品变化写所属设计文档，不再追加到 AGENTS.md。
