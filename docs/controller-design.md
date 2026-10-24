# Controller 实施与逆向记录

## 范围与证据

实现站立/瞄准、轨道走位、蹲起、鼠标观察、球杆加塞/抬杆/越障、出杆动画、手中球和 AI 接入。装配根连接既有 GameSession、UI 与 render；controller 不直接读写 World、Body 或规则内部。

REA 复用原始源码分析 `ev_41ca1d053560e9d34dc5fbdb9e6fc5a183cedd748a40af061f394263db5d9a98`；模块身份视图 `ev_ce6096219166e1aea2f0453ceb3c4861c0c8391d82b83d1a91bbe79610311a62` 确认 `1.chunk.js` SHA-256 为 `e2ce74c767cdbf7f5e4a4ce74f2a1e3b4c52ec2b274086da8b57eecadce40bd1`。图中动态关系仍有未知，以下算法结论来自对应行逐段静态阅读，不能据此宣称实机手感已验证。

| 单元 | 原作行号 | 实施 |
|---|---|---|
| 输入 | L3803-4040、L6130-6230 | 状态掩码、按键释放、PointerCapture、Alt/Meta、滚轮单位换算 |
| 相机 | L4326-4812、L5489-5901、L7660-7667 | 双轨道、惯性、过渡、世界注视与瞄准侧视 |
| 球杆 | L235-328、L1216-1239、L4882-5484 | 独立库边越障、触点/方向、站瞄姿态混合 |
| 出杆 | L6006-6113、L6338-6423 | 三段动画、触球时刻切片、跟杆、起身 |
| 手中球 | L4177-4345 | 射线落点、合法性预览、P/ESC/W 切换 |
| AI | L7594-7627 | 原 AI 路线进入相同球杆/出杆通道 |
| 辅助线 | L1686-1739、L6407-6408 | predict(vars,1.6) 的五段可视化 |

## 已闭合的规格缺口

- 原作 W 进入瞄准，S 起身，A/D 绕台，X 按住蹲下，R 复位注视，C 清塞，P 手中球，Space 出杆。拖拽是观察，不是绕台；Alt 或 Meta 拖拽加塞；普通滚轮改力度，修饰键滚轮抬杆。
- 手动抬杆范围 [0,π/4]，越障自动抬杆可超过手动上限。球杆长度1.45、皮头半径0.005、杆尾半径0.015。
- spec04 §4 的“两段缓动”属于球杆，最终相机是 body/head 位置插值。蹲姿比例0为站、1为蹲，body.y=1.7+(1-stateRenderedRatio)*squatRatio*(-0.7)。
- 轨道速度平滑器是逐帧差值/15，并非限幅器；弹簧/惯性依帧更新，不改为 dt 归一化。
- 跟杆距离是触球后减速距离，后拉距离另由 Power1.easeOut(power)*0.25 计算。物理触球时按原作循环分片，最多0.02秒一片。
- 视线/球杆朝向缓存只比较斜率，反方向但同斜率可能不更新；原样保留并测试。

## 待批准的最小接口扩展：PredictionContext

现有公开契约只返回 `impactV1`、`impactOccured`。原作辅助线还读取以下9个字段，全部已存在于 WorldClient 的内部预测结果。本提案只在 Simulator 边界复制数值，不改物理计算、存档或现有字段，不暴露 b1/b2 刚体引用。

```ts
readonly p0: Readonly<{ x: number; y: number; z: number }>
readonly p1: Readonly<{ x: number; y: number; z: number }>
readonly cue: Readonly<{ x: number; y: number; z: number }>
readonly cueVSq: number
readonly p2: Readonly<{ x: number; y: number; z: number }>
readonly target: Readonly<{ x: number; y: number; z: number }>
readonly targetVSq: number
readonly targetNumber: number
readonly hasImpactTarget: boolean
```

字段仅在对应 `impactOccured` / `hasImpactTarget` 成立时消费，保留原作未命中时旧字段残留的行为。批准后同步 architecture §4.2、simulator 类型/拷贝实现及测试。验证包括无撞击、球球撞击、库边撞击、快照隔离与预测前后物理/显示状态不变。

## 交付单元

1. 相机/球杆数值控制与单测；独立提交推送。
2. 输入、出杆调度、手中球/AI 与浏览器装配；独立提交推送。
3. 球杆/瞄准可视化、UI 联动和浏览器验收；独立提交推送。

每单元 test、typecheck 全绿；最终另跑 build、render/controller 浏览器测试。原作模型和贴图只进入被 Git 排除的本地资产目录。

## 实施进度（2026-10-24）

- 单元1已推送 e78ee10；单元2已推送 df860b3。
- 浏览器瞄准触发既有预测循环卡死，源码对照确认是转写漏括号，修正095dc90恢复 PCOL L14728-14733 的距离/迭代退出限制。
- 单元3已接原作球杆模型/IBL、摆球双标记、现有 HUD 和最小模式入口；完整五段辅助线仍待上述接口批准。
- 当前验收是静态源码对照与本地 Chrome 自动化；未进行原作实机手感盲测或逐像素对照，不宣称 M2 整体通过。
