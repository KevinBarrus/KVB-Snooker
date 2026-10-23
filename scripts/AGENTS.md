# scripts · 本地验证工具

- prepare-render-assets.mjs 校验原作资源 SHA-256 后复制到 public/assets/render；输入默认 vendor-original/render，可传目录参数。
- 两个资产目录均排除于 Git；禁止提交原始资源。
- 不改 core，不下载或执行原作 JS。
- 已完成：25 项 render 资源准备；缺失或哈希不符立即失败。
- render-smoke.mjs 用已安装 Chrome 检查本地页面、shader/资源错误与画面；截图仅写入 .cache/render，退出时关闭自己创建的浏览器。
- 完整场景验收读取 app.ts 导出的 runtime，断言灯光作用范围、材质就绪、阴影与木框参数；需要 Vite 开发服务。
- 资源准备同时校验物理台面摘要并复制到 public/assets/physics/table.json；第三个 argv 可指定物理文件，默认 analysis/tiger-club-sno-rgb.json。所有资源校验成功后才开始复制。
- 浏览器验收覆盖22球初始同步、真实击球位置/旋转、渲染不改物理序列化、落袋隐藏、重摆、释放及错误物理资源拒绝；不修改 core。
