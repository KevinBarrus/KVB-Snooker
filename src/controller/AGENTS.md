# controller · 模块章程

## 职责边界

- 站立/瞄准、相机走位、球杆触点与越障、输入、出杆时序、手中球交互、AI 控制通道。
- core 仅通过 Simulator 只读视图/命令和 EventBus 消费；GameSession/规则/AI 由 app.ts 装配，通过窄回调传入，不读取 World 或 Body。
- 不 import ui/render/audio；相机、球杆和 UI 输出由装配根接线。
- Babylon 数学可用，DOM 编译在本目录隔离；不改核心算法和冻结接口。

## 事实来源

docs/controller-design.md 记录 REA 身份证据、原作行号、规格修正和接口提案。逐段源码为最终判据。

## 施工单元状态

- [x] 观察扩展单元2：三模式、V动态切换、首碰子球锁定、落袋冻结、按视场加强的限速平滑；299项测试、typecheck、build、Chrome camera专项通过。偏好与短提示由装配根接入。

- [x] 观察扩展单元1：默认自然起身、稳定焦点、拖动手动接管；295项测试、typecheck、build、Chrome controller通过。位置轨迹不变，登记用户批准差异。

- [x] 相机与球杆数值控制、独立单测：12 项相机 + 9 项球杆/动画测试，全量270项与 typecheck 通过。
- [x] 输入、出杆时序、手中球与 AI 接入；新增6项流程测试，全量278项（含预测循环2项回归）、typecheck 和 Chrome 键鼠/练习回合/AI接棒验收通过。
- [x] 球杆模型/材质、摆球标记、既有 UI 联动与浏览器装配；全量279项、typecheck、build、Chrome controller/render 验收通过。
- [x] 原作五段辅助线：用户已批准9字段 PredictionContext 扩展并完成三步实施；全量290项、typecheck、build 和 Chrome gunsight/controller/render 验收通过。
- [x] 起身镜头源码复核：保持原作低增益注视跟随与独立起身轨道，修复自动起身重复请求；新增3项回归，全量293项、typecheck 和 Chrome controller 验收通过；详细证据见 docs/controller-design.md。

## 转写时新发现的怪癖（不可“改进”）

1. 轨道惯性0.82和弹簧按帧计算；头部增益补间固定用0.016秒。
2. 朝向仅比较 dz/dx 斜率；反方向同斜率与 Infinity 差值造成的跳过原样保留。
3. 滚轮 deltaMode 乘数为1+39*mode，mode2为79；修饰键是 Alt/Meta，不是 Ctrl。
4. 蹲姿只影响站姿身体高度，瞄准时相机跟随球杆驱动的头部。
5. 原作瞄准越障库边是独立24边界，不可复用物理 MeshBody 替换。
6. 物理击球切片跨越触球时刻时，原作先 stroke 再 step 当前截短片段；不是常见的先步进到边界再施加冲量。
7. 原作“圆锥越障”按固定 midRadius 扩球，不沿杆长线性改变半径；库边当前命中边有缓存，未重筛候选时优先复用。
8. 零加塞、零手动抬杆仍略向下：支撑点 localY=0.5r+midRadius，触点 localY=0。
9. 球杆动画收敛因子按帧增加0.05，ready 要求 ratio===1、触点无脏值且因子===1；不能仅以状态名 AIM 判可击球。

10. 原作进入出杆动画即冻结输入，物理冲量仍延迟至触球；裁决等球静止且动作起身结束才发生。
11. AI 思考/发射延迟为1+随机数，power=0.3+route.powerFactor，负 fbSpin 时手动角度0.025π；沿用同一球杆动画。

12. 辅助线 alpha=0.6×力度条 autoAlpha：俯身 renderedRatio 超过0.8才显现，后拉进度参与衰减，触球前已隐藏（L7670-7681）；摆球或玩家失活时隐藏。

13. 出杆时 follow 仅追踪母球 x/z 注视点，增益固定0.05、按帧递推；起身时不解除跟随，不更新内轨中心或头部原点。站姿手动观察或回合收尾才解除跟随，落袋不降低注视高度（L4702-4776、L5762-5772、L6338-6423）。
14. 0.5秒自动起身延迟从跟杆动画结束后开始消耗；原作切换更新处理器保证只请求一次起身，不得每帧重复请求（L6376-6385）。

## 登记差异

- 观察扩展单元2：V(86)没有既有冲突；natural/cue/object共用ShotView，只调整最终焦点。首次碰撞目标取getResult，触球前不消费上一杆残留；失活/入袋后冻结焦点。FocusSmoothing按dt子步推进并随横向视场偏离加强响应，不修改原作CameraSpring。运动中切换从当前焦点接续，拖动保持手动至下一杆或再次V。

- 用户批准的观察扩展见 docs/camera-replay-design.md：默认出杆使用稳定的自然起身焦点，取代原作自动follow；CameraRig/ShotView只改变最终target，共享原有位置轨迹。拖动与复位注视立即接管，下一杆恢复自动观察。原作怪癖13作为来源事实保留，不再约束扩展的默认策略。

- 相机默认固定原作台面参数（outer radius2.05、scaleX1.55、inner radius0.38）；未额外做多球台配置接口。
- TipMotion 不保存原作外部 launchingController 引用，由出杆调度器持有；reset、三段时序与位置计算按原作保留。

- app-game.ts 作为浏览器装配根拆分文件，连接 GameSession、规则、AI 与既有 Hud；通过回调注入 controller，未反向依赖表现层。
- Input 使用现代 PointerEvent / PointerCapture，省略旧版鼠标事件回退；失焦、禁用与释放状态时撤销持续按键。
- 手中球射线与台面不相交时隐藏预览并拒绝放球；不输出无穷/NaN坐标。
- AI 延迟随机数由装配根注入 coreRandom，遵守项目可播种规则。
- WorldClient.predict 原有转写括号误译在接入时修正，恢复原作距离与迭代上限；详见 physics/AGENTS.md。

- 当前装配使用最小模式/难度/新局入口与现有 Hud DOM；不复刻完整原作菜单外观。手中球操作提示持续显示，暂未接原作消息弹层的首次提示/10秒重新提示。
- 瞄准预测通过 Simulator 快照接入；activate 清除旧快照，新方向/力度/加塞/抬杆触发刷新。装配根按快照引用及 ballOn 变化同步几何，不从 render 访问 controller。
