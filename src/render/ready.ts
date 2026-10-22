import type * as B from "babylonjs/es6.js";

export async function waitForScene(scene: B.Scene): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Scene resources or shaders did not become ready")), 20000);
      for (const material of scene.materials) {
        material.onError = (_effect, errors) => reject(new Error(`Shader ${material.name}: ${errors}`));
      }
      scene.executeWhenReady(resolve);
    });
  } finally {
    clearTimeout(timer);
  }
}
