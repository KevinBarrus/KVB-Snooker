import * as B from "babylonjs/es6.js";
import { CINEMA_STYLE } from "./cinema-style.js";
import { RAIL_INNER_X, RAIL_INNER_Z } from "./table-shape.js";

const BALL_COLORS = ["#efeee4", "#bb080c", "#e7b51a", "#087b55", "#743719", "#074abc", "#e5829b", "#080b0a"];

export function cinemaMaterial(scene: B.Scene, name: string, color: string | readonly number[], roughness: number,
  metallic = 0): B.PBRMaterial {
  const material = new B.PBRMaterial(name, scene);
  material.albedoColor = (typeof color === "string" ? B.Color3.FromHexString(color)
    : new B.Color3(color[0], color[1], color[2])).toLinearSpace();
  material.metallic = metallic;
  material.roughness = roughness;
  material.environmentIntensity = CINEMA_STYLE.reflection;
  return material;
}

export function cinemaBallMaterial(scene: B.Scene, number: number, dots = false): B.PBRMaterial {
  const color = BALL_COLORS[number];
  if (!color) throw new Error(`Unknown cinema ball number: ${number}`);
  const material = cinemaMaterial(scene, `cinema-ball-${number}${dots ? "-dots" : ""}`, color, 0.11);
  if (dots) {
    const width = 512, height = 256;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; ++y) {
      const latitude = Math.PI * y / (height - 1);
      for (let x = 0; x < width; ++x) {
        const longitude = 2 * Math.PI * x / (width - 1);
        const maximum = Math.max(Math.abs(Math.cos(latitude)), Math.abs(Math.sin(latitude) * Math.sin(longitude)),
          Math.abs(Math.sin(latitude) * Math.cos(longitude)));
        const amount = Math.min(1, Math.max(0, (maximum - 0.9846) / 0.001));
        data.set([255 - amount * 70, 255 - amount * 248, 255 - amount * 245, 255], 4 * (y * width + x));
      }
    }
    material.albedoTexture = B.RawTexture.CreateRGBATexture(data, width, height, scene, true, false);
  }
  return material;
}

export function cinemaCueMaterial(scene: B.Scene, mesh: B.Mesh): B.PBRMaterial {
  const material = cinemaMaterial(scene, "cinema-cue", "#ffffff", 0.36);
  const positions = mesh.getVerticesData(B.VertexBuffer.PositionKind);
  if (!positions) throw new Error("Missing cue geometry");
  const uv: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    uv.push(0.5 + Math.atan2(positions[i + 2], positions[i + 1]) / (2 * Math.PI),
      (positions[i] + 1.4607) / 1.4657);
  }
  mesh.setVerticesData(B.VertexBuffer.UVKind, uv);
  const width = 128, height = 1024;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; ++y) {
    const along = y / (height - 1);
    for (let x = 0; x < width; ++x) {
      const around = x / width;
      const grain = Math.pow(Math.abs(Math.sin(around * Math.PI * 32 + Math.sin(along * 17) * 1.4)), 18);
      let color = [220 - grain * 55, 197 - grain * 65, 145 - grain * 66];
      if (along < 0.26 + 0.16 * Math.pow(Math.abs(Math.cos(around * Math.PI * 4)), 6)) color = [32, 20, 13];
      if (along > 0.986) color = along > 0.996 ? [45, 72, 80] : [196, 174, 109];
      data.set([...color, 255], 4 * (y * width + x));
    }
  }
  material.albedoTexture = B.RawTexture.CreateRGBATexture(data, width, height, scene, true, false);
  return material;
}

export function cinemaClothMaterial(scene: B.Scene): B.PBRMaterial {
  const material = cinemaMaterial(scene, "cinema-cloth", "#ffffff", CINEMA_STYLE.clothRoughness);
  const width = 2048, height = 1024;
  const texture = new B.DynamicTexture("cinema-cloth-weave", { width, height }, scene, true);
  const context = texture.getContext();
  const pixels = context.createImageData(width, height);
  const color = B.Color3.FromHexString(CINEMA_STYLE.cloth);
  let seed = 731;
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = 0.97 + (seed >>> 24) / 255 * 0.06;
      pixels.data.set([color.r * 255 * grain, color.g * 255 * grain, color.b * 255 * grain, 255], 4 * (y * width + x));
    }
  }
  context.putImageData(pixels, 0, 0);
  const u = (x: number): number => (x + RAIL_INNER_X) / (2 * RAIL_INNER_X) * width;
  const v = (z: number): number => (RAIL_INNER_Z - z) / (2 * RAIL_INNER_Z) * height;
  context.strokeStyle = "rgba(222,225,166,0.43)";
  context.fillStyle = "rgba(224,227,186,0.6)";
  context.lineWidth = 1.3;
  context.beginPath(); context.moveTo(u(-1.04), v(-0.8966)); context.lineTo(u(-1.04), v(0.8966)); context.stroke();
  context.beginPath();
  for (let i = 0; i <= 96; ++i) {
    const angle = Math.PI / 2 + i / 96 * Math.PI;
    const x = u(-1.04 + 0.29 * Math.cos(angle)), y = v(0.29 * Math.sin(angle));
    if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke();
  for (const [x, z] of [[-1.04, -0.29], [-1.04, 0], [-1.04, 0.29], [0, 0], [0.86, 0], [1.42, 0]]) {
    context.beginPath(); context.arc(u(x), v(z), 1.3, 0, 2 * Math.PI); context.fill();
  }
  texture.update();
  texture.wrapU = texture.wrapV = B.Texture.CLAMP_ADDRESSMODE;
  material.albedoTexture = texture;
  material.environmentIntensity = 0.15;
  return material;
}
