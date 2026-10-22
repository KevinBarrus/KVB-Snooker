import * as B from "babylonjs/es6.js";
import { assetUrl, loadTexture } from "./assets.js";
import { loadCubeAtlas, type CubeTexture } from "./cube-texture.js";
import { createProbeSample, sampleLightProbes, PROBE_AABB, type ProbeSample } from "./light-probes.js";
import { ballVertex } from "./shaders/ball-vertex.js";
import { ballPixel } from "./shaders/ball-pixel.js";
import * as ballDeclarations from "./shaders/ball-declarations.js";
import { carpetVertex } from "./shaders/carpet-vertex.js";
import { carpetPixel } from "./shaders/carpet-pixel.js";
import * as carpetDeclarations from "./shaders/carpet-declarations.js";

// PCOL L373-382
export const BALL_COLORS: readonly (readonly [number, number, number])[] = [
  [0.8, 0.6, 0.4], [0.2, 0, 0.001], [0.5, 0.2, 0], [0, 0.058546, 0.015527],
  [0.1, 0.017188, 0], [0.005218, 0.048421, 0.23805], [0.535055, 0.077231, 0.102762], [0, 0, 0]
];

function registerShaders(): void {
  Object.assign(B.Effect.ShadersStore, {
    pcolBallVertexShader: ballVertex, pcolBallPixelShader: ballPixel,
    pcolClothVertexShader: carpetVertex, pcolClothPixelShader: carpetPixel
  });
  Object.assign(B.Effect.IncludesShadersStore, ballDeclarations, carpetDeclarations, {
    pcolLightFragment: B.Effect.IncludesShadersStore.lightFragment.replace(/light\{X\}\.(\w+)/g, "$1{X}")
  });
}

function bindEye(effect: B.Effect, scene: B.Scene): void {
  const camera = scene.activeCamera;
  if (!camera) throw new Error("Material requires an active camera");
  const position = camera.globalPosition;
  effect.setFloat4("vEyePosition", position.x, position.y, position.z, scene.useRightHandedSystem ? 1 : -1);
}

export interface BallLighting {
  radiance: CubeTexture;
  irradiance: CubeTexture[];
  ao: CubeTexture;
  brdf: B.BaseTexture;
}

// PCOL L443-466, L10450-10525
export class BallMaterial extends B.ShaderMaterial {
  private readonly samples = new WeakMap<B.Mesh, ProbeSample>();

  constructor(scene: B.Scene, number: number, private readonly lighting: BallLighting) {
    registerShaders();
    const color = BALL_COLORS[number];
    if (!color) throw new Error(`Unknown ball number: ${number}`);
    super(`ball-material-${number}`, scene, "pcolBall", {
      attributes: ["position", "normal"],
      uniforms: ["world", "viewProjection", "vEyePosition", "vDiffuseColor", "vReflectivity", "vLightProbeInfos",
        "vLodFallOff", "vAABB", "vAoInfos", "vDynamicRatios"],
      samplers: ["aoSampler", "radSampler", "environmentBrdfSampler", ...Array.from({ length: 8 }, (_, i) => `iradSampler${i}`)],
      defines: ["NORMAL", "AO", "AODIRECTUV 10", "DIFFUSEDIRECTUV 0", "REFLECTIVITYROUGHNESSDIRECTUV 0", "DYAO", "RADIANCE", "IRRADIANCE", "USEPARALLAXCORRECTION",
        "USELODFALLOFF", "ENVIRONMENTBRDF", "TONEMAPPINGMODE 2", "PBR", "USEPHYSICALLIGHTFALLOFF",
        ...(scene.getEngine().getCaps().textureLOD ? ["LODBASEDMICROSURFACE"] : [])].map(value => `#define ${value}`)
    });
    this.setColor4("vDiffuseColor", new B.Color4(...color, 1));
    this.setVector4("vReflectivity", new B.Vector4(0.04, 0.04, 0.04, 0.1));
    this.setVector4("vLightProbeInfos", new B.Vector4(lighting.radiance.getSize().width, 1, 1, 0));
    this.setVector4("vLodFallOff", new B.Vector4(1.5, 1.5, 5, 2));
    this.setMatrix3x3("vAABB", PROBE_AABB);
    this.setVector2("vAoInfos", new B.Vector2(0, 1));
  }

  override isReady(mesh?: B.AbstractMesh, useInstances?: boolean): boolean {
    return this.lighting.brdf.isReady() && super.isReady(mesh, useInstances);
  }

  override bind(world: B.Matrix, mesh?: B.Mesh): void {
    super.bind(world, mesh);
    const effect = this.getEffect();
    if (!effect) throw new Error("Ball shader is not compiled");
    bindEye(effect, this.getScene());
    effect.setTexture("radSampler", this.lighting.radiance);
    effect.setTexture("aoSampler", this.lighting.ao);
    effect.setTexture("environmentBrdfSampler", this.lighting.brdf);
    if (!mesh) return;
    let sample = this.samples.get(mesh);
    if (!sample) { sample = createProbeSample(); this.samples.set(mesh, sample); }
    sampleLightProbes(mesh.position, sample);
    effect.setArray("vDynamicRatios", Array.from(sample.ratios));
    for (let i = 0; i < 8; ++i) effect.setTexture(`iradSampler${i}`, this.lighting.irradiance[sample.indices[i]]);
  }
}

// PCOL L404-429, L13115-13160
export class CarpetMaterial extends B.ShaderMaterial {
  constructor(scene: B.Scene, textures: readonly B.Texture[], private readonly light: B.SpotLight) {
    registerShaders();
    const names = ["chaotic", "diffuseBase", "diffuseOverlay", "lightmap"];
    super("TableInnerMat", scene, "pcolCloth", {
      attributes: ["position", "normal", "uv", "uv2"],
      uniforms: ["world", "viewProjection", "vEyePosition", "vDiffuseColor", "vReflectivityColor",
        "vLightData0", "vLightDirection0", "vLightDiffuse0", "vLightSpecular0",
        ...names.flatMap(name => [`${name}Matrix`, `v${name[0].toUpperCase()}${name.slice(1)}Infos`])],
      samplers: names.map(name => `${name}Sampler`),
      defines: ["NORMAL", "UV1", "UV2", "PBR", "USEPHYSICALLIGHTFALLOFF", "LIGHT0", "SPOTLIGHT0", "SPECULARTERM",
        "CHAOTIC", "CHAOTICDIRECTUV 0", "DIFFUSEBASE", "DIFFUSEBASEDIRECTUV 0", "DIFFUSEOVERLAY",
        "DIFFUSEOVERLAYDIRECTUV 0", "LIGHTMAP", "LIGHTMAPDIRECTUV 0", "TONEMAPPINGMODE 3"].map(value => `#define ${value}`)
    });
    textures[0].uScale = textures[0].vScale = textures[1].uScale = textures[1].vScale = 30;
    textures[0].level = 0.6;
    textures[1].level = 0.8;
    for (let i = 0; i < names.length; ++i) {
      const name = names[i];
      const texture = textures[i];
      this.setTexture(`${name}Sampler`, texture);
      this.setMatrix(`${name}Matrix`, texture.getTextureMatrix());
      this.setVector2(`v${name[0].toUpperCase()}${name.slice(1)}Infos`, new B.Vector2(texture.coordinatesIndex, texture.level));
    }
    this.setColor4("vDiffuseColor", new B.Color4(0.008, 0.07, 0.015, 1));
    this.setColor3("vReflectivityColor", new B.Color3(0.012, 0.012, 0.012));
  }

  override bind(world: B.Matrix, mesh?: B.Mesh): void {
    super.bind(world, mesh);
    const effect = this.getEffect();
    if (!effect) throw new Error("Carpet shader is not compiled");
    bindEye(effect, this.getScene());
    const light = this.light;
    const direction = light.direction.normalizeToNew();
    const intensity = light.getScaledIntensity();
    effect.setFloat4("vLightData0", light.position.x, light.position.y, light.position.z, light.exponent);
    effect.setFloat4("vLightDirection0", direction.x, direction.y, direction.z, Math.cos(light.angle / 2));
    effect.setFloat4("vLightDiffuse0", light.diffuse.r * intensity, light.diffuse.g * intensity, light.diffuse.b * intensity, light.range);
    effect.setColor3("vLightSpecular0", light.specular.scale(intensity));
  }
}

export async function loadBallLighting(scene: B.Scene): Promise<BallLighting> {
  const [radiance, bottom, top, ao] = await Promise.all([
    loadCubeAtlas(scene, assetUrl("ball-ref-g8.rad")), loadCubeAtlas(scene, assetUrl("com-irrd0")),
    loadCubeAtlas(scene, assetUrl("com-irrd1")), loadCubeAtlas(scene, assetUrl("ball-ao-new"))
  ]);
  if (radiance.length !== 1 || ao.length !== 1 || bottom.length !== 15 || top.length !== 15) {
    throw new Error("Invalid PCOL probe atlas count");
  }
  return { radiance: radiance[0], ao: ao[0], irradiance: [...bottom, ...top], brdf: B.TextureTools.GetEnvironmentBRDFTexture(scene) };
}

export async function loadCarpetMaterial(scene: B.Scene, light: B.SpotLight): Promise<CarpetMaterial> {
  const names = ["carpet-normal", "carpet-tiled", "carpet-overlay", "carpet-light"] as const;
  return new CarpetMaterial(scene, await Promise.all(names.map(name => loadTexture(scene, name))), light);
}
