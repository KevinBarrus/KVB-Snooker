# scripts · 本地验证工具

第二轮试采按用户新确认的三档力度/三种杆法执行，输入清单为audio-resampling-round2.json，profile为three-level-pilot。首次strict-v1模式保持兼容；新模式分别记录数值诊断与事件筛选，已确认多事件和未能归属事件都不进candidates。旧两条用户确认双响的源区间写入excludedClips，重叠裁剪在生成文件前拒绝。

本轮实际交付5条待试听：3条中力皮头、1条中力球球、1条小力球球。皮头杆法均未能可靠确认，使用仅限试采的cue-unclassified临时标记，不作为第四种杆法，也不接入游戏；新入袋候选无法确认后续起伏，单独否决。上下文WAV与候选分开，短前导用preWindowSeconds记录实际测量长度，不冒称100ms。正式素材、播放清单及src不变。结果与交付路径见docs/audio-resampling.md第二轮。

原声重采样（2026-11-01）：audio-cut.mjs（npm run audio:cut）消费来源及起点/撞击/终点JSON，直接解码为48k PCM24，输出SHA-256、体检与人工待审报告；audio-cut-audit.mjs复用已有WAV/RMS工具。输出只允许新建的忽略目录，数值失败放rejected/，不改local-audio或public/assets。契约见docs/audio-resampling.md；原始Windows素材目录下的验收包单独复制，不覆盖现有文件。

### 重采样发现的工具边界

- 原readWav曾忽略fmt中的位深，仅按PCM标签假设16位；现显式支持PCM16/PCM24/float32，拒绝错误块对齐及非有限采样，支持ffmpeg的extensible PCM24头。
- ffprobe的码率只能说明当前流；标称128kbps AAC可因整数舍入报告127999bps，体检仅容许1bps差，不声明只有一代压缩。
- 尾部趋势使用10ms RMS窗口、3dB波动容差与−70dBFS噪声地板。数值通过不能证明无说话/咳嗽/复合碰撞，仍须人工试听；不自动归一化或降噪来过关。
- 首批六条原声诊断试样数值通过0条：6条尾部能量超标，其中1条前导超标，全部保留在rejected/。杆法/力度暂定，不计入24条合格目标；待试听6条与数值通过后的待试听数分开统计。结果与Windows交付位置见docs/audio-resampling.md，未改游戏素材。

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

声音第二轮对照试听（2026-10-28）：audio-review.mjs（npm run audio:review）按 audio-review-cases.json 从 local-audio 读取 8 段代表素材，在 .cache/audio-review 生成 A/B/C/D 与增益对比、两条事件序列和一键试听页。纯逻辑在 audio-review-lib.mjs（WAV 读写/测量/淡出判定/IR/盲标签/片段运算/卷积）与 audio-review-fft.mjs（基-2 FFT），渲染在 audio-review-render.mjs，页面与说明在 audio-review-page.mjs/.html；有 tests/unit/audio-review.spec.ts 覆盖这些纯函数。输出目录、合成 IR、试听 WAV 均不提交；local-audio 与 public/assets/audio 只读，脚本前后自校验哈希。ffmpeg 探测结论：本机 6.1.1 的 afir 对合成 IR 恒输出静音（delta IR 亦复现），卷积改在 Node 内做；afftdn 恒定延后 25ms（1200 采样 @48k）且不向滤镜图报告，需显式裁齐，无前导时首 6ms 起音会被压低约 1.1dB，故前置 10ms 静音引导噪声跟踪。--out 可指定另一个 .cache 子目录用于可重复性比对。

声音最终候选集（2026-10-28）：audio-final-set.mjs（读 audio-final-spec.json）按用户逐组指定的映射，从 local-audio 与上一轮试听包生成"即将用于游戏"的 34 条音效与试听页，输出到 .cache/audio-final，不写 public/assets/audio。处理链：findOnset 定位起音（10ms 包络首个进入峰值−10dB 的窗口）后裁掉前置底噪、150Hz 二阶高通去房间轰鸣、末端按尾部电平选 30/60/120ms 淡出、共享 send 卷积混响补 0.65s 尾；reuse 条目直接取上一轮 D 版并按需裁前摇。力度不再只改增益：slot.peakDb 给每档目标峰值，wet 与 tailExtraSeconds 随力度上升（0.15/0.45s → 0.45/1.2s），高档位因此更响、更厚、拖得更长。另有两项修正：crestCompensation 按峰均比相对本组最干净素材的差值补偿（本地大力素材底噪高、峰均比低约 5dB，同样峰值下能量高一大截，0.5→0.75 换素材会出现 10dB 以上的跳变）；组内再统一抬起，让每组最响一条落在 −0.5dBFS，跨组响度一致。注意峰均比补偿会让"换素材那档"的峰值低于前一档（能量仍单调递增），这是同一素材同时满足"峰值单调"和"能量单调"不可能的结果。实测：afftdn 对本批大力素材几乎无效（撞击 −0.0 ~ −0.2dB、噪声区 −0.1 ~ −0.3dB，nr 到 48 仍如此），故改用"裁前摇 + 高通"，没有假装做了降噪。

安装（2026-10-28）：audio-final-set.mjs --install（npm run audio:install）把成品复制到 public/assets/audio 并写播放清单（offset 0、gain 1，电平已烘焙），同时把构建清单存为 provenance.json；安装前把旧的准备产物备份到 .cache/audio-prepared-backup，不删除 local-audio，也不改 audio-sources.json。npm run audio:final 仅重建到 .cache/audio-final。

复听第二轮修正（2026-10-28）：用户要求 cue-mid-low/cue-center 的 0.75 与 1.0 直接沿用 cue-low/cue-high 同档音频，因此新增 copyFrom 条目——渲染后逐字节复制来源槽位成品，组内不再做统一抬起（否则 0.5 会反超 0.75），并用"沿用音频逐字节相同"检查守住。两组 0.5 档单独加大：湿声 0.35、尾音 +1.0s，峰值按各自素材峰均比放到 −4/−2dB，使 0.5 与 0.75 的峰值接近、能量仍单调（0.5→0.75 的能量跳约 9–10dB，因为换成了本地更厚的大力录音，这是素材决定的，不是参数问题）。

联机开发原型（2026-11-07）：net-smoke.mjs（npm run test:net）用两个真实浏览器页面加真实 Node 房间服务器验收双开发席位击球、同一杆快照逐位一致、对手相机独立、`--drop-next-ack` 同 ID 重试只出一杆、80/80ms 单程延迟下的动画/触球时序与两房间隔离；公共工具在 net-smoke-lib.mjs，脚本自建随机端口服务器，不占用默认 8787，截图与日志只写 .cache。结果与限制见 docs/multiplayer-prototype-design.md §10。

练球球形（2026-11-08）：practice-smoke.mjs（npm run test:practice）在真实浏览器点击菜单启动十个预设球形，验证 22 球/Snake、全台自由摆球、犯规后重摆/复位弹窗、复位后回放仍可用、菜单重新开始重摆、清彩与五分点不计分及五分点母球绿球点。脚本不改核心状态、不替换裁判，截图只写 .cache/practice。需求见 docs/practise.md，实现与验收见 docs/practice-shape-design.md。

我的球形（2026-11-08）：my-shapes-smoke.mjs（npm run test:my-shapes）在真实浏览器创建空台球形、摆放/右键回收、彩球点位、命名完成、自建练习、清完四选项、编辑保存、删除/回收站/恢复/彻底删除、50 个上限告示，以及预设清彩的清完四选项。编辑器直接操作 Simulator 球位，不创建 GameSession；脚本只通过公开页面/运行时入口观察，不改正式规则。需求见 docs/my-shapes-design.md。

菜单层级与操作指南（2026-11-09）：menu-smoke.mjs（npm run test:menu）验证首页卡片/二级返回、操作指南弹层、退出 900 后回首页且倒计时冻结、对局内指南入口。controller-smoke 从主菜单启动自由练习，不依赖初始页面直接开局。

回放音频（2026-11-09）：replay-audio-smoke.mjs（npm run test:replay:audio）验证回放录制 impact 事件、按 playHead 播放、暂停立即停声、重播/定位不重复旧声；音频使用独立回放混音器与现有 master 音量。

力度控制（2026-11-10）：controller-smoke 断言滚轮 200 对应 60% 力度，验证每格 5% 的输入步长；stick 单测覆盖 0/0.8/1 的速度端点与高段倍率。

回放入口（2026-11-10）：replay-smoke.mjs 断言母球进入手中球/摆球状态时 `.replay-open` 仍可见；BrowserGame 的回放 canOpen 不再排除 inHand，退出回放保留摆球状态。
