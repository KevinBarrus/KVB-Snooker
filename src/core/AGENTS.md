# core · M1 装配单元章程

## 职责边界

- game.ts / player.ts 装配 simulator、rules 和回合权机；demo.ts 是用户明确要求的 Node 终端入口。
- 下层 math/physics/simulator/rules/ai 不能反向依赖装配根；禁止 DOM / Babylon / 网络。
- demo.ts 仅异步读取命令行指定的本地台面数据，不提交 analysis/ 资产。

## 事实来源

- docs/architecture.md §5 / §8；docs/spec/07-游戏流程.md。
- PCOL L3660-3772（回合、双模式、结算）、L8922-8931（gState）、L9973-10025（Player）、L7704-7716（总分）。

## 施工单元状态

- [x] 规则扩展第一步：GameOptions注入席位与FrameSetup，GameMode不新增测试值；初始化先验证并复制局面，reset恢复球位、姿态、双方统计与规则上下文。测试工具不进入核心依赖。

- [x] player.ts / game.ts / demo.ts；npm run demo 接入；5 项真实物理/规则回合测试。
- [x] event-bus.ts：docs/architecture.md §3 事件目录 + ContactEvent/FoulEvent/BallOnChangedEvent/FrameEvents 载荷契约；on/off/emit（类型化，≤100 行），on 返回取消函数，emit 快照遍历。测试 tests/unit/event-bus.spec.ts。
- 验收：189 项全量测试与 tsc 通过；原作 22 球台面单局 52 杆结束，ballOn=0，总分 61:65，最高 break 14:39；practice 完成 3 杆。

## 转写时新发现的怪癖（不可"改进"）

1. 罚分累积在犯规玩家的负 penalty，显示总分为本人 pts−对方 penalty；不会直接给对手 pts 加分。
2. 一杆得分 >0 保留玩家并累计 brk；≤0 清零 brk 后按玩家数取模换人，practice 因此仍为同一人。
3. 结算后快进上限 200 次，每次 step(0.1)，存档后再进入 READY；终局仍以 READY + ballOn=0 表示。
4. Player.maxbrk 由 brk setter 取历史最大值；scoreCount 仅正分杆增长。

## 登记差异

- 用户批准双人规则测试装配，single-play可注入两个USER；规则仍走同一SnookerRef。FrameSetup重置将姿态恢复单位四元数；物理evolution仍按reset增长，不能拿缓存版本号当作比赛状态。未实现Miss复位重打。

- 终局 ballOn=0 后拒绝继续击球，遵循 rules 章程对流程层的约束，避免原作 log2(0) 缺陷。
- Node 装配首局固定玩家 0 开球；原作跨局 Ae++ 轮换先手未移植。
- 自动装置用 AI 驱动 USER/AI 玩家列表，仅为 M1 验收；practice 与 single-play 仍是两种原作模式。
- demo 默认读取本地 analysis/tiger-club-sno-rgb.json，可用 --table 指定合法 MeshBody JSON；未增加资产下载和视觉控制器。
- AI 保留 0.02ms 时间切片，安全球任务每次续跑重新取随机参数；因此即使 seed 相同，机器调度也可能改变整局的随机消耗与结果。

## 已知集成风险

- 未修改已完成 physics 层。完整对局曾触发 Island.merge 空链异常；只读诊断发现 actings.__pureIsland 第二遍搬移后使用搬移前 nextScan，而原作 L14519-14535 沿搬移后 i.next 重扫。
- 最小复现：5 球接触按 A-B、D-E、C-D、B-C 加入，再标记 needsPure；当前会将一个连通岛拆成两个，C 同时出现在两岛。已有测试未覆盖此排列；修复需用户另行允许修改物理地基。

## 测试模型说明

回合测试消费真实 Simulator + SnookerRef；摆设残局仅改变公开归位路径，不替换物理结算或规则判分。

## 完成定义（DoD）

npm run test、npx tsc --noEmit 全绿；npm run demo 完成单局，practice 演示可运行；提交并推送。
