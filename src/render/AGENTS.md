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
- [ ] 第三步：Simulator 显示快照同步与运动/显隐验收。

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

## 登记差异

- Babylon 3.2 CommonJS 包装依赖非严格 this，Vite 浏览器加载会报 CANNON 访问错误；采用同一包的 es6.js，类型沿用官方 babylon.d.ts。
- 以 ShaderMaterial 绑定原作 GLSL，使用普通 uniform 代替 UBO；台呢场景仅 GameLight，固定1盏灯。未启用原作场景未使用的骨骼/实例/镜像相机分支。
- 探针仍保存上次单元编号及哨兵状态，每次绑定重算权重，省略原作 transform dirty 观察器；不改变采样公式。
- 资源异步加载失败显式报错；编译/就绪等待上限20秒。资产表含25项（顶层17项、共享1项、模型内7项），修正规格旧“15项”描述。
- 阴影复用原作 planebatch shader 的黑色分支；省略用于瞄准/摆球图标的 color attribute，这些控件归 controller 后续接入。

## 外部 shader 证据

PCOL L1105-1115 使用 planebatch，L9911 指定 shader 根路径。当前同源镜像路径为 https://tq.ztr8.uk/cdn.heyzxz.me/pcol_1_0_0/ 。读取完整文件后转写：

- planebatch.vertex.fx：SHA-256 `2c250feedcd49205a87dd566c4e2a9a6a47fc829f2048e2691ad1cc3308a0927`。
- planebatch.fragment.fx：SHA-256 `7fe1a44e93089582aa27876e3ca3abec7dd76ff122f8bb5d617a695c7743e931`。

## 运行与验收

- 将原始25项资源放入 vendor-original/render；npm run assets:prepare 校验 SHA-256 后复制。也可 npm run assets:prepare -- /资源目录。
- npm run dev；另一个终端 npm run test:render，默认使用 /usr/bin/google-chrome，可用 CHROME_BIN 覆盖，RENDER_URL 指定服务地址。
- Chrome 使用隔离无头进程及软件 WebGL；检查错误、资源HTTP状态、非空画面，截图位于 .cache/render/smoke.png，不提交。
- 完整模型使用原始 UV；Chrome 检查灯光隔离/参数、八种球材质就绪、阴影几何/透明度和木框参数。截图已目检，未宣称逐像素一致；真实 GPU 性能仍需实机验收。
- 每步 npm run test、npm run typecheck、npm run build、浏览器验证通过，同步章程后独立提交推送。
