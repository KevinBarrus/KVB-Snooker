# scripts · 本地验证工具

- prepare-render-assets.mjs 校验原作资源 SHA-256 后复制到 public/assets/render；输入默认 vendor-original/render，可传目录参数。
- 两个资产目录均排除于 Git；禁止提交原始资源。
- 不改 core，不下载或执行原作 JS。
- 已完成：25 项 render 资源准备；缺失或哈希不符立即失败。
- render-smoke.mjs 用已安装 Chrome 检查本地页面、shader/资源错误与画面；截图仅写入 .cache/render，退出时关闭自己创建的浏览器。
