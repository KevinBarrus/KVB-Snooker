import * as B from "babylonjs/es6.js";
import { CINEMA_STYLE } from "./cinema-style.js";

export function createCinemaPipeline(scene: B.Scene): B.DefaultRenderingPipeline {
  const camera = scene.activeCamera;
  if (!camera) throw new Error("Cinema requires an active camera");
  const pipeline = new B.DefaultRenderingPipeline("cinema", true, scene, [camera], false);
  pipeline.imageProcessingEnabled = true;
  pipeline.fxaaEnabled = true;
  pipeline.bloomEnabled = true;
  pipeline.bloomWeight = CINEMA_STYLE.bloomWeight;
  pipeline.bloomThreshold = CINEMA_STYLE.bloomThreshold;
  pipeline.bloomKernel = 32;
  pipeline.bloomScale = 0.5;
  const processing = scene.imageProcessingConfiguration;
  processing.exposure = CINEMA_STYLE.exposure;
  processing.contrast = CINEMA_STYLE.contrast;
  processing.toneMappingEnabled = true;
  processing.vignetteEnabled = true;
  processing.vignetteWeight = CINEMA_STYLE.vignetteWeight;
  processing.vignetteStretch = 0;
  processing.colorCurvesEnabled = true;
  const curves = new B.ColorCurves();
  curves.globalSaturation = CINEMA_STYLE.saturation;
  processing.colorCurves = curves;
  pipeline.prepare();
  scene.onDisposeObservable.add(() => pipeline.dispose());
  return pipeline;
}
