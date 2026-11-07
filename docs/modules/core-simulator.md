# core-simulator：还原依据与语义约束

本文只保存算法证据与还原注意事项，不维护施工进度或产品交互。原作事实不自动约束已批准的扩展；现行设计由 [文档导航](../README.md) 指定。未明确授权改变的算法语义应保留。

## 事实来源

- docs/architecture.md §2 / §4.2；docs/spec/01-物理内核.md、02-击球链路.md。
- PCOL L12273-12510（模49 Ball / 模50 Simulator）、L9270-9277（结果）、L14746-14758（默认球组）。


## 转写时新发现的怪癖（不可"改进"）

1. ballSet 按 number/x/z 三元组读取，y = ground.centerPosition.y + ballRadius；球 wrapper 构造位置为零，reset 才搬到 spot。
2. 同步重建判据仅球数、半径、质量；同样数量的新 ballSet 不会更新旧 spot。
3. nKissed 仅统计涉及母球的 SS 接触；potted 仅来自非 SS 的 end 面，跌过最低边界算 outOfBounds。
4. touchBalls 阈值为 (clearance+r)²−EPSILON，默认 clearance=1.02r；规则重置采用 1.05r。
5. reset 第二个参数实际控制 clearResult，不是是否归位；hard 才重置位置。
6. stroke/resetBallXYZ/resetBallPosition(null) 仅令本地 nAwakened++，step 才刷新为物理计数。
7. 原作渲染读取 states.position / states.orientation，阴影显隐却用物理 position.y（L1886-1900）；不能把 BallView.position 改成显示位置。
8. WorldClient 显示位置按剩余时间外推；剩余时间大于 stepSize 时改用 0（L14706-14714）。predict 使用 internalStep，不刷新 states，结束还原物理状态后保留原显示姿态（L14715-14741）。
9. Body.reset 清速度并重摆位置，但不重置 orientation（L11535-11546）；显示快照必须保留重摆前的物理朝向。

10. 预测开始仅重置命中标志和起点；无撞击时 p1、p2、target 等旧值残留（L14644-14681），必须按 impactOccured/hasImpactTarget 取用，不能主动清零。


## 历史记录

早期实现差异、测试次数与逐次施工记录见 [迁移存档](../history/2026-11-07/core-simulator.md)，不作为当前验收结果。新增证据写在本文，产品变化写所属设计文档，不再追加到 AGENTS.md。
