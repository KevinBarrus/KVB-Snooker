# core · M1 装配单元章程

## 职责边界

- game.ts / player.ts 装配 simulator、rules 和回合权机；demo.ts 是用户明确要求的 Node 终端入口。
- 下层 math/physics/simulator/rules/ai 不能反向依赖装配根；禁止 DOM / Babylon / 网络。
- demo.ts 仅异步读取命令行指定的本地台面数据，不提交 analysis/ 资产。

## 事实来源

- docs/architecture.md §5 / §8；docs/spec/07-游戏流程.md。
- PCOL L3660-3772（回合、双模式、结算）、L8922-8931（gState）、L9973-10025（Player）、L7704-7716（总分）。

## 施工单元状态

- [x] 普通犯规选择与黑球平分：DECIDING阻止出杆；持权者选择接手/对手从当前位置继续，罚分不回滚；平分重新摆黑、非本局开球方直接D区先打（第二轮覆盖首轮抽签）。reset清空待选择状态，Node demo显式接手。

- [x] 规则扩展第一步：GameOptions注入席位与FrameSetup，GameMode不新增测试值；初始化先验证并复制局面，reset恢复球位、姿态、双方统计与规则上下文。测试工具不进入核心依赖。

- [x] player.ts / game.ts / demo.ts；npm run demo 接入；5 项真实物理/规则回合测试。
- [x] event-bus.ts：docs/architecture.md §3 事件目录 + ContactEvent/FoulEvent/BallOnChangedEvent/FrameEvents 载荷契约；on/off/emit（类型化，≤100 行），on 返回取消函数，emit 快照遍历。测试 tests/unit/event-bus.spec.ts。
- 验收：189 项全量测试与 tsc 通过；原作 22 球台面单局 52 杆结束，ballOn=0，总分 61:65，最高 break 14:39；practice 完成 3 杆。

## 转写时新发现的怪癖（不可"改进"）

1. 罚分累积在犯规玩家的负 penalty，显示总分为本人 pts−对方 penalty；不会直接给对手 pts 加分。
2. 一杆得分 >0 保留玩家并累计 brk；≤0 清零 brk 后按玩家数取模换人，practice 因此仍为同一人。
3. 原作结算后快进上限 200 次，每次 step(0.1)，存档后再进入 READY；终局仍以 READY + ballOn=0 表示；扩展选择阶段以DECIDING表示。
4. Player.maxbrk 由 brk setter 取历史最大值；scoreCount 仅正分杆增长。

## 登记差异

- WPBSA §3.4/10/13扩展：普通犯规后等待对方选择；普通犯规保留当前位置；第二轮Miss允许原位恢复。末黑进袋或犯规后按含罚分总分检查平局，平局不结束。平分决胜清空当前单杆但保留历史最高单杆和累计分数。
- placeCueBall补充核心inHand权限检查，不再允许非手中球时直接改位。

- 用户批准双人规则测试装配，single-play可注入两个USER；规则仍走同一SnookerRef。FrameSetup重置将姿态恢复单位四元数；物理evolution仍按reset增长，不能拿缓存版本号当作比赛状态。第二轮已加入Miss复位重打，详见下文。

- 终局 ballOn=0 后拒绝继续击球，遵循 rules 章程对流程层的约束，避免原作 log2(0) 缺陷。
- Node 装配默认首局玩家0；第二轮恢复PCOL L3700-3714每次reset交替，包括中途重开。
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

## 提名接入

- nominate手选或恢复自动；prepareStroke在动画开始前冻结意图，stroke为Node调用补做同一校验；目标不明确拒绝出杆，不罚分、不计杆数。完成本杆或reset清除提名，冻结后禁止摆球和改提名。
- Node demo按AI路线目标提名，不利用实际首触结果。

贴球扩展：GameSession.touchingBallIndices只读计算杆前贴球，浏览器显示打离提示；实际裁判消费Simulator接触证据，不借用显示帧或终点距离。

## 自由球资格与流程

犯规后先完成复位和静止，再判断目标两侧可达性；有手中球时检查整个D区。接手保留freeBallAvailable，要求犯规方继续则撤销。nominate显式选择非目标作为自由球，null为放弃；prepareStroke冻结freeBallIndex，结束/reset清空。AI目前直接解原目标，不增加策略搜索。

## 第二轮：Miss与共用原位恢复

杆前快照在prepareStroke成功时捕获，含世界、阶段、球权、手中球及Miss所需分差/剩余分。restorePreviousShot在比赛只接受持权者的Miss复位，在练习允许READY时重试上一杆（本轮无按钮）；保留罚分/杆数/最高单杆，不恢复被中断的brk；reset清空快照。自由球资格与提名清空，彩球阶段可以重新提名。

第二轮开球：GameOptions.openingPlayerIndex指定本局开球方；普通reset交替，setup完整重置不交替。争黑直接由非本局开球方D区先打，不产生black选择，不推进新局序列；这是用户批准的固定先手政策。

补充回归：Miss与自由球同时成立时，复位撤销本次自由球资格并保留罚分；浏览器复位重新创建当前难度AI，避免恢复相同evolution后旧搜索任务不重启。
