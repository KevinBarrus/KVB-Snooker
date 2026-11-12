import { TABLE_STYLE, type TableStyle } from "./table-style.js";

export const CINEMA_TABLE_STYLE: TableStyle = {
  ...TABLE_STYLE,
  leatherColor: [0.78, 0.65, 0.43],
  leatherShadowColor: [0.055, 0.043, 0.025],
  leatherCornerRadius: 0.112,
  leatherDome: 0.002,
  leatherWallDepth: 0.046,
  leatherFlapDrop: 0.105,
  leatherWallShade: 0.65,
  netColor: [0.66, 0.62, 0.50],
  netInnerShade: 0.65,
  netCellSize: 0.009,
  netLineRatio: 0.19,
  railColor: [0.22, 0.038, 0.022],
  railRoughness: 0.22,
  railBrightness: 2.5,
  goldColor: [0.56, 0.34, 0.10],
  goldRoughness: 0.35,
  goldMetallic: 0.65
};

export const CINEMA_STYLE = {
  cloth: "#07972b",
  clothRoughness: 0.95,
  boards: "#122b70",
  seats: "#45191e",
  wall: "#777779",
  floor: "#38171b",
  keyIntensity: 2.4,
  fillIntensity: 0.35,
  roomIntensity: 0.45,
  reflection: 0.8,
  exposure: 1.15,
  contrast: 1.08,
  saturation: 8,
  bloomWeight: 0.045,
  bloomThreshold: 1.2,
  vignetteWeight: 0.7,
  aimFov: 0.88,
  displayFov: 0.72
} as const;
