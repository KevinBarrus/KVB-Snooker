# 开发运行与验证

本文件维护操作入口；工程纪律见根章程，产品行为见各设计，结果见项目状态。命令以根 `package.json` 为准。

## 运行

| 目的 | 命令 |
|---|---|
| 校验并准备本地原作模型和物理台面 | `npm run assets:prepare` |
| 启动网页开发服务 | `npm run dev`，访问终端实际输出的地址 |
| 启动局域网网页开发服务 | `npm run dev:lan`（监听 0.0.0.0，用于双机开发测试） |
| 启动联机开发原型服务器 | `npm run net:server -- --host 127.0.0.1 --port 8787 --dev-token dev-local`；双机把 host 改为 `0.0.0.0`，见[联机原型设计](multiplayer-prototype-design.md) §9 |
| Node 人机演示 | `npm run demo` |
| Node 自由练习演示 | `npm run demo -- --mode practice` |
| 生产构建 | `npm run build` |
| 准备旧索引音效集 | `npm run audio:prepare` |
| 安装后续处理的音效集 | `npm run audio:install` |

两种声音准备命令对应不同产物，不连续运行来“补齐”。当前选择与校准入口见声音设计；媒体缺失应报告而不是下载未知替代品。原始资源、准备产物与 `.cache/` 都不提交。

## 验证入口

基础检查为 `npm run test` 和 `npm run typecheck`，后者包含 core 与各表现层的独立类型工程。测试数量以当次输出为准。

| 影响范围 | 浏览器脚本 |
|---|---|
| 场景与材质 | `npm run test:render` |
| 输入、出杆、摆球 | `npm run test:controller` |
| 辅助线 | `npm run test:gunsight` |
| 观察模式及 AI 旁观 | `npm run test:camera`、`npm run test:camera:ai` |
| 本地上一杆回放 | `npm run test:replay` |
| 回放音频（触球/碰撞/入袋、暂停/重播） | `npm run test:replay:audio`（需要先启动开发服务） |
| 规则与开发预设 | `npm run test:rules` |
| 900 | `npm run test:900` |
| 练球球形（菜单、自由摆球、复位、犯规弹窗） | `npm run test:practice`（需要先启动开发服务） |
| 我的球形（创建/编辑/回收站/自建练习） | `npm run test:my-shapes`（需要先启动开发服务） |
| 菜单层级、操作指南、退出后 900 冻结 | `npm run test:menu`（需要先启动开发服务） |
| 退出后重新开始新模式（未触球出杆清理） | `npm run test:mode-switch`（需要先启动开发服务） |
| 暂停与恢复（本地经典/900、双窗口协商） | `npm run test:pause`（先启动开发服务，脚本自建独立联机服务器） |
| 联机开发原型（两客户端真实击球） | `npm run test:net`（自建服务器与两个浏览器页面；步骤见[联机原型设计](multiplayer-prototype-design.md) §9—§10） |
| 声音播放 | `npm run test:audio` |

浏览器测试需要先启动开发服务并准备资产；非默认地址通过 `RENDER_URL` 指定，Chrome 路径可用 `CHROME_BIN` 指定。不要假定所有人的端口相同。截图和诊断产物留在忽略目录。

双人开发测试通过 DEV 与 `VITE_RULES_TEST` 控制，关闭或生产构建必须排除测试入口。菜单的本地双 USER 占位不等于网络联机，不能以单浏览器测试代替两个客户端验收。

UI、controller、audio 使用各自 DOM 类型工程，浏览器装配文件由 render 工程检查；不要为了消除类型错误把 DOM 添加到根 core 编译环境。
