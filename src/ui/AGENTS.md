# ui · HUD 表现层章程

## 职责边界

- 每个部件拆为「零 DOM 状态类 + `*Dom` 视图类」：状态类订阅/接受数据，视图类在帧循环里 `sync(state)` 按脏值写 DOM。smoke test 只用状态类，Node 可跑。
- 访问 core 仅限 `EventBus` 事件 + 装配根注入的只读 `ScoreSource[]`（core `Player` 的结构子集）；不 import game/simulator 实现，不写回核心。
- DOM 类型只在本目录可见：`src/ui/tsconfig.json` 加 `DOM` lib，根 tsconfig 排除 `src/ui`，core 仍无 DOM 类型面；`npm run typecheck` 两个工程都检查。
- 力度条 `PowerBar.percent / autoAlpha` 由 controller 直接写入（原作亦为控制器直写 powerUI，事件表无对应事件）。

## 文件

| 文件 | 内容 | 原作出处 |
|---|---|---|
| hud.ts | `Hud`：事件订阅协调；`HudDom`：挂载四个视图 | L7990-8031、L6233-6234 |
| score-panel.ts | 记分板 + ball-on 图标 | L12110 模板、L7530-7592 |
| foul-notice.ts | FOUL 消息框与自动关闭计时 | L8014-8016、L8260-8285、L3212-3268 |
| power-bar.ts | 力度条 percent/autoAlpha | L1454-1514、L7637-7683 |
| shortcuts-bar.ts | 快捷键条（ctrl 状态切换的 UI 消费方） | L12122 模板、L5909-5970 |

## 事件映射

| 事件 | HUD 行为 |
|---|---|
| `sim/shooting-start` | 记录 playerIndex，ball-on 图标改挂当前玩家组；显示快捷键条 |
| `game/ball-on-changed` | `ScorePanel` 持有 ballOn（HUD 内唯一一份）并刷新图标；inHand 由 controller 消费，UI 不用 |
| `game/frame-events` | 以注入的 players 调 `syncResults`（等价原作 `_onModelResponse` 同步记分） |
| `game/foul` | foulCode≠0 且当前 ballOn≠0 时弹 `FOUL`，正文 `score + ": " + description` |
| `ctrl/state-change-start` | 隐藏快捷键条 |
| `ctrl/state-change-end` | 按 `to` 切换按键组（1=AIM 组，其余=STAND 组）并显示 |

## 转写时新发现的怪癖（不可"改进"）

1. 记分板显示分 = 本人 pts − 对方 penalty；单人时左组只显示本人 pts（L7577-7592）。
2. ball-on 图标只挂在当前击球玩家组，另一组写 0；类名直接拼 mask：`ball-on-icon snooker b-<mask>`（如 practice 的 65535）。
3. ball-on 缓存初值是 0 而 pts/brk 是 NaN：mask 0 永远不会写出 `b-0` 类名，图标保持模板初始类名（L7547）。
4. 玩家名统一 `toUpperCase()`；单人时右组 `display:none` 且容器加 `single` 类，左组从不切换显隐（L7562-7575）。
5. FOUL 消息自动关闭时长 = 1 + 0.08 ×（标题长 + 正文长）秒，上限 15 s；ERROR 类型 → 标题与正文都挂 `error-copy`；原作通用 message 的 INFO/SUCCESS/WARNING 三型无 UI 调用路径，未移植（L8266-8272、L3255-3268）。
6. 终局（ballOn=0）时原作走结算面板而不弹 FOUL，即使本杆犯规（L8012-8016）。
7. 快捷键条 `setGroup` 只判 `=== 1`，任何非 AIM 状态值都显示 STAND 组（L5960）；mac 平台把 `Alt` 键帽替换为 `cmd`（L5926-5929）。
8. 力度条 `autoAlpha === 0` 即整体不可见，alpha 未变时不重写（L1508-1510）。

## 登记差异

- 用户批准的观察扩展：ViewNotice/ViewNoticeDom显示装配根传入的中文模式名称，2.2秒自动隐藏，使用role=status；不订阅新增核心事件，不导入controller。

- 原作力度条是挂在球杆上的 Babylon 网格（shader `powerview`，高亮色 H.BLUE、bgAlpha 0.25）；此处改为 DOM 条，颜色与底透明度照抄，位置/形状属美化弹性处理。
- 原作快捷键条显示还需 gState=READY 且 stateRatio∈{0,1}（L6306-6309）；UI 拿不到 gState，以 `sim/shooting-start` 代理 READY，`state-change-end` 代理 stateRatio 落定。
- FOUL 抑制读 `ScorePanel` 持有的 ballOn：若 rules 在同一结算中先发 `game/foul` 再发 `game/ball-on-changed`，终局犯规仍会弹出；集成时需保证 ball-on 先发。
- 消息框的拖拽/钉住/关闭按钮、练习与单局结算面板（L6460-6480、L7700-7730）、侧栏菜单未移植。

## 测试

观察扩展单元2新增提示计时测试；全量299项、typecheck、build及Chrome camera专项（文案、隐藏、偏好恢复）通过。

`src/ui/__tests__/smoke.test.ts`：EventBus 派发 `game/foul`、`game/ball-on-changed`、`game/frame-events`、`ctrl/state-change-*`、`sim/shooting-start`，断言状态类字段；不引 DOM / Babylon。

## 完成定义（DoD）

`npm run test`、`npm run typecheck` 全绿；提交并推送。
