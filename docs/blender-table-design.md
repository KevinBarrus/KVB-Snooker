# Blender 球台资产

状态：2026-11-13 用户批准的整体视觉重建。替代此前禁止 Blender/glTF 的范围限制；默认外观和程序化 cinema 均保留。原作依据仍在 modules/render.md，本文件不定义物理或摄像机行为。

## 制作简报与参考分析

目标为 Babylon 3.2 实时主资产，1 Blender 单位=1米；球台原点在地面中心。Blender X/Y/Z 对应游戏 X/Z/Y，glTF +Y up 后由官方加载器转换左右手。物理 side 轮廓由现有 applyTableGeometry 导出，不抄写第二套袋角公式。床面 .88m、球半径 .02625m、库鼻 3.594×1.7932m；球杆独立，皮头原点、向 -X 延伸1.45m。

主要参考为用户 img/1.png—11.png（SnookerGod 视频截图）。3.png 为低机位瞄准，7.png 为高位全台，11.png 为斜视及中袋开口。长宽和球径服从物理，不追随竖屏透视。俯视与斜视显示木框窄而克制；绿色库边为圆滑楔形而非方条，中袋为开口U形皮铁结构，覆盖深度明显小于整条扶手。奶油色皮口与外侧皮裙分件，袋中可见浅色绳网。球下半部暗、顶部有多矩形灯反射；杆身浅色木纹，尾段深色拼接。

参考色域起点：台呢 #07972b、漆木 #3f120c、皮革 #c6ad7a、网绳 #c7bda2、围板 #122b70、座椅 #45191e、墙 #777779。它们是相对参考，实际以实时照明下的截图检查；不宣称 ΔE 已达标。

制作顺序：小型 GLB 兼容样件 → 整体轮廓/五个检查相机 → 库鼻与六袋结构 → UV/微表面贴图 → 实时集成 → 几何和流程验收。应用 blender-director、blender-modeler、hard-surface、realistic-style、materials、texture-workflow、lookdev、lighting、camera-cinematography、asset-optimization、export-pipeline、qa-review 与 reference-image-match。

预算：球台 LOD0 ≤150k 三角面，LOD1 ≤80k；球杆 ≤6k；球台材质≤10、单张贴图≤2048。场馆复用现有简化比赛厅，动态球保持独立快照渲染。模型不含碰撞网格。网袋采用真实交织绳索曲线网格，底部收束；不靠黑色内衬遮洞。

## 工程与导出

工程保存有命名集合、可编辑曲线/截面、厚度/倒角等修改器、独立六袋组件、参考球与检查相机。导出只选游戏资产；参考球和相机不打包进球台。PBR 仅使用 glTF 2.0 基础金属粗糙度、baseColor/normal/ORM，不依赖新版扩展、Draco、KTX或 Cycles 专有节点。

当前 npm 无 glTF 加载器；使用同版官方 babylonjs-loaders 3.2.0，准备脚本按固定 SHA 验证并放到忽略的本地资产目录。不修改 npm 包或旧 assets.json。适配层只在 visual=blender 时加载；导入材质按 PBR 类型检查，不传旧 StandardMaterial 假设。启动选项仍保留原有瞄准、俯视、展示与回放交接。

实测兼容细节：3.2 的 glTF root 默认旋转180°并镜像，装配校正旋转后必须按父子顺序重新计算世界矩阵，才能冻结桌体或烘入球杆顶点。3.2 的 MergeMeshes 不能直接合并 glTF typed-array 索引，适配层复制成普通数组，并在烘入负行列式变换时反转绕序，四个球杆材质保留为 MultiMaterial。完整模型导出前显式三角化，包含切线且不依赖 glTF 扩展。

球台为8个PBR材质分组；网兜用真实绳索，无 alpha 排序依赖。兼容样件仍验证透明纹理可导入。LOD1 另行导出供后续性能调校，当前游戏使用 LOD0。动态球使用32段球体、现有只读快照和接触阴影，灯箱反射由静态场馆探针提供。Blender 的 Cycles 检查灯不导入游戏，游戏使用已有实时灯光/探针与电影后处理。比赛厅保持简化资产。

源工程和生成资产放在 public/assets/render/blender/，不进入 Git；版本控制保留建模脚本、适配层及设计。实际产物与版本、面数、导入检查结果写在最终验收记录。

## 打开与维护

游戏：本分支 `npm run dev -- --port 5174`，打开 `http://127.0.0.1:5174/?visual=blender`；去掉 visual 参数恢复默认，`visual=cinema` 为此前程序化电影版。无需新建视觉展示页面。

Blender：打开 `public/assets/render/blender/kvb-table.blend`。COL_Table 为主体，六个 COL_Pocket_* 各自含皮铁、皮口、皮裙、缝线、绳网；COL_Cue 为独立球杆；COL_Construction_Cutters 为保留的袋口布尔切割器；COL_Reference/Cameras/Lookdev_* 不导出到游戏。贴图已打包到工程，也单独保留 PNG。相机列表提供 Hero/Top/Aim/Middle/Corner。

首次重建执行 `node scripts/blender/prepare-loader.mjs` 和 `node scripts/blender/export-geometry.mjs`，再运行 Blender 后台的 `scripts/blender/build.py -- <资产输出目录>`。Windows Blender 接收 Windows 或 WSL UNC 路径，可用 `wslpath -w` 转换。首次从 WSL 调用若互操作超时，应使用当前终端的有效 WSL_INTEROP 套接字，不能据此判断 Blender 未安装。

**已手工修改工程时不要重跑 build.py**：它从头生成源工程。应先在 Blender 保存修改，再以 `blender --background <kvb-table.blend> --python scripts/blender/export_existing.py` 导出；该入口保留源工程，只更新 GLB 和验收清单。物理袋角发生变化时须重新导出物理轮廓并同步模型，运行时会拒绝过期的轮廓清单。

## 验收记录

实施中。Blender 自动检查覆盖有限：退化面、非流形、法线长度、UV、材质、预算、尺寸和袋口通视；穿模仍需内部多机位人工检查。不得将这些检查等同于穷尽任意视角的视觉验收。
