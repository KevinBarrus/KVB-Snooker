import * as B from "babylonjs/es6.js";

// PCOL L1105-1115, L9911
const vertex = `precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute float alpha;
uniform mat4 world;
uniform mat4 viewProjection;
uniform vec4 border;
varying vec2 vUV;
varying float vAlpha;
varying vec2 vMaskUV;
void main(void) {
  vec4 worldPos = world * vec4(position, 1.0);
  gl_Position = viewProjection * worldPos;
  vUV = uv;
  vAlpha = alpha;
  vMaskUV = (worldPos.xz - border.xy) / border.zw + 0.5;
}`;

// PCOL L1105-1115, L9911
const pixel = `precision highp float;
varying vec2 vUV;
varying float vAlpha;
varying vec2 vMaskUV;
uniform sampler2D sourceSampler;
uniform sampler2D maskSampler;
void main(void) {
  vec4 sourceColor = texture2D(sourceSampler, vUV);
  float mask = texture2D(maskSampler, vMaskUV).r;
  gl_FragColor = vec4(vec3(0.0), sourceColor.a * mask * vAlpha);
}`;

// PCOL L959-964, L1096-1211, L2063-2069
export class BallShadows {
  readonly mesh: B.Mesh;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;

  constructor(scene: B.Scene, count: number, private readonly radius: number, atlas: B.Texture, mask: B.Texture) {
    B.Effect.ShadersStore.pcolShadowVertexShader = vertex;
    B.Effect.ShadersStore.pcolShadowPixelShader = pixel;
    const material = new B.ShaderMaterial("ball-shadows", scene, "pcolShadow", {
      attributes: ["position", "uv", "alpha"],
      uniforms: ["world", "viewProjection", "border"], samplers: ["sourceSampler", "maskSampler"],
      needAlphaBlending: true
    });
    mask.wrapU = mask.wrapV = B.Texture.CLAMP_ADDRESSMODE;
    material.setTexture("sourceSampler", atlas);
    material.setTexture("maskSampler", mask);
    material.setVector4("border", new B.Vector4(0, 0, 3.66, 1.859));
    this.mesh = new B.Mesh("ball-shadows", scene);
    this.mesh.material = material;
    this.mesh.position.y = 0.881;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.positions = new Float32Array(count * 12);
    this.alphas = new Float32Array(count * 4);
    const uv: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < count; ++i) {
      uv.push(43 / 512, 43 / 512, 205 / 512, 43 / 512, 205 / 512, 205 / 512, 43 / 512, 205 / 512);
      const start = i * 4;
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    this.mesh.setVerticesData("position", this.positions, true, 3);
    this.mesh.setVerticesData("alpha", this.alphas, true, 1);
    this.mesh.setVerticesData("uv", uv, false, 2);
    this.mesh.setIndices(indices);
  }

  setBall(index: number, x: number, z: number, visible: boolean): void {
    const half = 1.3 * this.radius;
    this.positions.set([x - half, 0, z - half, x + half, 0, z - half,
      x + half, 0, z + half, x - half, 0, z + half], index * 12);
    this.alphas.fill(visible ? 0.8 : 0, index * 4, index * 4 + 4);
  }

  flush(): void {
    this.mesh.updateVerticesData("position", this.positions);
    this.mesh.updateVerticesData("alpha", this.alphas);
  }

  dispose(): void { this.mesh.dispose(false, true); }
}
