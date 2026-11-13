# 文档导航与维护约定

本目录按“规则、接口、产品行为、技术方案、进度与证据”分工。阅读当前任务需要的部分，不要求每次通读全部历史。

## 1. 哪份文档回答什么

| 层次 | 唯一维护位置 | 不放什么 |
|---|---|---|
| 全局工程纪律 | [根章程](../AGENTS.md) | 功能参数、施工日志 |
| 模块职责与约束 | 各目录 AGENTS.md | 详细算法、产品流程、历史测试数 |
| 用户亲写视觉原则 | [UI 章程](../src/ui/AGENTS.md) | 不在根章程复制第二份 |
| 依赖及正式公开接口 | [architecture.md](architecture.md) | 未批准的网络 API、重复产品文案 |
| 产品行为 | 下表各功能设计 | 数据库实现细节、其他领域规则副本 |
| 网络与持久化方案 | 协议、持久化设计 | 重复决定暂停次数或如何记胜场 |
| 任务顺序 | [联机实施计划](multiplayer-implementation-plan.md) | 另一份完整联机需求 |
| 当前状态与待决项 | [项目状态](project-status.md) | 把提案当成已验收事实 |
| 原作证据 | `spec/`、`modules/` | 把项目扩展冒充原作 |
| 历史追溯 | [历史说明](history/README.md) | 现行开发指令 |

## 2. 按任务阅读

| 任务 | 产品或算法设计 | 配套材料 |
|---|---|---|
| 运行与验收 | [开发操作](development.md) | package.json 中实际脚本 |
| 摆球 | [摆球交互](cue-ball-placement-design.md) | controller 章程、架构 §4.7 |
| 输入与辅助线 | [Controller](controller-design.md) | spec/04、modules/controller |
| 镜头与本地回放 | [观察与回放](camera-replay-design.md) | controller、render 章程 |
| 经典规则 | [规则扩展](rules-v2-design.md) | spec/05、modules/core-rules |
| 900 规则与基础时钟 | [900](snooker-900-design.md) | 架构 §4.7；正式暂停引用生命周期 |
| 球台调参 | [调校说明](table-tuning.md) | 生效值只在 table-tuning.ts 维护 |
| 电影比赛场景 | [电影视觉设计](cinema-visual-design.md) | 默认外观保留；URL 模式与观察镜头 |
| Blender 球台资产 | [Blender 制作与集成](blender-table-design.md) | 可编辑工程、glTF 3.2 兼容、独立视觉版本 |
| HUD 与临时消息 | [UI 设计](ui-design.md) | UI 章程、架构事件与回调 |
| 主菜单 | [菜单](menu-design.md) | 账号权限及正式房间流程不由菜单自行定义 |
| 练球球形 | [练球球形设计](practice-shape-design.md) | 需求见[用户球形规则](practise.md)；架构 §4.9 |
| 我的球形 | [我的球形设计](my-shapes-design.md) | 架构 §4.11；存储仅 localStorage |
| 音效接入 | [声音第一版](audio-v1-design.md) | audio 章程、架构 §9 |
| 声音采集与试听 | [重采样](audio-resampling.md)、[试听交接](audio-v2-listening-handoff.md) | 历史素材方案不自动成为当前运行配置 |
| 登录与游客 | [账号与游客](accounts-and-guests-design.md)、[内测身份与部署](internal-beta-identity-design.md)、[联机会话校验](identity-session-verifier.md) | 不维护比赛结算规则 |
| 部署与运维 | [部署说明](../deploy/README.md) | 不复制身份/协议规则 |
| 两人内测可玩联机 | [接线与验收](multiplayer-playable-design.md) | 架构 §4.15、[部署接线](multiplayer-player-deployment.md) |
| 正式双人对局 | [房间与玩家流程](multiplayer-design.md) | [通信协议](multiplayer-protocol-design.md) |
| 联机开发原型（第 0—3 单元） | [原型工程边界与验收](multiplayer-prototype-design.md) | 架构 §4.8、协议 §1—§5 的窄接口子集 |
| 整场身份与换局 | [整场进度](match-progress-design.md) | 架构 §4.10 |
| 稳定边界完整检查点 | [持久化 §2.1](match-persistence-design.md#21-第一版可序列化的稳定边界检查点) | 架构 §4.12；核心及服务端检查点测试 |
| 暂停与继续（架构 §4.13） | [比赛生命周期 §2](match-lifecycle-design.md#2-暂停与-900-时钟) | `npm run test:pause`；本地经典/900和经典联机 |
| 重摆、暂存、掉线 | [比赛生命周期](match-lifecycle-design.md) | [持久化](match-persistence-design.md) |
| 个人成绩与排行榜 | [统计](stats-design.md) | 持久化的幂等写入 |
| 收藏与拼接 | [高光](highlights-design.md) | 持久化的对象引用与任务机制 |

数学、物理、模拟器、规则和 AI 的原作规格在 [spec/00 模块地图](spec/00-模块地图.md) 至 spec/08；修改相关模块还须读取该模块章程链接的 `modules/` 语义记录。

## 3. 状态与冲突处理

- **已确认需求**：用户已明确接受的产品行为。改变时要有新决定，不能靠代码先改了就反向认定。
- **工程提案**：实施建议，尚不是冻结接口；相关实现开始前在架构登记必要契约。
- **当前实现**：仓库或工作区可观察到的行为，不保证符合需求。
- **验收记录**：注明日期、版本范围、自动/人工检查及限制；旧测试数不代表本次通过。
- **历史记录**：保留证据和决策过程，后来的明确修订覆盖旧要求，不把互斥旧段落并列为现行指令。

当前用户指令优先。原作事实与项目扩展分开判断：还原争议查源码行号，产品改动查已批准设计，接口查架构。三者不一致时先登记在项目状态中并解释影响；不以“较新文件”或“代码已存在”擅自解决语义争议。

每项规则指定一个维护位置。例如重连宽限只在生命周期定义，排行榜引用它的最终裁决；协议只描述如何恢复连接，不能另设宽限。提案参数集中列于项目状态，其他文件引用待决编号。

## 4. 更新方式

功能变更更新所属设计；接口变更更新架构；原作发现更新模块依据；验证结果更新对应验收段或项目状态。只有长期约束变化才改 AGENTS.md。

新增文件必须挂到本导航或相关设计入口，并检查相对链接。迁移前记录可归档，但历史不能成为 AI 默认必读的大包，也不能在归档内继续追加当前要求。
