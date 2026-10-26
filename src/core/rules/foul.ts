// PCOL L9949-9972（原模 30）：犯规位掩码与文案。
export const FOUL = {
  MISS_TARGET: 1,
  ILLEGAL_FIRST_HIT: 2,
  ILLEGAL_POTTING: 4,
  POTTING_CUE_BALL: 8,
  OFF_TABLE: 16,
  PUSH_STROKE: 32,
  FREE_BALL_SNOOKER: 64
} as const;

const TEXTS = [
  "",
  "MISS TARGET",
  "ILLEGAL FIRST HIT",
  "ILLEGAL POTTING",
  "POTTING THE CUE BALL",
  "OFF TABLE",
  "PUSH STROKE",
  "SNOOKERED BY FREE BALL"
] as const;

export function getFoulDescription(foulCode: number): string {
  let text = "";
  let bit = 1;
  let index = 1;
  let has = false;
  for (; bit <= foulCode; ) {
    if (bit & foulCode) {
      text += has ? ", " + TEXTS[index] : TEXTS[index];
      has = true;
    }
    bit <<= 1;
    index++;
  }
  return has ? text + "." : text;
}
