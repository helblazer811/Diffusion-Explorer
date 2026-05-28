/**
 * Stein Variational Gradient Descent (SVGD) for an isotropic Gaussian
 * mixture target. Self-contained: seeded RNG, target ∇log p, RBF kernel
 * with median-heuristic bandwidth, and a trajectory-recording driver.
 *
 * Update rule (Liu & Wang, 2016):
 *   φ(xᵢ) = (1/n) Σⱼ [ k(xⱼ, xᵢ) ∇log p(xⱼ) + ∇_{xⱼ} k(xⱼ, xᵢ) ]
 *   xᵢ ← xᵢ + ε · φ(xᵢ)
 * RBF kernel:  k(x, y) = exp(−‖x − y‖² / (2h²))
 *   ∇_{x} k(x, y) = − (x − y) / h² · k(x, y)
 *
 * The GMM target is Σₖ wₖ N(μₖ, σ²I) (shared isotropic σ across components).
 */

export type Vec2 = [number, number];

// ----------------------------------------------------------------
// RNG / sampling
// ----------------------------------------------------------------

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

/**
 * Sample `n` points uniformly over the axis-aligned rectangle
 * [xMin, xMax] × [yMin, yMax].
 */
export function sampleUniform2D(
  rng: () => number,
  xRange: [number, number],
  yRange: [number, number],
  n: number,
): number[][] {
  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  const out: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = [xMin + rng() * xSpan, yMin + rng() * ySpan];
  }
  return out;
}

export function sampleIsotropicGaussian(
  rng: () => number,
  mean: Vec2,
  std: number,
  n: number,
): number[][] {
  const out: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const [z1, z2] = boxMuller(rng);
    out[i] = [mean[0] + std * z1, mean[1] + std * z2];
  }
  return out;
}

/**
 * Means of `n` isotropic Gaussians equally spaced on a circle of the
 * given radius (a ring mixture).
 */
export function ringMeans(
  n: number,
  radius: number,
  center: Vec2 = [0, 0],
  startAngle = 0,
): Vec2[] {
  const out: Vec2[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = startAngle + (2 * Math.PI * i) / n;
    out[i] = [center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)];
  }
  return out;
}

// ----------------------------------------------------------------
// Ring-shaped (annular) targets and zig-zag mixtures of them
// ----------------------------------------------------------------

/**
 * A single ring/annular component: density concentrated on a circle of
 * radius `radius` around `center`, with radial std `sigma` (and uniform
 * in angle).
 *
 *   f(x) ∝ exp(−(‖x − c‖ − r)² / (2σ²))
 */
export interface RingComponent {
  center: Vec2;
  radius: number;
  sigma: number;
  weight: number;
}

/**
 * 6 ring components arranged in a zig-zag — x positions evenly spaced
 * from left to right, y alternating ±offsetY.
 */
export function zigzagRings(
  n: number,
  xRange: [number, number],
  offsetY: number,
  radius: number,
  sigma: number,
): RingComponent[] {
  const out: RingComponent[] = new Array(n);
  const w = 1 / n;
  for (let i = 0; i < n; i++) {
    const tx = n === 1 ? 0.5 : i / (n - 1);
    const cx = xRange[0] + tx * (xRange[1] - xRange[0]);
    const cy = (i % 2 === 0 ? 1 : -1) * offsetY;
    out[i] = { center: [cx, cy], radius, sigma, weight: w };
  }
  return out;
}

/**
 * ∇log p(x) for a mixture of ring components. The single-component
 * gradient pulls toward the ring surface:
 *
 *   ∇log fₖ(x) = (rₖ/dₖ − 1) · (x − cₖ) / σₖ²,  dₖ = ‖x − cₖ‖
 *
 * The mixture gradient is the responsibility-weighted sum, with
 * responsibilities computed via log-sum-exp for stability.
 */
export function ringMixtureLogProbGrad(
  x: number[],
  components: RingComponent[],
): Vec2 {
  // Component log-densities (unnormalized — Z_k cancels in responsibilities
  // when all components share the analytic prefactor structure; for ring
  // mixtures with possibly different σ this drops the σ-dependent constants
  // but those only shift responsibilities by a tiny bias that we ignore
  // here for visualization purposes).
  const logTerms: number[] = new Array(components.length);
  const dists: number[] = new Array(components.length);
  let maxLog = -Infinity;
  for (let k = 0; k < components.length; k++) {
    const { center, radius, sigma, weight } = components[k];
    const dx = x[0] - center[0];
    const dy = x[1] - center[1];
    const d = Math.sqrt(dx * dx + dy * dy);
    dists[k] = d;
    const diff = d - radius;
    const lt = Math.log(weight) - (diff * diff) / (2 * sigma * sigma);
    logTerms[k] = lt;
    if (lt > maxLog) maxLog = lt;
  }

  let denom = 0;
  const probs: number[] = new Array(components.length);
  for (let k = 0; k < components.length; k++) {
    probs[k] = Math.exp(logTerms[k] - maxLog);
    denom += probs[k];
  }

  let gx = 0, gy = 0;
  for (let k = 0; k < components.length; k++) {
    const r = probs[k] / denom;
    const { center, radius, sigma } = components[k];
    const d = dists[k];
    // Avoid division by zero at the exact center.
    const dSafe = d > 1e-9 ? d : 1e-9;
    const factor = ((radius / dSafe) - 1) / (sigma * sigma);
    gx += r * factor * (x[0] - center[0]);
    gy += r * factor * (x[1] - center[1]);
  }
  // Clip gradient magnitude — for thin rings (small σ) the 1/σ² factor
  // explodes far from the ring surface and a single SVGD step can
  // overshoot wildly. 50 keeps motion bounded without changing the
  // gradient direction.
  const norm = Math.sqrt(gx * gx + gy * gy);
  const maxNorm = 50;
  if (norm > maxNorm) {
    const s = maxNorm / norm;
    gx *= s;
    gy *= s;
  }
  return [gx, gy];
}

/**
 * Draw `n` samples from a ring mixture: pick a component by weight,
 * pick a uniform angle, and sample radius ~ N(rₖ, σₖ²).
 */
export function sampleRingMixture(
  rng: () => number,
  components: RingComponent[],
  n: number,
): number[][] {
  const cum: number[] = [];
  let s = 0;
  for (const c of components) { s += c.weight; cum.push(s); }
  // Normalize in case weights don't sum to 1.
  for (let i = 0; i < cum.length; i++) cum[i] /= s;

  const out: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = rng();
    let k = 0;
    while (k < cum.length - 1 && u > cum[k]) k++;
    const comp = components[k];
    const theta = 2 * Math.PI * rng();
    const [z] = boxMuller(rng);
    const r = comp.radius + comp.sigma * z;
    out[i] = [comp.center[0] + r * Math.cos(theta), comp.center[1] + r * Math.sin(theta)];
  }
  return out;
}

export function sampleGMM(
  rng: () => number,
  means: Vec2[],
  weights: number[],
  std: number,
  n: number,
): number[][] {
  const cum: number[] = [];
  let s = 0;
  for (const w of weights) { s += w; cum.push(s); }
  const out: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = rng();
    let k = 0;
    while (k < cum.length - 1 && u > cum[k]) k++;
    const [z1, z2] = boxMuller(rng);
    out[i] = [means[k][0] + std * z1, means[k][1] + std * z2];
  }
  return out;
}

// ----------------------------------------------------------------
// Target: isotropic Gaussian mixture
// ----------------------------------------------------------------

/**
 * ∇log p(x) for p(x) = Σₖ wₖ N(x | μₖ, σ²I).
 *
 *   ∇log p(x) = Σₖ rₖ(x) · (μₖ − x) / σ²,   where rₖ = responsibility.
 *
 * Computed with a log-sum-exp shift for numerical stability across
 * widely separated modes.
 */
export function gmmLogProbGrad(
  x: number[],
  means: Vec2[],
  weights: number[],
  std: number,
): Vec2 {
  const inv2sig2 = 1 / (2 * std * std);
  const invSig2 = 1 / (std * std);

  const logTerms: number[] = new Array(means.length);
  let maxLog = -Infinity;
  for (let k = 0; k < means.length; k++) {
    const dx = x[0] - means[k][0];
    const dy = x[1] - means[k][1];
    const lt = Math.log(weights[k]) - (dx * dx + dy * dy) * inv2sig2;
    logTerms[k] = lt;
    if (lt > maxLog) maxLog = lt;
  }

  let denom = 0;
  const probs: number[] = new Array(means.length);
  for (let k = 0; k < means.length; k++) {
    probs[k] = Math.exp(logTerms[k] - maxLog);
    denom += probs[k];
  }

  let gx = 0, gy = 0;
  for (let k = 0; k < means.length; k++) {
    const r = probs[k] / denom;
    gx += r * (means[k][0] - x[0]) * invSig2;
    gy += r * (means[k][1] - x[1]) * invSig2;
  }
  return [gx, gy];
}

// ----------------------------------------------------------------
// Rectangular-grid KDE (for visualizing the target density)
// ----------------------------------------------------------------

/**
 * Kernel density estimate of `points` evaluated on a `gridW × gridH`
 * rectangular grid over `domain`. Splats points then applies a
 * separable Gaussian blur with std `sigma` measured in grid cells.
 *
 * Returns a row-major `Float32Array` of un-normalized density (length
 * `gridW * gridH`). The caller normalizes if desired.
 *
 * If the caller picks `gridW / gridH` to match the data-domain aspect,
 * each cell covers the same data area in x and y and a scalar sigma
 * is isotropic in data space.
 */
export function computeRectKDE(
  points: number[][],
  domain: [number, number, number, number],
  gridW: number,
  gridH: number,
  sigma: number,
): Float32Array {
  const [xMin, xMax, yMin, yMax] = domain;
  const grid = new Float32Array(gridW * gridH);

  const sx = (x: number) => ((x - xMin) / (xMax - xMin)) * (gridW - 1);
  const sy = (y: number) => ((y - yMin) / (yMax - yMin)) * (gridH - 1);

  for (const [x, y] of points) {
    const gx = Math.round(sx(x));
    const gy = Math.round(sy(y));
    if (gx >= 0 && gx < gridW && gy >= 0 && gy < gridH) {
      grid[gy * gridW + gx] += 1;
    }
  }

  // 1-D Gaussian kernel
  const radius = Math.ceil(3 * sigma);
  const ksize = 2 * radius + 1;
  const kernel = new Float32Array(ksize);
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    ksum += v;
  }
  for (let i = 0; i < ksize; i++) kernel[i] /= ksum;

  // Horizontal pass
  const tmp = new Float32Array(gridW * gridH);
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < gridW) acc += grid[y * gridW + xx] * kernel[k + radius];
      }
      tmp[y * gridW + x] = acc;
    }
  }

  // Vertical pass
  const out = new Float32Array(gridW * gridH);
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < gridH) acc += tmp[yy * gridW + x] * kernel[k + radius];
      }
      out[y * gridW + x] = acc;
    }
  }

  return out;
}

// ----------------------------------------------------------------
// RBF kernel bandwidth (median heuristic)
// ----------------------------------------------------------------

/**
 * Bandwidth h such that h² = med(‖xᵢ − xⱼ‖²) / log(n + 1). Standard
 * choice from the SVGD paper; makes the kernel scale-adaptive to the
 * current particle spread.
 */
export function medianHeuristicBandwidth(particles: number[][]): number {
  const n = particles.length;
  if (n < 2) return 1;
  const dists: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = particles[i][0] - particles[j][0];
      const dy = particles[i][1] - particles[j][1];
      dists.push(dx * dx + dy * dy);
    }
  }
  dists.sort((a, b) => a - b);
  const med = dists[Math.floor(dists.length / 2)];
  const h2 = Math.max(med / Math.log(n + 1), 1e-6);
  return Math.sqrt(h2);
}

// ----------------------------------------------------------------
// SVGD step + driver
// ----------------------------------------------------------------

export type LogProbGrad = (x: number[]) => Vec2;

/**
 * One SVGD update with a precomputed bandwidth `h`. Returns a fresh
 * array of particles; does not mutate the input.
 */
export function svgdStep(
  particles: number[][],
  logProbGrad: LogProbGrad,
  h: number,
  stepSize: number,
): number[][] {
  const n = particles.length;
  const h2 = h * h;
  const invH2 = 1 / h2;

  // Precompute ∇log p at each particle to avoid n² gradient evals.
  const grads: Vec2[] = new Array(n);
  for (let j = 0; j < n; j++) grads[j] = logProbGrad(particles[j]);

  const next: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0;
    const xi = particles[i];
    for (let j = 0; j < n; j++) {
      const xj = particles[j];
      const dx = xj[0] - xi[0];
      const dy = xj[1] - xi[1];
      const k = Math.exp(-(dx * dx + dy * dy) / (2 * h2));
      // Attractive: k(xⱼ, xᵢ) · ∇log p(xⱼ)
      sx += k * grads[j][0];
      sy += k * grads[j][1];
      // Repulsive: ∇_{xⱼ} k(xⱼ, xᵢ) = (xᵢ − xⱼ) · k / h²
      sx += (xi[0] - xj[0]) * invH2 * k;
      sy += (xi[1] - xj[1]) * invH2 * k;
    }
    next[i] = [xi[0] + stepSize * sx / n, xi[1] + stepSize * sy / n];
  }
  return next;
}

// ----------------------------------------------------------------
// Arclength reparameterization
// ----------------------------------------------------------------

/**
 * Resample `polyline` so the returned `numSamples` points are spaced at
 * uniform arclength along the original path. Endpoint and starting
 * point are preserved; intermediate points are linear interpolations
 * within whichever original segment they land in.
 *
 * Use this to convert a non-uniformly-paced trajectory (e.g. SVGD,
 * where early iterations cover large distances and later iterations
 * barely move) into a constant-velocity animation path.
 */
export function resamplePolylineByArclength(
  polyline: number[][],
  numSamples: number,
): number[][] {
  const n = polyline.length;
  if (n === 0) return [];
  if (n === 1 || numSamples <= 1) {
    return Array.from({ length: numSamples }, () => [polyline[0][0], polyline[0][1]]);
  }

  // Cumulative arclength at each original vertex.
  const cum: number[] = new Array(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    const dx = polyline[i][0] - polyline[i - 1][0];
    const dy = polyline[i][1] - polyline[i - 1][1];
    cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy);
  }
  const total = cum[n - 1];

  const out: number[][] = new Array(numSamples);
  if (total === 0) {
    for (let s = 0; s < numSamples; s++) out[s] = [polyline[0][0], polyline[0][1]];
    return out;
  }

  // Walk the original polyline once, advancing an `idx` cursor as
  // the target arclength increases monotonically.
  let idx = 0;
  for (let s = 0; s < numSamples; s++) {
    const target = (s / (numSamples - 1)) * total;
    while (idx < n - 2 && cum[idx + 1] < target) idx++;
    const segLen = cum[idx + 1] - cum[idx];
    const u = segLen > 0 ? (target - cum[idx]) / segLen : 0;
    const a = polyline[idx];
    const b = polyline[idx + 1];
    out[s] = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  }
  return out;
}

/**
 * Apply per-particle arclength resampling to a `[step][particle][2]`
 * trajectory tensor, returning a new tensor of shape
 * `[numSamples][particle][2]` where each particle moves at constant
 * velocity along its own original path.
 */
export function resampleTrajectoriesByArclength(
  trajectories: number[][][],
  numSamples: number,
): number[][][] {
  if (trajectories.length === 0) return [];
  const numParticles = trajectories[0].length;
  const out: number[][][] = new Array(numSamples);
  for (let s = 0; s < numSamples; s++) out[s] = new Array(numParticles);

  const path: number[][] = new Array(trajectories.length);
  for (let i = 0; i < numParticles; i++) {
    for (let t = 0; t < trajectories.length; t++) path[t] = trajectories[t][i];
    const resampled = resamplePolylineByArclength(path, numSamples);
    for (let s = 0; s < numSamples; s++) out[s][i] = resampled[s];
  }
  return out;
}

export interface RunSVGDOptions {
  numSteps: number;
  stepSize: number;
  logProbGrad: LogProbGrad;
  /** Override the bandwidth instead of using the median heuristic. */
  bandwidth?: number;
}

/**
 * Run SVGD for `numSteps` iterations from `initialParticles` and return
 * the full trajectory shaped as `[step][particle][2]`. The step-0 slice
 * is a copy of the initial particles.
 */
export function runSVGD(
  initialParticles: number[][],
  { numSteps, stepSize, logProbGrad, bandwidth }: RunSVGDOptions,
): number[][][] {
  const trajectories: number[][][] = new Array(numSteps);
  let particles = initialParticles.map((p) => [p[0], p[1]]);
  trajectories[0] = particles.map((p) => [p[0], p[1]]);
  for (let s = 1; s < numSteps; s++) {
    const h = bandwidth ?? medianHeuristicBandwidth(particles);
    particles = svgdStep(particles, logProbGrad, h, stepSize);
    trajectories[s] = particles.map((p) => [p[0], p[1]]);
  }
  return trajectories;
}
