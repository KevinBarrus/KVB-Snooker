# scripts · 本地验证工具

- prepare-render-assets.mjs 校验原作资源 SHA-256 后复制到 public/assets/render；输入默认 vendor-original/render，可传目录参数。
- 两个资产目录均排除于 Git；禁止提交原始资源。
- 不改 core，不下载或执行原作 JS。
- 已完成：28 项 render 资源准备；缺失或哈希不符立即失败。
- render-smoke.mjs 用已安装 Chrome 检查本地页面、shader/资源错误与画面；截图仅写入 .cache/render，退出时关闭自己创建的浏览器。
- 完整场景验收读取 app.ts 导出的 runtime，断言灯光作用范围、材质就绪、阴影与木框参数；需要 Vite 开发服务。
- 资源准备同时校验物理台面摘要并复制到 public/assets/physics/table.json；第三个 argv 可指定物理文件，默认 analysis/tiger-club-sno-rgb.json。所有资源校验成功后才开始复制。
- 浏览器验收覆盖22球初始同步、真实击球位置/旋转、渲染不改物理序列化、落袋隐藏、重摆、释放及错误物理资源拒绝；不修改 core。

- controller-smoke.mjs 覆盖瞄准、滚轮、加塞/清塞、触球延迟、防连发、练习回合、手中球入口、失焦停止走位和人类→AI 接棒。仅使用装配根/公开命令，120秒超时关闭自建浏览器；npm run test:controller。

- ai-camera-smoke.mjs（npm run test:camera:ai）用真实人机回合验证三种观察偏好：AI思考/后拉/触球时V不改模式、提示或存储，AI出杆及碰撞不接管旁观视线，鼠标拖动有效，回合结束保留观察点，玩家下一杆恢复自动观察与V。旧接线已在AI启动用户ShotView断言处复现失败；脚本不改核心状态或替换AI，120秒超时关闭浏览器。

- rules-test-smoke.mjs（npm run test:rules）验证开发模式三个预设、真实进红计分、两个本地席位出杆、输入锁、加载/完整重置、忙碌拒绝以及dist不含测试菜单/预设。EXPECT_RULES_TEST=0时验证关闭开发入口（需连接VITE_RULES_TEST=0的服务）。

- 规则扩展验收追加普通犯规等待/接手、提名不明确拒绝出杆、手动提名冻结、末黑平分抽签选择与D区手中球、真实犯规后的自由球提示/手选/替代分值。测试局面通过GameOptions.setup公开注入，不篡改裁判输出；ai-camera在AI犯规后通过真实选择按钮接手再验证下一杆观察。

- controller 浏览器验收追加球杆材质/世界矩阵、力度条、鼠标摆球成功与 D 区外拒绝、页面模式入口；截图在 .cache/controller/stand.png、aim.png、placement.png。脚本先发送鼠标移动并步进，再单独 down/up，保留原作 dirty 预览拒绝机制。

- gunsight-smoke.mjs（npm run test:gunsight）覆盖真实球台辅助线五部分、目标合法性、输入刷新、贴球/撞库、出杆渐隐和AI回合隐藏；100组方向/力度/塞/角度变化后逐项比较物理存档、显示视图、本杆结果和回合状态。截图 .cache/controller/gunsight-*.png 不提交。
- 三套浏览器脚本必须从页面 script 标签读取带 Vite 时间戳的实际 app.ts 入口再 import。导入裸路径可能创建第二份 runtime；现以页面只存在一个 HUD 作回归断言。截图前等待动画帧并重绘，确保 WebGL 合成完成。

第二轮规则验收将争黑断言改为无抽签面板、非本局开球方直接D区击球，保留旧的真实击球计分回归。

AI镜头专项每组显式传openingPlayerIndex=0，隔离三种观察偏好的相同初始条件；重开轮换由规则专项独立验证，不改变镜头断言。

第二轮Chrome规则新增：真实Miss按钮复位/保留罚分/清回放、黑球平分下拉底袋实打与完整重置、中央贴球持续/出杆隐藏/练习抑制、贴合法红后摔袋不提供Miss复位、普通重开连续轮换且测试不消费序列。

AI复位专项在同一规则脚本中通过公开控制器发出一杆无首碰测试球，点击复位后确认AI重新搜索并再次实际出杆，旁观ShotView保持关闭。

2026-10-27贴球提示验收：只显示英文，×点击立即关闭且焦点返回画布，连续空闲帧不重弹，自动超时无需出杆，新局面可再次提示；关闭不改变台面/分数/回合。

统一消息关闭验收：规则脚本点击普通FOUL/Miss的×，校验比分/台面/待选项不变；相机脚本校验观察提示手动关闭、再次显示与自动过期，焦点回画布。

声音第一版：audio-sources.json 保存79个本地WAV的来源分类、强度标签和SHA-256，不包含媒体。prepare-audio-assets.mjs（npm run audio:prepare）先验证全部输入，再复制到忽略目录 public/assets/audio，输出播放增益/起音偏移清单；不改原文件、不降噪。参数在来源清单 preparation 中集中维护，游戏动态曲线在 src/audio/calibration.ts。

audio-smoke.mjs（npm run test:audio）在真实Chrome解码全部素材，观察真实AudioBufferSourceNode及输出信号，验证触球时序、预测静默、球球/入袋声、静音持久化、回放隔离、销毁和缺资产降级。音效与物理的随机源隔离；运行前准备音频与球台资源。
