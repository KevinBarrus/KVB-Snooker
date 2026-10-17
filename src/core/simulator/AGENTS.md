# core/simulator · 模块章程

PCOL 模拟器装配、球 wrapper 与单杆结果统计。

## 职责边界

- 做：architecture §4.2 Simulator / Ball / ShotResult / SerialData / PredictionContext；消费 WorldClient。
- 禁：DOM / Babylon / 网络 / rules 反向依赖；修改冻结签名或已完成物理层。
- RefSimulator 所需方法由本类结构满足，不 import rules。

## 事实来源

- docs/architecture.md §2 / §4.2；docs/spec/01-物理内核.md、02-击球链路.md。
- PCOL L12273-12510（模49 Ball / 模50 Simulator）、L9270-9277（结果）、L14746-14758（默认球组）。

## 施工单元状态

- [x] ball.ts / scene.ts / shot-result.ts / simulator.ts（15 项单测，含真实 SnookerRef 接入）。

## 转写时新发现的怪癖（不可"改进"）

1. ballSet 按 number/x/z 三元组读取，y = ground.centerPosition.y + ballRadius；球 wrapper 构造位置为零，reset 才搬到 spot。
2. 同步重建判据仅球数、半径、质量；同样数量的新 ballSet 不会更新旧 spot。
3. nKissed 仅统计涉及母球的 SS 接触；potted 仅来自非 SS 的 end 面，跌过最低边界算 outOfBounds。
4. touchBalls 阈值为 (clearance+r)²−EPSILON，默认 clearance=1.02r；规则重置采用 1.05r。
5. reset 第二个参数实际控制 clearResult，不是是否归位；hard 才重置位置。
6. stroke/resetBallXYZ/resetBallPosition(null) 仅令本地 nAwakened++，step 才刷新为物理计数。

## 登记差异

- 构造接受已加载 MeshBody + SceneParameters；sync/_checkSyncList 同步装配，省略原作缓存轮询 setTimeout、加载事件与浏览器事件发射。
- getBallView/getCueBallPosition/getResult/predict 的契约视图返回拷贝；Ref 所需内部 getBalls/result 保留原作引用语义。
- 架构 BallView.async 无原作对应字段，映射为 active && !asleep，表示仍在演化的球。
- predict 先保存当前世界，避免依赖浏览器 gameflow 先调用 save 的时序。

## 测试模型说明

手工 set v/w 后必须置脏并递增 vChangedCount；测试球台按 world.spec.ts 的 MeshBody 构造路径生成。原作文件仅本地读取，禁止提交 analysis/。

## 完成定义（DoD）

npm run test 与 npx tsc --noEmit 全绿；同步章程；Conventional Commits 提交并推送。
