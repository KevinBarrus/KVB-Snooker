import * as B from "babylonjs/es6.js";

// PCOL L491-496, L959-1000
export const TABLE_COLORS = {
  white: [218 / 255, 218 / 255, 218 / 255], red: [1, 80 / 255, 15 / 255],
  green: [25 / 255, 205 / 255, 84 / 255], yellow: [237 / 255, 181 / 255, 30 / 255]
} as const;

// PCOL L1105-1115, L9911
export function createTableMaterial(scene: B.Scene, atlas: B.Texture, mask: B.Texture): B.ShaderMaterial {
  B.Effect.ShadersStore.pcolTableOverlayVertexShader = `precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec3 color;
attribute float alpha;
uniform mat4 world;
uniform mat4 viewProjection;
uniform vec4 border;
varying vec2 vUV;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vMaskUV;
void main(void) {
  vec4 worldPos = world * vec4(position, 1.0);
  gl_Position = viewProjection * worldPos;
  vUV = uv; vColor = color; vAlpha = alpha;
  vMaskUV = (worldPos.xz - border.xy) / border.zw + 0.5;
}`;
  B.Effect.ShadersStore.pcolTableOverlayPixelShader = `precision highp float;
varying vec2 vUV;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vMaskUV;
uniform sampler2D sourceSampler;
uniform sampler2D maskSampler;
void main(void) {
  vec4 sourceColor = texture2D(sourceSampler, vUV);
  float mask = texture2D(maskSampler, vMaskUV).r;
  gl_FragColor = vec4(sourceColor.rgb * vColor, sourceColor.a * mask * vAlpha);
}`;
  const material = new B.ShaderMaterial("table-overlay", scene, "pcolTableOverlay", {
    attributes: ["position", "uv", "color", "alpha"], uniforms: ["world", "viewProjection", "border"],
    samplers: ["sourceSampler", "maskSampler"], needAlphaBlending: true
  });
  mask.wrapU = mask.wrapV = B.Texture.CLAMP_ADDRESSMODE;
  material.setTexture("sourceSampler", atlas);
  material.setTexture("maskSampler", mask);
  material.setVector4("border", new B.Vector4(0, 0, 3.66, 1.859));
  return material;
}

// PCOL L1007-1024, L1205-1211
export function createTablePlane(scene: B.Scene, material: B.Material, name: string,
  frame: readonly [number, number, number, number], size: number): B.Mesh {
  const mesh = new B.Mesh(name, scene);
  const half = size / 2;
  const [x, y, width, height] = frame;
  const u0 = x / 512, u1 = (x + width) / 512, v0 = (512 - y - height) / 512, v1 = (512 - y) / 512;
  mesh.setVerticesData("position", [-half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half]);
  mesh.setVerticesData("uv", [u0, v0, u1, v0, u1, v1, u0, v1]);
  mesh.setVerticesData("color", Array(12).fill(1), true, 3);
  mesh.setVerticesData("alpha", Array(4).fill(0), true, 1);
  mesh.setIndices([0, 1, 2, 0, 2, 3]);
  mesh.material = material;
  mesh.position.y = 0.881;
  mesh.alphaIndex = -10;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

export function tintTablePlane(mesh: B.Mesh, color: readonly number[], alpha: number): void {
  mesh.isVisible = alpha > 0;
  mesh.updateVerticesData("alpha", Array(mesh.getTotalVertices()).fill(alpha));
  mesh.updateVerticesData("color", Array.from({ length: mesh.getTotalVertices() }, () => color).flat());
}
