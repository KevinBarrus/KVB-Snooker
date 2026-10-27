# 声音第一版

2026-10-27 用户授权接入真实素材及游戏播放校准。声音为项目扩展，PCOL 仅提供碰撞和出杆时序依据。

## 范围

杆头击球按实际高低击点/力度选组；所有球球碰撞按法向相对接近速度选组；入袋按实际入袋球进入袋喉阶段的水平速度选择空心/磕袋角素材。低速入袋连续趋近静音。暂不做长短台、抬杆库边、起跳、普通碰库和犯规声音，也不自动降噪、剪辑或补尾音。

local-audio 保持用户原目录、WAV/MP4 原字节，排除 Git。scripts/audio-sources.json 是可审查的来源/分类清单；准备工具校验 SHA-256 并复制 WAV 到 public/assets/audio，生成带每样本播放增益的清单。两处素材目录不提交。增益只影响播放，不改原 WAV。

## 数据与分层

- Simulator.onImpact(listener):()=>void 提供只读 ImpactEvent；Node 可消费，回调可解除。不暴露 Body、Contact 或可变 Vec3。
- ImpactEvent 为 cue / ball / surface 联合；共用 time（世界演化步对应秒数）、ballIndex、x/z。cue 包含 speed（StrokeVars[6]）、tipHeight（沿实际击球方向垂直平面的归一化击点高度）；ball 包含 speed（非负法向相对接近速度）；surface 包含 surface（jaw/pocket/tunnel/end）、speed、horizontalSpeed。
- Simulator 在 stroke 的实际冲量时刻发 cue，在现有 onTouch 求解前发 ball/surface。仅观察，不改变求解/积分/规则；预测静默。不使用原 out-of-bounds 事件替代进袋。
- BrowserGame 将 onImpact 桥接到 EventBus 的 sim/impact。旧事件不改。audio 仅消费类型化事件；根 app-audio 装配浏览器播放器与现有 EventBus。
- audio 中纯选样/音量决策与浏览器后端分文件；浏览器后端独立 DOM 编译环境，其他 audio 和全部 core 保持 Node 可运行。不引入音频库。

## 入袋判定与时序

PCOL L12351-12365：tunnel 为 PREPOT，end 为 POTTED；pocket 是袋喉内壁，sidesoft 是袋角周围软库。音效在首次 tunnel 接触播放，end 仅兜底；每球每杆一次。记录此前 pocket 接触前的水平速度，避免吞球响应或竖直下落造成错误响度。无 pocket 接触则使用 tunnel 接触前水平速度。

jaw 接触必须与袋喉在可配置的时间/距离范围内，才使用磕袋角素材；普通远处库碰撞不触发。候选 pocket 状态超时/远离后不复用。首版此分类是依据网格的可测近似，不是原作声音算法。复合磕袋角素材只播放一次，不叠加空心样本。正式计分仍仅由既有裁判处理。

## 播放策略与校准

同组使用洗牌袋，每轮用完再打乱，跨轮避免立即重复；随机源由装配根注入且不消耗 coreRandom。相邻力度档用连续权重选择音色，音量按连续曲线计算；高低杆由实际击点分类，缺档使用该杆法已有相邻档。全部阈值、权重、力度曲线、样本增益在音效配置/清单集中维护。

准备工具测量每段 WAV 最响 20ms 窗口 RMS，生成有限幅度的播放补偿；不把此值当真实击球力度。原分类仍为依据。同组响度校准与事件动态增益分离，主音量及总线压缩保留叠加余量。听感须由用户最终验收，自动验证仅证明数值/时序和真实发声。

原生 Web Audio 预加载并解码，用户手势解锁，加载/解码失败提示但不阻止游戏。音量控制持久化，切新局/复位/回放停止遗留声音，销毁释放监听和节点。首版回放静音，不修改原回放录制格式或摄像机。

## 验收

- 核心事件：真实接触、预测静默、事件有无不影响存档/结果、退订、偏心击点、入袋速度与网格标志。
- 纯音效：连续响度/分档边界、组内不重复、未知/非有限参数静音、轻入袋静音、袋角近邻/过期、单球不重复、独立随机源。
- Chrome：所有素材真实解码；击球瞬间而非后拉触发、真实球球/入袋声、Web Audio 输出非零、音量/静音、预测不发声、切局/回放无旧声、资源失败不阻塞游戏。
- npm run test、npm run typecheck、npm run build 与相关浏览器回归；按单元同步章程并提交推送。

## 运行与调整

1. 将用户原分类素材放在仓库 local-audio（当前已复制）；执行 npm run audio:prepare。无需安装音频工具。
2. npm run dev，首次键盘/鼠标操作启用声音。顶部音量滑条0为静音，偏好保存在snk.volume。
3. npm run test:audio 连接默认5173；其他端口通过RENDER_URL指定。

调整入口：scripts/audio-sources.json 的 group/intensity 为人为分类，preparation 控制测量窗口和有限增益补偿；修改后重新准备。src/audio/calibration.ts 控制游戏动态响度和材质档位：球球满档4m/s、入袋静音区≤0.25m/s/满档2.8m/s、主音量0.7。上述是项目第一版校准值，不是原作物理常量。原始录音无需改写，尾音保持原样。

同组素材保留各自变化，不统一生成音色；播放起点采用相对峰值-24dB的首个采样前3ms，避免裁剪片段的前置静音拖慢触球声。此项是可配置的播放偏移，不修补原声；试听若发现弱起音被跳过，可调整配置并重新准备。

实测校准修正：轻推角袋离台前速度0.115m/s，首次tunnel接触已为0.376m/s。surface追加entrySpeed，用离开台面前的水平速度，horizontalSpeed仍保留即时值。step前及球球求解后刷新台面采样，以覆盖袋口旁子球被撞入袋；声音选样优先首次pocket的entrySpeed，无pocket时取tunnel的entrySpeed。上述轻推只播放微弱皮头声，不播放入袋声。

## 第一版完成记录

全量401项单测、各层typecheck、生产build通过。Chrome audio/controller/rules/replay均通过；实际母球角袋与子球角袋、0.73rad磕袋角路线、0.115m/s轻推路线通过，声音不影响原计分/控制/回放。资产准备负例验证摘要不符时拒绝且不改已有清单；79段生成WAV逐一与原始SHA-256相同。已建立第一版数值校准，最终听感仍需用户在实际音响/耳机上验收。
