export interface AIProfile {
  name: string;
  level: number;
  range: number;
  abf: number;
  bcf: number;
  chaoticSeed: number;
  mpm: number;
  bpm: number;
}

// PCOL L2845-2877
export const AI_PROFILES: Record<"EASY" | "NORMAL" | "HARD", AIProfile> = {
  EASY: { name: "AI-1", level: 2.5, range: 1.9, abf: 1.2, bcf: 1.6, chaoticSeed: 3, mpm: 0.8, bpm: 1.2 },
  NORMAL: { name: "AI-2", level: 4, range: 2.5, abf: 1, bcf: 1, chaoticSeed: 3, mpm: 0.7, bpm: 1 },
  HARD: { name: "AI-3", level: 5, range: 3.3, abf: 0.72, bcf: 0.82, chaoticSeed: 2, mpm: 0.45, bpm: 0.8 }
};
