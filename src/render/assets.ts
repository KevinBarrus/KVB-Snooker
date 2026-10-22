import * as B from "babylonjs/es6.js";
import manifest from "./assets.json";

// PCOL L333-477
export function assetUrl(name: keyof typeof manifest): string {
  return `/assets/render/${manifest[name].file}`;
}

export async function loadTexture(scene: B.Scene, name: keyof typeof manifest): Promise<B.Texture> {
  return new Promise((resolve, reject) => {
    const texture = new B.Texture(assetUrl(name), scene, false, true, B.Texture.TRILINEAR_SAMPLINGMODE,
      () => resolve(texture), message => reject(new Error(`Texture ${name}: ${message}`)));
  });
}
