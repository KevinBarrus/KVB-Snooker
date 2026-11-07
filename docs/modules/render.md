# render：还原依据与语义约束

本文只保存算法证据与还原注意事项，不维护施工进度或产品交互。原作事实不自动约束已批准的扩展；现行设计由 [文档导航](../README.md) 指定。未明确授权改变的算法语义应保留。

## 事实来源

- architecture.md §2/§4.2/§5/§8；spec/03 §4。
- PCOL L333-477 场景配方；L1886-1900 显示同步；L2040-2107 球体与场景装配。
- PCOL L10171-11047 球 IBL、立方图集、探针；L12910-13227 台呢 shader。
- 原引擎版本：analysis/0.chunk.js L7474-7477，Babylon 3.2.0。


## 转写时新发现的怪癖（不可“改进”）

1. 球 toneMappingMode=2（指数映射），台呢 mode=3（ACES）；不能统一套全局 ACES。
2. 探针 HDR 是纵向六面、横向多 cube 的图集。底层15个面尺寸64，上层15个面尺寸32；球 AO PNG 按 pow(channel/255,2.2) 解码。
3. 探针底层用 ratios[2]=-1 跳过上层采样，其他上层权重保留旧值；单元边界容差为 1e-5。
4. 探针 AABB 存 Float32；AO 高度相对其中心，范围仅0.1；台边 AO 系数可达到1.1。
5. 台呢 lightmap 的 B 通道添加间接光，G 衰减，R 抑制镜面；不是标准灰度 AO。
6. useRadianceLodRoughness 默认 false；仅随相机距离增加 radiance LOD，不能因 roughness=0.1 自动启用粗糙度 LOD。
7. 原作台呢 shader 的无 NORMAL/有 CHAOTIC 分支括号不完整；保留原文，本场景使用 NORMAL 分支。
8. 所有导入材质先关闭直接光；仅 Pocket 重新开启，GameLight 仅照 TableInner。Frame metallic=1 且关闭直接光，不能改成普通木质漫反射。
9. 球影是台面 y+0.001 上的贴图平面，宽高=2.6r、alpha=0.8，由台面 mask 的 R 通道裁切；不是 Babylon ShadowGenerator。
10. 球位置和四元数来自显示快照；阴影是否显示却取物理 position.y >= 0.88。跌落时可能球仍可见但阴影已消失；失活则隐藏球与影。
11. 母球细分32，其他球20；几何按细分档克隆共享，材质按 number 缓存。重摆保留朝向，render 不主动重置四元数。

12. 球杆 glossy 贴图经 reflectivityRoughness 通道，radiance=0.12、roughness=1、toneMapping=2；LOD falloff 内部第二项为 far-near=8.5。
13. 摆球原位标记只在进入模式时抓取母球位置，逐帧转0.06；点下新位置后不跟随移动。

14. 母球碰后长度是 min(0.5×位移平方+0.5×速度平方, 1.6−入射距离)，不是预测点间距离；目标线 min(0.5×targetVSq,0.4)。
15. 入射距离≤2r 时隐藏线但保留 impactV1 的朝向供目标扇形使用；无撞击距离≤r 隐藏线。
16. 扇形按1−两方向点积张开，宽度因子2.8；短线仍保留最小贴图端帽，不能压缩到小于两端帽长度。
17. 原线条为纯白，球心标记为218/255灰白；目标线为黄色，非法目标仅球心标记变红；顶点4及以后 alpha=0。


## 外部 shader 证据

PCOL L1105-1115 使用 planebatch，L9911 指定 shader 根路径。当前同源镜像路径为 https://tq.ztr8.uk/cdn.heyzxz.me/pcol_1_0_0/ 。读取完整文件后转写：

- planebatch.vertex.fx：SHA-256 `2c250feedcd49205a87dd566c4e2a9a6a47fc829f2048e2691ad1cc3308a0927`。
- planebatch.fragment.fx：SHA-256 `7fe1a44e93089582aa27876e3ca3abec7dd76ff122f8bb5d617a695c7743e931`。


## 历史记录

早期实现差异、测试次数与逐次施工记录见 [迁移存档](../history/2026-11-07/render.md)，不作为当前验收结果。新增证据写在本文，产品变化写所属设计文档，不再追加到 AGENTS.md。
