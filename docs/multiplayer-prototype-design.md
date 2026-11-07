# 联机开发原型（第 0—3 单元）

状态：开发专用原型，2026-11-07 实施中。本文只维护本原型的工程边界、接口复用与验收方式；产品流程见 [双人联机](multiplayer-design.md)，完整通信方案仍是 [协议提案](multiplayer-protocol-design.md)，公开接口登记在 [架构 §4.8](architecture.md#48-联机开发原型窄接口2026-11-07-登记原型未冻结)。不开放游客联机，也不得把开发席位当正式鉴权。

## 1. 目标与范围

目标：两台电脑在同一局域网连接同一个开发服务器，各获得一个固定开发席位；当前席位提交合法击球意图后，由服务器用现有真实 Simulator 与规则执行一次真实击球，两个客户端显示同一杆运动；可通过仅开发环境的延迟注入验证出杆动画与实际触球的关系。

本轮包含：

- 代码基线整理：工作区已有的摆球、菜单、母球材质与物理调参按独立单元提交，记录可复现的测试基线。
- 本文件与架构 §4.8 的窄接口登记；共享报文类型 `src/net/protocol.ts`。
- Node 服务端核心运行器：真实 Simulator + GameSession，两个房间交替推进的隔离验证。
- 双客户端真实击球原型：席位、命令去重、版本检查、非法请求拒绝、球运动同步、开发延迟注入。

本轮不做：邮箱注册、正式游客权限、数据库、长期存档、完整重连判负、排行榜、高光库、语音、Steam、完整联机 900。开发席位只存在于开发入口与开发令牌之后。

## 2. 职责划分

| 主体 | 职责 | 禁止 |
|---|---|---|
| `src/core`（现有） | 唯一物理、规则、计时与出杆语义；无网络/DOM | 不因联机接入改物理参数、规则判罚或镜头算法 |
| `src/server/room.ts` | 权威物理推进、规则裁判、状态版本、命令去重、权威触球冲量与结算 | 不复制第二套自由球/Miss/900 判罚 |
| `src/server/transport.ts` + `latency.ts` | WebSocket 收发、开发令牌、席位连接、延迟注入 | 不参与裁决，不阻塞物理循环 |
| `src/net/*`（浏览器） | 报文、快照缓冲/插值、客户端状态机、命令重试 | 不推进权威物理，不自行认可触球或结算 |
| `src/app-net*.ts` | 装配场景/渲染/控制器/网络/开发 HUD | 不把网络导入 render/ui/controller |

只有一个权威状态写入者：服务器房间。客户端提交意图并显示结果；任一端都不能先本地结算再互相覆盖。重复命令以服务器已记录的结果回应，不重复施加冲量。

## 3. 房间、席位、命令身份与版本

- 一个开发房间 = 一个 `GameSession("single-play", { players: ["USER", "USER"], ruleset: "classic" })` + 一个真实 `Simulator`。两席位固定为 0/1，服务器按加入顺序分配；同一连接只能控制自己的席位。
- 房间状态版本 `version` 是单调整数，每次接受命令、权威触球、结算与回合变化都推进。命令携带 `expectedVersion`；服务器先查命令去重缓存，再比较版本，版本不符返回 `stale-version` 且不修改状态。
- `commandId` 由客户端生成（每次新意图新 ID，重试沿用原 ID）。服务器保存已处理命令的规范化动作与裁决；同 ID 同参数返回同一确认（`duplicate: true`），同 ID 换参数返回 `duplicate-command-mismatch` 且不执行。
- 命令只有两种：`prepare-shot`（冻结本杆合法击球参数）与 `decide-turn`（经典犯规后当前持权者选择自己接手或让对手重打）。鼠标移动、镜头、力度预览、提名悬停都不广播。
- 连接释放只影响席位连接标记，不生成比赛结果；断线恢复、接管与判负不在本轮。重连后按 `welcome` + 快照重建，客户端丢弃旧输入与未完成动画。

## 4. 出杆时序：Space 不是触球

```
客户端 Space
  │  command(prepare-shot, commandId, expectedVersion, vars)
  ▼  —— 单程网络延迟 ——
服务器校验席位/版本/阶段/参数 → GameSession.prepareStroke 冻结意图
  │  ack(accepted, shotId, touchAtServerMs = 收到时刻 + prepareLeadMs)
  ▼  —— 单程网络延迟 ——
两端收到 shot-prepared：以同一权威触球时刻显示后拉/出杆动画
  │  （客户端动画只改变球杆显示，不施加任何冲量、不推进物理）
  ▼  touchAtServerMs
服务器再次检查阶段与版本 → GameSession.stroke 施加唯一一次冲量
  │  event(shot-fired, touchAtServerMs, firedAtServerMs)
  ▼
服务器按固定步长推进物理，广播快照；全部球静止后结算、推进版本
  │  event(shot-settled) + 最终快照（含 SerialData 检查点）
  ▼
两端显示相同落点/犯规/球权；下一杆等待当前席位新的命令
```

- 按下 Space 只发送意图；被服务器拒绝时不产生冲量、声音或成绩。确认丢失时客户端用同一 `commandId` 重试，服务器返回原确认，不会第二次出杆。
- `prepareLeadMs` 是“服务器收到意图到权威触球”的固定提前量，默认值由实验确定并写入服务器配置。客户端用 ping 往返估算时钟偏移，把 `touchAtServerMs` 投影到本地时钟；动画在本地目标时刻触球。若剩余时间不足以播放完整后拉，照常播放并记录偏差，不把按下 Space 当触球。
- 实测字段（开发 HUD 与服务端日志）：Space 本地时刻、命令发出/确认收到、RTT、投影触球时刻、动画触球时刻、首个运动快照到达时刻、`shot-fired` 到达时刻。延迟注入下两者的关系必须在验收中如实记录。

## 5. 运动同步与显示

- 服务端固定步长（60Hz）推进物理，按 20Hz 广播快照；快照包含版本、事件序号、阶段、球权/目标球/手中球/比分、每球显示位置与归一化姿态、待处理击球信息。快照只在稳定阶段携带 `SerialData` 检查点。
- 客户端以约两个快照间隔的缓冲插值位置、对姿态做归一化插值；不混合不同回合帧，不用旧快照覆盖更新版本。落袋/失活按权威 `active` 显示。
- 瞄准预测只使用本地 `Simulator`：从最近检查点 `restore` 后调用 `predict`，不改服务端状态、不产生权威事件。
- 镜头所有权按真实席位判断：只有本地席位的 `PersonController` 驱动相机；对手出杆不拿来本机相机，V/音量/菜单完全本地。非本人球权保持自由观察。
- 本原型用服务器合法放置代替鼠标摆球（初始与手中球由核心 `placeCueBall` 选合法点）；单机摆球交互与规则不变，联机摆球命令留待后续单元。

## 6. 仅开发环境的延迟注入

- 服务端启动参数控制，按连接/方向生效，只影响报文到达时间，不阻塞物理 tick 或浏览器渲染：
  - 关闭：无额外延迟。
  - 固定：入站 `--latency-in-ms` 与出站 `--latency-out-ms` 各自固定延迟。
  - 波动：`--latency-jitter-ms` 为每个方向各加 `[0, jitter]` 随机抖动。
  - 确认丢失重试：`--drop-next-ack` 让下一条确认不投递（仅开发故障注入），客户端超时后用同一 `commandId` 重发。
- 配置值一律是**单程**延迟，往返约为入站+出站+处理时间；`welcome.latency` 与开发 HUD 明确显示 `appliesTo: "one-way-per-direction"`，不把单程配置冒充往返。
- 延迟使用定时器排队投递（不 sleep、不阻塞消息循环）；延迟消息携带原接收时刻，物理与结算不被延迟改变。

## 7. 房间隔离（单元 2）

2026-11-07 用真实 Simulator/GameSession 审计并修复，证据测试在 `tests/server/isolation.spec.ts`：

| 候选 | 审计结论 | 隔离方式 |
|---|---|---|
| `sharedRouteCache` 模块级 AI 路线缓存 | 会串扰：默认 `AIController` 共享缓存，另一房间控制器 `checkRestart` 会清空本房间路线 | 每房间注入独立 `RouteCache`；默认参数保持单机共享行为 |
| `coreRandom` 全局随机源 | 会串扰：两个默认 AI 控制器交替搜索时共享序列，后跑者路线改变（seed 42 稳定复现） | `AIController(profile, { routeCache?, random? })` 可选注入；服务器每房间独立 `SeededRandom` |
| `TABLE_TUNING` 可变导出对象 | 运行期没有被改写；但它是可变模块级对象，若运行期改写会影响之后创建的所有 `MeshBody` | 服务端只读使用；启动时记录台面摘要，不提供运行期调参入口 |
| `Body.serialize` 随机兜底 | 物理步进与球体序列化不消费 `coreRandom`，只有 `serializable=false` 的 Body 兜底路径消费 | 不构成 USER-only 房间风险；AI 房间已用独立随机源 |
| 重力方向缓存、`region.sections`、求解器模块级临时向量 | 只读或同步调用内使用，无跨房间可观察状态 | 无需隔离 |
| 物理台面 | 每房间独立 `MeshBody`/`Simulator`，只共享已校验的只读 JSON | room-manager 每房间构造 |

最终验证：两个真实房间按“交替推进”与“各自单独推进”的 `sim.serialize()` 逐位一致；每房间版本与事件序号独立（各自从 1 开始）；修复后的两个 AI 控制器交替 step 与各自单独 step 路线完全相同。不能只以“创建两个 GameSession”宣称并发安全。

## 8. 开发席位与安全边界

- 浏览器入口只在开发构建开启：`index.html` 正常加载后由 `app.ts` 在 `import.meta.env.DEV` 且 URL 含 `?net=` 时动态加载联机装配；生产构建不提供该入口。
- 服务器必须显式带 `--dev-token`（默认 `dev-local` 只用于本地说明）并校验 `hello`；不接受无令牌连接。固定两席位、不开放围观、不写数据库，任何情况下都不作为正式账号鉴权或游客权限的替代。
- 默认只监听 `127.0.0.1`；双机测试必须显式 `--host 0.0.0.0`（见 §9）。局域网内只应让可信开发机访问。

## 9. 运行与双机操作

### 9.1 第一次准备（机器 A）

```bash
npm install
npm run assets:prepare      # 校验并复制物理台面/贴图到 public/assets（本机必需，产物不提交）
```

### 9.2 启动服务器与开发网页（机器 A）

```bash
# 终端 1：权威房间服务器。双机测试必须显式监听 0.0.0.0。
npm run net:server -- --host 0.0.0.0 --port 8787 --dev-token dev-local
# 终端 2：网页开发服务。dev:lan 让 Vite 监听 0.0.0.0，终端会打印 Network URL。
npm run dev:lan
```

- 服务器启动后打印台面摘要、延迟配置、`NET_SERVER_READY {...}` 与（`0.0.0.0` 时）局域网 `ws://<A-IP>:8787` 地址；只用于可信开发机，禁止暴露公网。
- 端口：网页 `5173`，联机服务器 `8787`。如被占用可用 `--port` 改服务器端口；客户端 URL 需相应带 `server=ws://<A-IP>:<端口>/net`。

### 9.3 两台电脑加入同一房间

两台机器打开同一房间码（`net` 参数相同）即进入同一房间；不指定 `seat` 时按加入顺序分配 0/1，也可以显式指定：

| 机器 | URL |
|---|---|
| A（本机） | `http://127.0.0.1:5173/?net=dev1&token=dev-local` |
| B（另一台） | `http://<A 的局域网 IP>:5173/?net=dev1&token=dev-local` |
| 显式座位 | 末尾加 `&seat=0` 或 `&seat=1` |

- B 不能使用 `localhost`/`127.0.0.1`，必须填 A 的局域网 IP（例如 `192.168.1.50`）。页面从 A 的 IP 加载时会自动把服务器地址缺省为 `ws://<同一 IP>:8787/net`；如端口不同，加 `&server=ws://<A-IP>:8787/net`。
- 进入后画布左上 HUD 显示连接状态、房间、席位、版本与延迟配置。`W` 瞄准，`Space` 出杆；对方出杆时本机自由观察，不会抢走相机。
- 经典犯规后由拥有选择权的一页看到“自己接手 / 让对手继续”；本原型只实现这两项最简选择。
- 取消测试：`Ctrl+C` 关闭服务器或关闭页面即可；房间在最后一条连接断开后销毁，无持久化。

**WSL2 注意事项**：如果 A 的开发服务器与联机服务器都跑在 WSL2 内，WSL2 默认是 NAT 网络，局域网其他电脑不能直接访问 WSL 端口。可选做法：
1. 在 Windows 上做端口转发到 WSL 地址（每次 WSL 重启后地址可能变化）：
   `netsh interface portproxy add v4tov4 listenport=5173 listenaddress=0.0.0.0 connectport=5173 connectaddress=<WSL-IP>`，8787 同理；并为 5173/8787 添加入站防火墙规则。
2. 或在 `.wslconfig` 启用 `networkingMode=mirrored` 后重启 WSL，使 WSL 服务直接出现在 Windows 主机网络上。
3. 或把服务器/Vite 直接跑在 Windows 侧的 Node（仓库路径用 `\\wsl$\...`），避免 NAT。
本轮自动验收是在**同一台机器上用两个独立浏览器页面**模拟两台电脑，没有实际第二台物理机；§10 明确记录这一限制。

### 9.4 延迟测试配置（仅开发环境）
服务器启动参数，配置值都是**单程**延迟；`welcome.latency` 与 HUD 都会显示 `appliesTo: "one-way-per-direction"`，往返约为入站+出站+处理时间：

| 目的 | 启动参数 |
|---|---|
| 无额外延迟 | 默认（不传延迟参数） |
| 固定延迟 | `--latency-in-ms 80 --latency-out-ms 80`（单程各 80ms） |
| 波动延迟 | 再加 `--latency-jitter-ms 30`（每个方向加 0–30ms 抖动） |
| 确认丢失后同 ID 重试 | 加 `--drop-next-ack`（只丢弃下一条 Ack 一次；客户端用同一 `commandId` 重试，服务器返回原裁决，只出一杆） |

延迟用定时器排队投递，不阻塞物理 tick 或页面渲染；HUD 的 Space→Ack→投影触球→动画触球→首个运动快照→shot-fired 差值用于核对动画与实际触球的关系。`--prepare-lead-ms` 默认 700ms，是“服务器收到意图到权威触球”的提前量；大延迟或低帧率下按实测结果调整并在 HUD 记录偏差。

### 9.5 只有一台电脑时的验收

自动验收（推荐先跑，约 2—4 分钟；脚本会自己编译并启动随机端口服务器，不需要手动起 8787）：

```bash
# 前置：npm run assets:prepare 已完成；Vite 开发服务在 127.0.0.1:5173 运行
npm run dev            # 另一个终端
npm run test:net       # 本终端
```

通过的标志：逐条打印 `NET_SMOKE_STEP {...}`，最后输出 `NET_SMOKE_RESULTS [...]` 与
`Net smoke passed: two real browser clients, authoritative shot sync, camera ownership, drop-ack retry, one-way latency, two-room isolation`，退出码 0；截图写入 `.cache/net/`。结果与数字应能对上 §10.2。

人工双窗口核对（自动通过后，用真实手感/视觉再验一遍）：

1. 终端 1：`npm run net:server -- --host 127.0.0.1 --port 8787 --dev-token dev-local`；终端 2：`npm run dev`。
2. 打开**两个独立浏览器窗口**（两个不同浏览器，或同一浏览器两个独立 profile；不要同一窗口两个标签，键盘焦点会互相干扰）：
   - A：`http://127.0.0.1:5173/?net=dev1&token=dev-local&seat=0`
   - B：`http://127.0.0.1:5173/?net=dev1&token=dev-local&seat=1`
3. 按下面清单核对（每项都应有明确结果，不能只看“页面没报错”）：

| # | 操作 | 通过标准 |
|---|---|---|
| 1 | 看两窗左上 HUD | 都是 `ready`、同房间 `dev1`、席位分别为 0/1、版本/阶段一致 |
| 2 | A 按 `W` | 出现球杆、进入瞄准；B 画面不被接管 |
| 3 | A 按 `Space` | 两窗同一杆开始运动，最终落点/比分一致；A HUD 有 Space→Ack→投影触球→动画触球→首运动→fired 数字 |
| 4 | 观察 B 窗口 | 相机位置/朝向全程不被 A 的 ShotView 抢走 |
| 5 | 一杆结算后 | 两窗比分、球权、目标球、手中球一致 |
| 6 | 犯规进入决定阶段 | 拥有选择权的窗口出现“自己接手/让对手继续”，点击后可继续下一杆 |
| 7 | 无权窗口按 `Space` | 不出杆、HUD 版本不变 |
| 8 | 重启服务器加 `--latency-in-ms 80 --latency-out-ms 80` 再打一杆 | HUD 显示单程 80/80；Ack 明显变慢，但两窗球运动与落点仍一致；动画触球与投影触球差值记录在 HUD |
| 9 | 重启服务器加 `--drop-next-ack` 再打一杆 | HUD 重试数 ≥1；比分/球位只变化一次（同 ID 重试没有第二杆） |
| 10 | 记录 | 截图或录屏 + 第 8/9 步的 HUD 数字，作为人工验收证据 |

单机模拟“非 localhost 的局域网路径”：把两个终端改为 `npm run dev:lan` 和
`npm run net:server -- --host 0.0.0.0 --port 8787 --dev-token dev-local`，用 Vite 打印的 Network 地址
（如 `http://172.x.x.x:5173/?net=dev1&token=dev-local&seat=0`）在两窗打开。这能验证服务确实绑定了局域网地址；**真正第二台电脑仍需要按 §9.2—§9.3 再验一次**，单机自连不能替代防火墙/NAT 的实机验证。

判定与问题回收：任何一项失败，收集两窗 HUD 文案、浏览器 Console 错误、服务器 stdout 与页面 URL；自动验收失败时把 `.cache/acceptance-run.log` 一起提供。自动验收通过不等于真实双机或真实 GPU 手感已验收。

## 10. 测试与验收

### 10.1 单元 2 与服务端自动测试

- `npx vitest run tests/server`：4 个文件、26 项通过（房间 10、隔离 9、传输 4、传输时序 3）。
- `npm run test`：58 个测试文件、588 项通过（含服务端与客户端新增单测）；`npm run typecheck` 5 个工程通过；`npm run build` 通过。
- 单元 2 隔离证据见 §7；房间/命令/去重/版本/参数/越权/过期阶段/两房间交错由 `tests/server/room.spec.ts` 与 `isolation.spec.ts` 覆盖。
- 传输：`tests/server/transport.spec.ts` 用两个真实 WebSocket 客户端验证 welcome/快照/同一杆事件、重复同 ID 只出一杆、两个房间独立；`transport-timing.spec.ts` 验证 `--drop-next-ack` 同 ID 重试与入站延迟不吃掉 `prepareLeadMs`（`touchAtServerMs - ack.serverTimeMs === prepareLeadMs`）。
- `npm run net:server -- --port 0` 冒烟：启动、`NET_SERVER_READY`、`/health`、SIGINT 优雅退出 0；台面缺失/摘要不符给出明确错误。

### 10.2 单元 3 双客户端联机验收（2026-11-07，自动）

`node scripts/net-smoke.mjs`（两个独立浏览器页面 + 真实 Node 房间服务器；脚本自建随机端口服务器，不依赖用户的 8787）：

| 场景 | 实测结果（最终验收运行；同一脚本重复运行帧率会有波动） |
|---|---|
| 双席位真实击球（默认 lead 700ms） | 两页均 ready、席位 0/1；seat0 一杆真实执行：Space 7700.8ms → Ack 7754.7ms（RTT 7.6ms）→ 投影触球 8406.35ms → `shot-fired` 8430.5ms（+24.2ms）→ 首个运动快照 8491.9ms（+85.5ms）；两端结算 version/context/balls 逐位一致；共同快照 4 个版本；双方均观察到 simulating 阶段 |
| 对手相机独立 | seat1 相机 position/target 位移 0；seat1 在 seat0 出杆期间 `shotId=null`、不产生命令 |
| 球权与非法操作 | 犯规后 deciding 由 seat1 点“自己接手”；之后 seat1 turn=true、seat0 turn=false；seat0 按 Space 不改变权威版本/时序；一次击球推进版本恰为 prepare/fire/settle 三次（+ decide 一次 = 4） |
| 动画与权威触球对齐（lead 1600ms） | 动画触球 − 投影触球 = **0ms**。默认 700ms 在同机多次运行中多数为 0ms，但当 headless 软件渲染掉到约 3–4fps 时曾测得动画晚 470ms；此时客户端按设计照常播放并记录偏差，不伪造触球 |
| 确认丢失同 ID 重试 | `--drop-next-ack` 下 retries=1，版本从 0 到 3（prepare+fire+settle），**只产生一次实际击球**；两端快照逐位一致 |
| 单程延迟注入 | `--latency-in-ms 80 --latency-out-ms 80`、lead 1600ms：Ack−Space=170ms（往返≈2×80+处理）；投影触球−Space=1681.75ms（入站 80+lead 1600）；动画触球与投影触球偏差 **0ms**；首个运动快照比投影触球晚 143.5ms，`shot-fired` 晚 100.75ms（出站 80ms+快照/事件节拍）；retries=0；两端共同快照 4 个版本 |
| 两房间隔离（同服务器） | 房间 A 出杆推进到版本 2 时房间 B 版本与球位不变；B 出杆后 A 的版本/球位不变；两房间各自独立结束（各 version 3） |

同一台机器上两个页面只是“模拟两台电脑”；**没有实际第二台物理机的人工验收**，WSL2 NAT 下的双机步骤见 §9.3 且需用户按步骤自测。真实 GPU/60fps 下的动画手感同样待人工确认。

### 10.3 性能与卡顿定位（2026-11-07，单机观测）

用户报告“按下 Space 后严重卡顿”。按层测量（真实台面、本机 WSL 软件渲染环境，绝对值不代表真实 GPU）：

- 服务端物理：一次完整杆的 `RoomSession.tick` 平均 0.085ms、最大 1.57ms；整杆 CPU 时间约 48ms/4.8s 模拟 → 约占单核 1% 以下，**不是服务端物理或快照构造导致**。
- 客户端主线程：帧内 JS 忙时 p50 1.4—2.1ms、p95 3.7—5.8ms，GC 采样约 27ms；WebSocket 在整杆中约 20 快照/秒、单条约 3KB（整杆 141 条 / 410KB）→ **主线程和网络处理不是瓶颈**。
- 渲染：同环境单窗口出杆约 16fps，双窗口同时渲染时出杆约 7fps（旁观窗约 4fps）；本地单机页面同环境约 7fps → 每窗口渲染成本与本地对局相同，主要负载来自**同一台机器同时渲染两个完整 Babylon 客户端**（以及 Chrome 对非前台/被遮挡窗口的 rAF 降频）。静止画面下低帧率不易察觉，球/镜头一开始运动才表现为“卡顿”。
- 结论：单机双窗口不是有效的性能验收环境；两台电脑各跑一个客户端才代表真实性能。联机 HUD 现在显示实时 fps，可据此区分“渲染帧率不足”与“网络/物理问题”（后者应表现为 fps 正常但球位置跳变）。
- 本轮同时修复了联机装配的瞄准线时序：现在与本地装配一致，用相机 `renderedRatio` 与后拉进度控制淡入淡出，不再“先出瞄准线再趴下”，出杆后也不会继续显示辅助线。

## 11. 限制与后续

- 无账号、游客、房间创建/加入 UI、准备状态、整场局数、暂停、重连判负、数据库、排行榜、高光、语音。
- 只实现经典规则；900 双表、触球截止竞争与完整 900 联机留待实施计划后续单元。
- 联机原型不提供鼠标摆球与手动提名；服务器用核心 `placeCueBall` 合法放置代替，彩球目标依赖核心从方向推断（推断失败时拒绝出杆）。Miss/自由球没有网络命令，犯规后只提供最简 `decide-turn`（自己接手/让对手继续）。
- `ballOn=252` 的自动提名只覆盖常见直线方向；客户端不提供手动选球面板。
- 删除房间只在最后一条连接断开时发生；无重连恢复、无命令持久化。拒绝命令也进入每房间 256 条 FIFO 去重缓存，客户端重同步后应使用新 `commandId`。
- 事件序号与去重缓存按房间独立（每房间 seq 从 1 开始），不是全局序号。
- 延迟注入是开发故障模拟：`--drop-next-ack` 只丢服务器下一条 Ack 一次，不模拟乱序/丢帧/重连；配置值按单程表述。
- `prepareLeadMs` 默认 700ms 依据客户端约 300—600ms 球杆动画加余量；headless 软件 WebGL 帧率不足时动画会晚于权威触球（记录偏差，不冒充对齐）；真实 GPU 下的对齐与手感由用户人工验收。
- 开发入口没有菜单、声音与正式计分面板；联机 HUD 以文本显示比分/目标球/手中球/实时 fps，正式 UI 与音效接入不在第 0—3 单元。
- 单机双窗口同时渲染两个完整 Babylon 客户端会叠加 GPU/合成负载，低帧率在静止画面下不易察觉、运动时表现为卡顿；Chrome 还可能降低被遮挡窗口的 rAF 频率。单机双窗口不能替代双机性能验收，联机 HUD 的 fps 用于先区分渲染帧率问题与网络/物理问题（详见 §10.3）。
- 协议仍是原型窄接口；冻结前必须完成协议设计 §8 的弱网、乱序、接管与恢复实验。
