// 球台外观调校入口（对标星牌比赛台）。颜色为 RGB，0-1；长度单位米；改后刷新页面生效。
export const TABLE_STYLE = {
  // 皮口（袋口的本色牛皮皮件）
  leatherColor: [0.58, 0.45, 0.35], // 皮口主颜色
  leatherShadowColor: [0.11, 0.085, 0.065], // 皮口暗部底色（无直接光时的保底亮度）
  leatherLight: 0.55, // 袋口灯强度：皮件受光亮度，过高会过曝发白
  leatherGloss: 0.03, // 皮口高光强度，0 为全哑光
  leatherWallShade: 0.45, // 袋内皮壁下沿亮度（相对主颜色，越小袋内越暗）
  leatherCornerRadius: 0.118, // 角袋皮口外圆角半径（越大台角越圆）
  leatherDome: 0.003, // 皮口顶面鼓起高度
  leatherWallDepth: 0.048, // 袋内皮壁深度（从木框顶面向下）
  leatherFlapDrop: 0.115, // 皮口外侧垂帘长度（从木框顶面向下）

  // 网兜（白色棉网）
  netColor: [0.7, 0.68, 0.62], // 网线颜色
  netCellSize: 0.012, // 网眼大小
  netLineRatio: 0.2, // 网线粗细占网眼比例
  netInnerShade: 0.38, // 袋内上部网的亮度
  netDepth: 0.26, // 网兜底相对木框顶面的深度（落袋球在 0.29 处消失）
  linerColor: [0.016, 0.012, 0.01], // 网兜背后暗色内衬的颜色

  // 台边木与台体（深色玫瑰木）
  railColor: [0.42, 0.085, 0.07], // 木色：木纹贴图上的颜色乘数
  railBrightness: 5, // 木纹贴图亮度
  railRoughness: 0.4, // 木面粗糙度：越小漆面越亮
  railWidth: 0.09, // 木面宽度（不小于 0.085）

  // 金色铭牌带、线脚、腿墩与柱腿
  goldColor: [1, 0.6, 0.09],
  goldRoughness: 0.5,
  goldMetallic: 0.4,

  runnerColor: [0.02, 0.02, 0.022], // 袋口下方出球轨胶杆的颜色

  // 台框照明（木框、台体与金饰）
  ambient: 0.35, // 球馆环境光强度：主要影响围板、柱腿等立面
  reflection: 0.015, // 漆面与金饰对球馆环境的反射强度
  lampLight: 2.5, // 台灯直射强度：主要影响木框顶面

  // 皮口补光（皮口另受袋口灯 leatherLight 照射）
  fillLight: 0.6, // 环境补光强度：主要影响垂帘
  fillGround: 0.25 // 环境补光中来自地面方向的比例
};

export type TableStyle = Readonly<typeof TABLE_STYLE>;
