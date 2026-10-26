# core/ai · 模块章程

PCOL 几何选杆机：候选流水线、路线缓存、优先级评分、拟人误差和三档难度。

## 职责边界

- 做：architecture §4.2 AIController.checkRestart/step、AIRoute、AIProfile；只消费 core 下层。
- 禁：DOM / Babylon / 网络 / Math.random；改动物理或规则层、冻结接口。
- stroke.ts 是 M1 无画面装配与测试使用的路线→击球参数适配；不承担视觉控制器。

## 事实来源

- docs/spec/06-AI.md、07-游戏流程.md §1；docs/architecture.md §2 / §4.2。
- PCOL L2497-2835（模10 RouteCache / 选杆机）、L2845-2886（难度）。
- PCOL L1731-1773（PlayArea）、L10099-10138（射线球相交）、L12632-12648（台内投影）。
- PCOL L1216-1221、L5090-5230、L5448-5455、L7615-7620（无画面击球转换）。

## 施工单元状态

- [x] route-cache.ts / task-pipeline.ts / profiles.ts。
- [x] play-area.ts / geometry.ts / pot-route.ts / bank-route.ts / stroke.ts。
- [x] 12 项测试，含两档各百局真实物理击球和完整任务降级。

## 转写时新发现的怪癖（不可"改进"）

1. 时间片原作实为 performance.now() 差值 > 0.02 毫秒，并非规格概述的 20ms；只在规定位置让出，续跑保留球号/袋号。
2. 拟人误差使用 (min(1,距离/range)×abf)²，即 abf 也平方；mpm/bpm 调整在 offset.scale 之后，实际上不改变最终方向。
3. 各 AI 实例共用一个预分配 20 条的 RouteCache；调用方须串行完成一杆，下一次重启会重用旧路线引用。
4. checkRestart 只看 evolution；只改 ballOn 不失效。随机解围仅第一象限，dx/dz 均非负。
5. 开球只检查合法目标球距 spot 的平方是否 >0.0025；空目标集合也算开球。
6. 安全球每个目标第一次畅通后就 return cache.length>=上限，不继续收集该目标的余下偏移；五档实际候选不等于每球必出五条。
7. 库边反弹 spin=-power×(dot+1)²，可恰为零；priority=1−反弹后第二段距离/10，而非总距离。
8. 硬库面有 bCenter 时不参与反弹搜索；第一条水平边即代表库面，未额外合并。
9. 5% 完美杆不再消耗误差随机数；所有随机调用保持顺序，统一走 coreRandom()。

## 登记差异

- 冻结 step(view,sim) 将原作第三参数的台内投影合并进结构 GameView；createGameView 复用规则层已有 PointSetPolygon。
- 没有待运行任务时 step 返回 null，不调用不存在的任务。
- 无画面 stroke 复用 stickAlpha 参数、支撑点/触点射线求交、力度夹取与低杆抬角；视觉控制器的走位、动画、延迟、圆锥挡杆修正不在 M1 范围。

## 测试模型说明

- RNG 用 SeededRandom；统计测试固定时钟以免时间片分段改变安全球阶段的随机消耗。
- 测试球台为自建六袋碰撞体，中袋半开口=PlayArea.pocket.radius=0.05；不是原作资产副本。
- 100 个成对种子布局：AI-1 进球 69/100，AI-3 97/100；活跃球位置/速度有限且留台内。此结果是该测试球台上的回归基线，不是完整比赛胜率。

## 完成定义（DoD）

npm run test 与 npx tsc --noEmit 全绿；同步章程；Conventional Commits 提交并推送。

## 提名扩展

- AIRoute暴露已有ballBIndex元数据；安全球和翻库也填入候选目标，随机解围以当前合法目标集合首项为声明意图。原方向/随机消耗/评分不变，只有进球路线仍执行applyChaos。
- 目的：AI打偏时不能把误碰到的彩球倒推为目标，浏览器/Node在出杆前使用同一GameSession.nominate。
