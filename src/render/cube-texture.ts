import * as B from "babylonjs/es6.js";
import { unpackCubeAtlas, type CubeData } from "./cube-data.js";

// PCOL L10585-10630
export class CubeTexture extends B.BaseTexture {
  constructor(scene: B.Scene, name: string, data: CubeData) {
    super(scene);
    this.name = name;
    this.coordinatesMode = B.Texture.CUBIC_MODE;
    this.isCube = true;
    this.gammaSpace = false;
    this.lodGenerationScale = 1;
    const engine = scene.getEngine();
    this._texture = engine.createRawCubeTexture(data.faces, data.size, B.Engine.TEXTUREFORMAT_RGB,
      engine.getCaps().textureFloat ? B.Engine.TEXTURETYPE_FLOAT : B.Engine.TEXTURETYPE_UNSIGNED_INT,
      true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
  }
}

// PCOL L10730-10746
export async function loadCubeAtlas(scene: B.Scene, url: string): Promise<CubeTexture[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cube atlas ${url}: HTTP ${response.status}`);
  let data: CubeData[];
  if (url.endsWith(".hdr")) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const header = B.HDRTools.RGBE_ReadHeader(bytes);
    data = unpackCubeAtlas(B.HDRTools.RGBE_ReadPixels(bytes, header), header.width, header.height, 3);
  } else {
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas2D support for cube atlas");
      context.drawImage(bitmap, 0, 0);
      data = unpackCubeAtlas(context.getImageData(0, 0, bitmap.width, bitmap.height).data,
        bitmap.width, bitmap.height, 4, 255, 2.2);
    } finally {
      bitmap.close();
    }
  }
  return data.map((cube, index) => new CubeTexture(scene, `${url}:${index}`, cube));
}
