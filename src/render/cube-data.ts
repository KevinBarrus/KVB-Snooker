export interface CubeData {
  size: number;
  faces: Float32Array[];
}

// PCOL L10709-10746
export function unpackCubeAtlas(
  pixels: ArrayLike<number>, width: number, height: number, channels: 3 | 4,
  divisor = 1, gamma = 1
): CubeData[] {
  const size = height / 6;
  const count = width / size;
  if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(count) || count < 1 ||
      pixels.length !== width * height * channels || divisor <= 0 || !Number.isFinite(gamma)) {
    throw new Error("Invalid cube atlas dimensions or pixel format");
  }
  const cubes: CubeData[] = [];
  for (let cube = 0; cube < count; ++cube) {
    const faces: Float32Array[] = [];
    for (let face = 0; face < 6; ++face) {
      const data = new Float32Array(size * size * 3);
      for (let y = 0; y < size; ++y) {
        for (let x = 0; x < size; ++x) {
          const source = ((y + size * face) * width + cube * size + x) * channels;
          const target = (y * size + x) * 3;
          for (let channel = 0; channel < 3; ++channel) {
            data[target + channel] = Math.pow(pixels[source + channel] / divisor, gamma);
          }
        }
      }
      faces.push(data);
    }
    cubes.push({ size, faces });
  }
  return cubes;
}
