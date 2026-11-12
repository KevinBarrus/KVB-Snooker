// PCOL L8932-8968, L9418-9632
export const PCOL_TABLE_TUNING = {
  clothSlidingFriction: 0.15,
  clothRollingFriction: 0.013,
  cushionFriction: 0.15,
  cushionRestitution: 0.92,
  jawRestitution: 0.45,
  angularRetention: 0.99
};

export const TABLE_TUNING = {
  ...PCOL_TABLE_TUNING,
  clothSlidingFriction: 0.15,
  clothRollingFriction: 0.012,
  cushionFriction: 0.25,
  cushionRestitution: 0.94,
  jawRestitution: 0.45, // 袋角弹性（普通库边为 cushionRestitution）
  angularRetention: 0.995
};
