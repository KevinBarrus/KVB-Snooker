# scripts · 本地验证工具

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

- controller 浏览器验收追加球杆材质/世界矩阵、力度条、鼠标摆球成功与 D 区外拒绝、页面模式入口；截图在 .cache/controller/stand.png、aim.png、placement.png。脚本先发送鼠标移动并步进，再单独 down/up，保留原作 dirty 预览拒绝机制。

- gunsight-smoke.mjs（npm run test:gunsight）覆盖真实球台辅助线五部分、目标合法性、输入刷新、贴球/撞库、出杆渐隐和AI回合隐藏；100组方向/力度/塞/角度变化后逐项比较物理存档、显示视图、本杆结果和回合状态。截图 .cache/controller/gunsight-*.png 不提交。
- 三套浏览器脚本必须从页面 script 标签读取带 Vite 时间戳的实际 app.ts 入口再 import。导入裸路径可能创建第二份 runtime；现以页面只存在一个 HUD 作回归断言。截图前等待动画帧并重绘，确保 WebGL 合成完成。
