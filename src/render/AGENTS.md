# render · 模块章程

## 职责边界

- Babylon 场景、材质、贴图、光照探针与球体显示；消费 Simulator 的只读 BallView。
- 不访问 World/Body 内部，不驱动物理，不依赖 ui/audio/controller。
- 浏览器 DOM 类型只在本目录和 app.ts 装配根开放；core 保持 Node 编译环境。
- 原作模型、贴图仅存 vendor-original/render 和 public/assets/render，均不提交。

## 事实来源

- architecture.md §2/§4.2/§5/§8；spec/03 §4。
- PCOL L333-477 场景配方；L1886-1900 显示同步；L2040-2107 球体与场景装配。
- PCOL L10171-11047 球 IBL、立方图集、探针；L12910-13227 台呢 shader。
- 原引擎版本：analysis/0.chunk.js L7474-7477，Babylon 3.2.0。

## 施工单元状态

- [x] 第一步：Babylon 3.2 ES Module、Vite、本地资源校验；单球/台呢 shader、HDR/PNG 立方图集与探针插值。新增 9 项测试；全量 244 项、typecheck、build 与 Chrome 出图验证通过。
- [x] 第二步：原始模型、房间、灯光隔离、台呢/袋口/木框材质、八种球色与批量阴影。244 项测试、typecheck、build 和 Chrome 场景参数/出图检查通过。
- [x] 第三步：BallRenderer 消费 Simulator 显示快照；22 球同步、两档共享几何、同色共享材质及资源释放。新增 5 项测试，全量 249 项、typecheck、build 与真实球台浏览器运动/旋转/落袋/重摆验证通过。

- [x] controller 可视化接入：StickAlpha 原模型及 IBL 材质、摆球双图标、既有 HUD 布局；新增1项标记生命周期测试，全量279项、typecheck、build、Chrome controller/render 验收通过。PredictionContext 扩展已批准并实现。

- [x] 辅助线第二步：五段几何、原图集 UV、顶点渐隐与目标合法性配色；7项单测，全量290项与 typecheck 通过；浏览器接线见第三步。

- [x] 辅助线第三步：app.ts 只读接线与渐隐；Chrome 专项验证无撞击/球球/库边/贴球、红白目标、键鼠刷新、出杆与AI回合隐藏、100组连续无损预测。controller/render 回归及截图目检通过。

## 转写时新发现的怪癖（不可“改进”）

1. 球 toneMappingMode=2（指数映射），台呢 mode=3（ACES）；不能统一套全局 ACES。
2. 探针 HDR 是纵向六面、横向多 cube 的图集。底层15个面尺寸64，上层15个面尺寸32；球 AO PNG 按 pow(channel/255,2.2) 解码。
3. 探针底层用 ratios[2]=-1 跳过上层采样，其他上层权重保留旧值；单元边界容差为 1e-5。
4. 探针 AABB 存 Float32；AO 高度相对其中心，范围仅0.1；台边 AO 系数可达到1.1。
5. 台呢 lightmap 的 B 通道添加间接光，G 衰减，R 抑制镜面；不是标准灰度 AO。
6. useRadianceLodRoughness 默认 false；仅随相机距离增加 radiance LOD，不能因 roughness=0.1 自动启用粗糙度 LOD。
7. 原作台呢 shader 的无 NORMAL/有 CHAOTIC 分支括号不完整；保留原文，本场景使用 NORMAL 分支。
8. 所有导入材质先关闭直接光；仅 Pocket 重新开启，GameLight 仅照 TableInner。Frame metallic=1 且关闭直接光，不能改成普通木质漫反射。
9. 球影是台面 y+0.001 上的贴图平面，宽高=2.6r、alpha=0.8，由台面 mask 的 R 通道裁切；不是 Babylon ShadowGenerator。
10. 球位置和四元数来自显示快照；阴影是否显示却取物理 position.y >= 0.88。跌落时可能球仍可见但阴影已消失；失活则隐藏球与影。
11. 母球细分32，其他球20；几何按细分档克隆共享，材质按 number 缓存。重摆保留朝向，render 不主动重置四元数。

12. 球杆 glossy 贴图经 reflectivityRoughness 通道，radiance=0.12、roughness=1、toneMapping=2；LOD falloff 内部第二项为 far-near=8.5。
13. 摆球原位标记只在进入模式时抓取母球位置，逐帧转0.06；点下新位置后不跟随移动。

14. 母球碰后长度是 min(0.5×位移平方+0.5×速度平方, 1.6−入射距离)，不是预测点间距离；目标线 min(0.5×targetVSq,0.4)。
15. 入射距离≤2r 时隐藏线但保留 impactV1 的朝向供目标扇形使用；无撞击距离≤r 隐藏线。
16. 扇形按1−两方向点积张开，宽度因子2.8；短线仍保留最小贴图端帽，不能压缩到小于两端帽长度。
17. 原线条为纯白，球心标记为218/255灰白；目标线为黄色，非法目标仅球心标记变红；顶点4及以后 alpha=0。

## 登记差异

- Babylon 3.2 CommonJS 包装依赖非严格 this，Vite 浏览器加载会报 CANNON 访问错误；采用同一包的 es6.js，类型沿用官方 babylon.d.ts。
- 以 ShaderMaterial 绑定原作 GLSL，使用普通 uniform 代替 UBO；台呢场景仅 GameLight，固定1盏灯。未启用原作场景未使用的骨骼/实例/镜像相机分支。
- 探针仍保存上次单元编号及哨兵状态，每次绑定重算权重，省略原作 transform dirty 观察器；不改变采样公式。
- 资源异步加载失败显式报错；编译/就绪等待上限20秒。资产表含28项（原25项加球杆模型/颜色/光泽贴图3项），修正规格旧“15项”描述。
- 球影与摆球图标共用原作 planebatch shader；球影的 color 恒为黑色，摆球采用原作红/绿/白色。图标独立网格，沿用原始 UV 与台面 mask，未合并进球影批次。
- BallRenderer 的球数/半径在构造时固定，对应当前 Simulator 球组；切换 Simulator/球台需 dispose 后重新构造。dispose 只释放自有网格/材质，共享贴图由场景管理。
- app.ts / app-game.ts 负责浏览器装配；连接 controller、球杆/摆球显示与既有 UI。跨表现层引用仅在装配根发生，render 不 import controller。导出 runtime 供集成及浏览器验收消费。
- app.ts 在解析碰撞 JSON 前校验 SHA-256（`04acfb245368bc1762cdcdf94f0bb81ab82dd82f785af661a4f63d3de9ccbbc9`），只接受已核对的原始台面数据；先校验后装配渲染场景。

## 外部 shader 证据

PCOL L1105-1115 使用 planebatch，L9911 指定 shader 根路径。当前同源镜像路径为 https://tq.ztr8.uk/cdn.heyzxz.me/pcol_1_0_0/ 。读取完整文件后转写：

- planebatch.vertex.fx：SHA-256 `2c250feedcd49205a87dd566c4e2a9a6a47fc829f2048e2691ad1cc3308a0927`。
- planebatch.fragment.fx：SHA-256 `7fe1a44e93089582aa27876e3ca3abec7dd76ff122f8bb5d617a695c7743e931`。

## 运行与验收

- 将原始28项资源放入 vendor-original/render，物理台面默认读取 analysis/tiger-club-sno-rgb.json；npm run assets:prepare 校验 SHA-256 后复制。也可 npm run assets:prepare -- /资源目录 /物理台面文件。物理文件写入 public/assets/physics/table.json，排除于 Git。
- npm run dev；另一个终端 npm run test:render，默认使用 /usr/bin/google-chrome，可用 CHROME_BIN 覆盖，RENDER_URL 指定服务地址。
- Chrome 使用隔离无头进程及软件 WebGL；检查错误、资源HTTP状态、非空画面，截图位于 .cache/render/smoke.png，不提交。
- 完整模型使用原始 UV；Chrome 检查灯光隔离/参数、八种球材质就绪、阴影几何/透明度和木框参数。截图已目检，未宣称逐像素一致；真实 GPU 性能仍需实机验收。
- 每步 npm run test、npm run typecheck、npm run build、浏览器验证通过，同步章程后独立提交推送。
- NullEngine 单测验证快照只读、物理高度阴影判据、重摆和共享资源所有权；浏览器测试通过 Simulator.stroke/step 真实击球落袋，不手改 v/w，也不读取 World 内部。
- 已知工具提示：Babylon 3.2 发布包缺少其声明的 source map，Vitest 会提示但测试通过；Vite 提示完整 Babylon bundle 大于500 kB，当前 gzip 约450 kB，尚未做体积优化。

- Gunsight 复用 table-overlay 的原作 planebatch shader、图集与mask，五段用独立网格共享材质；高度为台面+0.001+0.0001，目标标记 alphaIndex=10，其余−10。不依赖 controller，不读 World。
