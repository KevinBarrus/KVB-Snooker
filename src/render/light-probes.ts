const X = [-1.6, -1.04, 0, 1.04, 1.6];
const Z = [-0.7, 0, 0.7];
const Y = [0.90625, 1.65];
const EPSILON = 1e-5;

export interface ProbeSample {
  groupId: number;
  indices: number[];
  ratios: Float32Array;
}

export function createProbeSample(): ProbeSample {
  return { groupId: -1, indices: Array<number>(8).fill(0), ratios: new Float32Array(9) };
}

function clampRatio(value: number): number {
  return value < EPSILON ? 0 : value > 1 - EPSILON ? 1 : value;
}

// PCOL L10967-11024
export function sampleLightProbes(position: Readonly<{ x: number; y: number; z: number }>, sample: ProbeSample): void {
  let column = sample.groupId < 0 ? 0 : sample.groupId % 4;
  let row = sample.groupId < 0 ? 0 : Math.floor(sample.groupId / 4);
  while (column > 0 && position.x - X[column] < -EPSILON) --column;
  while (column < 3 && position.x - X[column] > X[column + 1] - X[column] + EPSILON) ++column;
  while (row > 0 && position.z - Z[row] < -EPSILON) --row;
  while (row < 1 && position.z - Z[row] > Z[row + 1] - Z[row] + EPSILON) ++row;
  sample.groupId = row * 4 + column;
  const base = row * 5 + column;
  const indices = [base, base + 1, base + 16, base + 15, base + 5, base + 6, base + 21, base + 20];
  for (let i = 0; i < 8; ++i) sample.indices[i] = indices[i];
  const x = clampRatio((position.x - X[column]) / (X[column + 1] - X[column]));
  const y = clampRatio((position.y - Y[0]) / (Y[1] - Y[0]));
  const z = clampRatio((position.z - Z[row]) / (Z[row + 1] - Z[row]));
  const ratios = sample.ratios;
  ratios[0] = (1 - x) * (1 - y) * (1 - z);
  ratios[1] = x * (1 - y) * (1 - z);
  ratios[4] = (1 - x) * (1 - y) * z;
  ratios[5] = x * (1 - y) * z;
  if (y > EPSILON) {
    ratios[2] = x * y * (1 - z);
    ratios[3] = (1 - x) * y * (1 - z);
    ratios[6] = x * y * z;
    ratios[7] = (1 - x) * y * z;
  } else {
    ratios[2] = -1;
  }
  const height = Math.max(0, position.y - Math.fround(Y[0]));
  ratios[8] = height < 0.1
    ? (1 - height / 0.1) * (0.4 + 0.7 * Math.min(1, (position.x ** 2 + position.z ** 2) / (2.2 ** 2 + 1.3 ** 2)))
    : 0;
}

// PCOL L10842-10865
export const PROBE_AABB = new Float32Array([0, 0.90625, 0, -2.2, -0.90625, -1.3, 2.2, 1.74 - 0.90625, 1.3]);
