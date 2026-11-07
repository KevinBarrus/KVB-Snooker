# KVB-Snooker · 全局工作章程

## 阅读顺序

本文 → [文档导航](docs/README.md) → [架构契约](docs/architecture.md) 的相关章节 → 所改目录的模块章程与必读设计。

## 分层与接口

- 依赖只从表现层流向核心；`ui/audio/controller/render` 不互相导入，跨层装配放在装配根。
- `src/core/**` 禁止 DOM、Babylon 和网络依赖，必须可在 Node 下运行。
- 表现层通过 Simulator、EventBus 或架构已登记的装配回调/只读视图访问核心，不读取或修改 World、Body、规则内部。
- 公开接口唯一契约是 `docs/architecture.md`。改签名前更新契约；产品设计不能暗中增加接口，当前代码也不能自动推翻已确认需求。
- 新增服务器、数据库或平台能力时先明确边界，不把基础设施引入 core，也不复制另一套规则。

## 事实与变更依据

- PCOL 还原以本地 `analysis/1.chunk.js` 的行号证据为准；规格在 `docs/spec/`，额外语义约束在 `docs/modules/`。
- 用户批准的项目扩展与原作行为分别登记。原作怪癖不得擅自优化，已批准扩展也不能被旧还原记录撤销。
- 发现需求、契约与代码不一致时，明确记录差异与影响；无法确认的内容标为待定，不伪称已批准或已验收。
- 当前用户指令优先于仓库文档。文档分工与来源冲突处理见 `docs/README.md`。

## 工程规范

- TypeScript strict；禁止 `any` 和 `as unknown as`；单个源文件不超过 400 行，使用语义英文命名。
- 不使用默认导出，`src/app.ts` 装配根除外。
- 代码注释只标注原作算法出处，例如 `// PCOL L9322-9417`；设计说明放文档。
- 不引入未经需要验证的空抽象。保持已有经典、人机、镜头和物理手感的回归边界。
- 分清本人修改与工作区已有修改；不覆盖或夹带其他开发者、模型的未完成代码。
- 不提交 analysis、原始媒体、生成资产、密钥或本机缓存。遵守 `.gitignore`，不为提交方便解除排除。

## 验证与提交

- 每个实现单元必须通过 `npm run test` 和 `npm run typecheck`；按影响范围追加浏览器、真实对局或故障验收。
- 自动测试通过不等于人工手感、视觉或声音验收完成。验收记录写明日期、范围及限制。
- Conventional Commits；每个可独立验收的小单元完成即提交并推送，不把无关工作捆绑提交。
- 修改模块时检查该目录 AGENTS.md；仅职责、约束、测试纪律或必读入口变化时更新章程。功能要求更新设计，接口更新架构，验证结果更新验收记录。

## 文档维护

- AGENTS.md 只放长期约定、职责边界与必读入口，不放产品参数、施工日志或历史测试数量。
- 一个决定只在一个现行设计位置维护；其他文档引用，不复制另一份规则。
- 已确认需求、工程提案、当前实现、验收记录分别标识。历史文件只供追溯，不参加现行规则优先级比较。
- 新发现的原作语义与授权差异写入对应 `docs/modules/` 或功能设计；不得因精简章程而丢失证据。
- UI 及跨模块视觉工作必须阅读 [UI 章程](src/ui/AGENTS.md) 中用户亲写的设计原则。

## 常用入口

- 文档与任务导航：[docs/README.md](docs/README.md)。
- 运行和验证：[docs/development.md](docs/development.md)。
- 当前状态与待解决差异：[docs/project-status.md](docs/project-status.md)。
- 联机分步交付：[docs/multiplayer-implementation-plan.md](docs/multiplayer-implementation-plan.md)。
