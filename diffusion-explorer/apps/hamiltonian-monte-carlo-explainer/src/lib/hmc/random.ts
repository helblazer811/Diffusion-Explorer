/**
 * Seeded RNG and Gaussian sampling utilities.
 */

export type Vec2 = [number, number];

/**
 * Axis-aligned rectangular boundary used for visualization-only rejection
 * in MCMC/HMC: proposals landing outside the box are rejected outright.
 */
export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export function inBounds(p: Vec2, b: Bounds): boolean {
  return p[0] >= b.xMin && p[0] <= b.xMax && p[1] >= b.yMin && p[1] <= b.yMax;
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function boxMuller(rng: () => number): Vec2 {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const r = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * u2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}
