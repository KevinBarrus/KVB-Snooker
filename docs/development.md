# 开发运行与验证

本文件维护操作入口；工程纪律见根章程，产品行为见各设计，结果见项目状态。命令以根 `package.json` 为准。

## 运行

| 目的 | 命令 |
|---|---|
| 校验并准备本地原作模型和物理台面 | `npm run assets:prepare` |
| 启动网页开发服务 | `npm run dev`，访问终端实际输出的地址 |
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
| 规则与开发预设 | `npm run test:rules` |
| 900 | `npm run test:900` |
| 声音播放 | `npm run test:audio` |

浏览器测试需要先启动开发服务并准备资产；非默认地址通过 `RENDER_URL` 指定，Chrome 路径可用 `CHROME_BIN` 指定。不要假定所有人的端口相同。截图和诊断产物留在忽略目录。

双人开发测试通过 DEV 与 `VITE_RULES_TEST` 控制，关闭或生产构建必须排除测试入口。菜单的本地双 USER 占位不等于网络联机，不能以单浏览器测试代替两个客户端验收。

UI、controller、audio 使用各自 DOM 类型工程，浏览器装配文件由 render 工程检查；不要为了消除类型错误把 DOM 添加到根 core 编译环境。
