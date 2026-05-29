/**
 * StatelessStreakletAnimation — wind-map-style particle advection where the
 * trail history lives in particle state instead of in the canvas pixel buffer.
 *
 * Compared to StreakletAnimation (which uses canvas persistence + alpha fade
 * to produce trails), this class keeps a ring buffer of the last `trailLength`
 * positions per particle, clears the canvas every frame, and redraws each
 * trail as a polyline with a per-vertex alpha gradient (newest = full, oldest
 * = transparent).
 *
 * Trade-offs vs the canvas-persistence approach:
 *
 *  + No alpha-blend rounding plateau → no gray haze accumulating on light
 *    backgrounds. The output is a pure function of particle state.
 *  + Trail length is an explicit integer, not an emergent function of
 *    `fadeAlpha`. Easier to reason about.
 *  + Resizing / panning / zooming the canvas does not strand old pixels.
 *  + Per-segment effects (speed coloring, head highlight) are direct.
 *  − More drawing per frame: O(numParticles × trailLength) line segments.
 *    Fine on Canvas2D up to ~100k segments/frame; beyond that, move to GPU.
 *  − Per-particle memory: O(trailLength) floats. Still tiny in absolute terms.
 *
 * API matches StreakletAnimation so figures can swap one for the other.
 *
 * @example
 * const anim = StatelessStreakletAnimation.create({
 *   vectorFieldFn,
 *   domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *   toPixel,
 *   numParticles: 600,
 *   trailLength: 80,
 *   color: '#dc2626',
 * });
 * await anim.init(canvas);
 *
 * let last = performance.now();
 * timeline.add(anim.clip, { start: 0, end: 1 });
 * timeline.onTick(() => {
 *   const now = performance.now();
 *   const dt = Math.min(0.1, (now - last) / 1000);
 *   last = now;
 *   anim.draw({ dt });
 * });
 */

import type { AnimationWithData, Clip } from '@helblazer811/tempus';
import type { VectorFieldFn, StreamlineDomain } from '../../plotting/streamlines/index';
import { drawTrajectories } from '../../plotting/trajectories';
// Re-use the state shape from the canvas-persistent streaklet so figures
// can swap one class for the other without changing their state type.
import type { StreakletAnimationState } from './streaklet-animation';

export type StatelessStreakletAnimationData = {
  numParticles: number;
  maxSpeed: number;
};

export type StatelessStreakletSeedingBias = 'uniform' | 'speed-balanced' | 'toward-fast';

export type StatelessStreakletSpeedColorMode = 'none' | 'alpha' | 'ramp';

/**
 * Rendering backend selection.
 *
 * - `'cpu'`: Canvas 2D. Compatible with any browser. Bottleneck at ~50k segments/frame.
 * - `'gpu'`: WebGPU via the shared `GPUTrajectoryRenderer`. Canvas must be pristine
 *   (no prior `getContext('2d')`). Set `background-color` on the canvas via CSS;
 *   the renderer clears to transparent each frame.
 * - `'auto'`: prefer GPU when `navigator.gpu` is available, otherwise CPU.
 */
export type StatelessStreakletBackend = 'cpu' | 'gpu' | 'auto';

export interface StatelessStreakletAnimationOptions {
  // --- Required ---
  vectorFieldFn: VectorFieldFn;
  domain: StreamlineDomain;
  toPixel: (p: [number, number]) => [number, number];

  // --- Particle population ---
  /** Default: 600. */
  numParticles?: number;
  /** Number of trailing positions retained per particle. Default: 80. */
  trailLength?: number;
  /** Max particle age in frames before respawn (random in [1, base]). Default: 500. */
  baseLifetimeFrames?: number;
  /** Per-frame Euler step multiplier in domain units. Default: 0.01. */
  speedScale?: number;

  // --- Seeding ---
  seedingBias?: StatelessStreakletSeedingBias;

  // --- Rendering ---
  /**
   * Backend used for drawing the trail polylines. `'auto'` picks GPU when
   * available. Default: `'cpu'` for backwards compatibility.
   */
  backend?: StatelessStreakletBackend;
  color?: string;
  strokeWidth?: number;
  /**
   * Background color of the canvas. On the CPU backend this is painted via
   * `fillRect` each frame. On the GPU backend the renderer always clears to
   * transparent, so set this to match the CSS `background-color` of the
   * canvas element (used only for the very first pre-init paint).
   */
  background?: string;
  speedColorMode?: StatelessStreakletSpeedColorMode;
  speedGamma?: number;
  alphaFloor?: number;
  /** Subdivision factor for the per-segment alpha gradient. Default: 1 (no extra subdivisions). */
  gradientSubdivisions?: number;
  /**
   * Gamma applied to the position-along-trail (0 at tail, 1 at head) before
   * multiplying into alpha. Shapes the trail's brightness profile:
   *   1.0 (default) — linear ramp
   *   > 1.0 — head-loaded: only the leading edge is bright, trail dies off fast
   *   < 1.0 — tail-loaded: trail stays visible far from the head, head fades in gently
   */
  trailAlphaGamma?: number;
}

// ============================================================================
// Internals
// ============================================================================

const DEFAULTS = {
  numParticles: 600,
  trailLength: 80,
  baseLifetimeFrames: 500,
  speedScale: 0.01,
  seedingBias: 'toward-fast' as StatelessStreakletSeedingBias,
  backend: 'cpu' as StatelessStreakletBackend,
  color: '#dc2626',
  strokeWidth: 1.5,
  background: '#ffffff',
  speedColorMode: 'alpha' as StatelessStreakletSpeedColorMode,
  speedGamma: 0.7,
  alphaFloor: 0.05,
  gradientSubdivisions: 1,
  trailAlphaGamma: 1,
};

function resolveBackend(requested: StatelessStreakletBackend): 'cpu' | 'gpu' {
  if (requested !== 'auto') return requested;
  return typeof navigator !== 'undefined' && 'gpu' in navigator ? 'gpu' : 'cpu';
}

function estimateMaxSpeed(
  field: VectorFieldFn,
  domain: StreamlineDomain,
  gridSize = 60,
): number {
  let maxSq = 0;
  for (let i = 0; i <= gridSize; i++) {
    for (let j = 0; j <= gridSize; j++) {
      const x = domain.xMin + (domain.xMax - domain.xMin) * (i / gridSize);
      const y = domain.yMin + (domain.yMax - domain.yMin) * (j / gridSize);
      const [vx, vy] = field(x, y);
      const m2 = vx * vx + vy * vy;
      if (m2 > maxSq) maxSq = m2;
    }
  }
  return Math.sqrt(maxSq);
}

// ============================================================================
// Class
// ============================================================================

export class StatelessStreakletAnimation<TState extends StreakletAnimationState>
  implements AnimationWithData<TState, StatelessStreakletAnimationData> {

  readonly clip: Clip<TState>;
  readonly data: StatelessStreakletAnimationData;

  private readonly opts: Required<StatelessStreakletAnimationOptions>;

  // Particle storage. Structure-of-arrays for compactness and easy ring-buffer
  // arithmetic. For particle i and trail slot s, position is at
  // index = i * trailLength + s.
  private trailX!: Float32Array;
  private trailY!: Float32Array;
  private trailSpeed!: Float32Array; // normalized 0..1 = |v|/maxSpeed at the moment that point was visited
  private headIdx!: Int32Array;      // [numParticles] — index of newest valid slot
  private validCount!: Int32Array;   // [numParticles] — 0..trailLength
  private ages!: Int32Array;         // [numParticles] — frames remaining
  /**
   * Per-particle "dying" countdown. 0 = alive (advecting normally). >0 = dying:
   * we no longer advect, and each frame we both decrement this counter and trim
   * one position off the tail of the ring buffer. When it reaches 0, the
   * particle is fully respawned at a fresh seed point.
   */
  private dyingFrames!: Int32Array;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cssW = 0;
  private cssH = 0;
  private resolvedBackend: 'cpu' | 'gpu' = 'cpu';
  private _initialized = false;

  private constructor(options: StatelessStreakletAnimationOptions) {
    this.opts = { ...DEFAULTS, ...options } as Required<StatelessStreakletAnimationOptions>;
    const maxSpeed = estimateMaxSpeed(this.opts.vectorFieldFn, this.opts.domain);
    this.data = { numParticles: this.opts.numParticles, maxSpeed };

    // Clip is a no-op. Figures compute dt in onTick and pass via state.dt.
    this.clip = {
      name: 'StatelessStreaklet',
      reduce: () => ({}) as Partial<TState>,
    };
  }

  static create<TState extends StreakletAnimationState = StreakletAnimationState>(
    options: StatelessStreakletAnimationOptions,
  ): StatelessStreakletAnimation<TState> {
    return new StatelessStreakletAnimation<TState>(options);
  }

  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Bind to a canvas. On the CPU backend, grabs a 2D context and reads the
   * current transform to infer CSS-pixel dimensions (figure is expected to
   * have applied `ctx.scale(dpr, dpr)` before calling `init`). On the GPU
   * backend, the canvas is left pristine for WebGPU; CSS-pixel dimensions are
   * read from the inline `style.width`/`style.height` if present, otherwise
   * inferred via `getBoundingClientRect`.
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (this._initialized && this.canvas === canvas) return;

    this.canvas = canvas;
    this.resolvedBackend = resolveBackend(this.opts.backend);

    if (this.resolvedBackend === 'cpu') {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('StatelessStreakletAnimation: failed to get 2D context');
      this.ctx = ctx;

      // Infer CSS-pixel dimensions from the current transform.
      const xform = ctx.getTransform();
      this.cssW = canvas.width / (xform.a || 1);
      this.cssH = canvas.height / (xform.d || 1);
    } else {
      // GPU backend: don't grab a context (must stay pristine for WebGPU).
      // Infer CSS-pixel dimensions from the canvas's bounding box.
      const rect = canvas.getBoundingClientRect();
      this.cssW = rect.width > 0 ? rect.width : canvas.width;
      this.cssH = rect.height > 0 ? rect.height : canvas.height;
    }

    const N = this.opts.numParticles;
    const T = this.opts.trailLength;
    this.trailX = new Float32Array(N * T);
    this.trailY = new Float32Array(N * T);
    this.trailSpeed = new Float32Array(N * T);
    this.headIdx = new Int32Array(N);
    this.validCount = new Int32Array(N);
    this.ages = new Int32Array(N);
    this.dyingFrames = new Int32Array(N);

    // Initial paint (CPU only — GPU clears per-frame as part of drawTrajectories).
    if (this.resolvedBackend === 'cpu') {
      this.clearCanvas();
    } else {
      // Pre-warm the GPUTrajectoryRenderer cache so subsequent draw calls
      // dispatch synchronously. Without this, the first call returns before
      // the renderer is ready and nothing gets drawn.
      await drawTrajectories(
        canvas,
        [],
        0,
        {
          strokeWidth: this.opts.strokeWidth,
          color: this.opts.color,
          opacity: 1.0,
          pointRadius: 0,
          showPreview: false,
          showHeadMarker: false,
        },
        { clearCanvas: false },
      );
    }

    for (let i = 0; i < N; i++) {
      this.respawnParticle(i);
    }

    this._initialized = true;
  }

  /**
   * Advance every particle by one Euler step, append the new position to its
   * ring buffer, then redraw all trails from scratch on a cleared canvas.
   */
  draw(state: TState): void {
    if (!this._initialized || !this.ctx) return;
    void state; // dt unused — frame-count timestep, matching StreakletAnimation
    this.advectAllParticles();
    this.renderAllTrails();
  }

  destroy(): void {
    this.canvas = null;
    this.ctx = null;
    this._initialized = false;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private clearCanvas(): void {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.opts.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  /**
   * Pick a fresh starting position for particle `i`, reset its history,
   * and apply seeding bias.
   */
  private respawnParticle(i: number): void {
    const { vectorFieldFn, domain, seedingBias, baseLifetimeFrames } = this.opts;
    const maxV = this.data.maxSpeed;

    let x = 0, y = 0, speedNorm = 0;
    for (let tries = 0; tries < 11; tries++) {
      const a = Math.random();
      const b = Math.random();
      x = a * domain.xMin + (1 - a) * domain.xMax;
      y = b * domain.yMin + (1 - b) * domain.yMax;
      if (maxV <= 0) { speedNorm = 0; break; }
      const [vx, vy] = vectorFieldFn(x, y);
      const m = Math.sqrt(vx * vx + vy * vy) / maxV;
      const force = tries >= 10;
      let accepted = false;
      if (seedingBias === 'uniform') {
        accepted = true;
      } else if (seedingBias === 'speed-balanced') {
        accepted = force || Math.random() > m * 0.9;
      } else if (seedingBias === 'toward-fast') {
        accepted = force || Math.random() < m + 0.1;
      }
      if (accepted) {
        speedNorm = m;
        break;
      }
    }

    const T = this.opts.trailLength;
    // Start the ring buffer empty; the first valid slot will be written by
    // advectAllParticles in this frame. We seed it with the spawn point now
    // so the very first frame already paints from a known location.
    this.headIdx[i] = 0;
    this.validCount[i] = 1;
    this.ages[i] = 1 + Math.floor(Math.random() * baseLifetimeFrames);
    this.dyingFrames[i] = 0; // alive
    this.trailX[i * T + 0] = x;
    this.trailY[i * T + 0] = y;
    this.trailSpeed[i * T + 0] = Math.min(1, speedNorm);
  }

  private inDomain(x: number, y: number): boolean {
    const { xMin, xMax, yMin, yMax } = this.opts.domain;
    return x >= xMin && x < xMax && y >= yMin && y < yMax;
  }

  private advectAllParticles(): void {
    const N = this.opts.numParticles;
    const T = this.opts.trailLength;
    const { vectorFieldFn, speedScale } = this.opts;
    const maxV = this.data.maxSpeed || 1;

    for (let i = 0; i < N; i++) {
      // ---- Dying phase: no advection, just shrink the trail from the tail.
      // The head position stays put (so the trail's leading edge sits at the
      // particle's last live position), while older points peel off one per
      // frame. When validCount hits 0, the trail has fully retreated and we
      // respawn.
      if (this.dyingFrames[i] > 0) {
        this.dyingFrames[i]--;
        if (this.validCount[i] > 0) {
          this.validCount[i]--;
        }
        if (this.dyingFrames[i] <= 0 || this.validCount[i] <= 0) {
          this.respawnParticle(i);
        }
        continue;
      }

      // ---- Alive phase: normal Euler advection.
      const headSlot = this.headIdx[i];
      const idx = i * T + headSlot;
      const px = this.trailX[idx];
      const py = this.trailY[idx];

      this.ages[i]--;

      const [vx, vy] = vectorFieldFn(px, py);
      const nx = px + speedScale * vx;
      const ny = py + speedScale * vy;
      const speedNorm = Math.min(1, Math.sqrt(vx * vx + vy * vy) / maxV);

      // End-of-life check: instead of respawning immediately, kick off the
      // dying phase so the existing trail can retreat gracefully.
      if (this.ages[i] <= 0 || !this.inDomain(nx, ny)) {
        this.dyingFrames[i] = this.validCount[i];
        continue;
      }

      // Write new head.
      const newHead = (headSlot + 1) % T;
      const newIdx = i * T + newHead;
      this.trailX[newIdx] = nx;
      this.trailY[newIdx] = ny;
      this.trailSpeed[newIdx] = speedNorm;
      this.headIdx[i] = newHead;
      this.validCount[i] = Math.min(T, this.validCount[i] + 1);
    }
  }

  private renderAllTrails(): void {
    if (!this.canvas) return;
    // On the CPU backend we explicitly clear; on the GPU backend the
    // trajectory renderer's clearCanvas option does it for us.
    if (this.resolvedBackend === 'cpu') {
      if (!this.ctx) return;
      this.clearCanvas();
    }

    const N = this.opts.numParticles;
    const T = this.opts.trailLength;
    const {
      toPixel,
      color,
      strokeWidth,
      speedColorMode,
      speedGamma,
      alphaFloor,
      gradientSubdivisions,
      trailAlphaGamma,
    } = this.opts;

    // Build the trajectories + perSegmentAlphas arrays.
    // trajectories[i] is the list of pixel-space points for particle i's trail,
    // ordered oldest → newest.
    const trajectories: number[][][] = [];
    const perSegmentAlphas: number[][] = [];

    for (let i = 0; i < N; i++) {
      const count = this.validCount[i];
      if (count < 2) continue; // need at least 2 points to form a segment

      const head = this.headIdx[i];
      const oldest = (head - (count - 1) + T) % T;

      // Walk count points starting from `oldest`.
      const points: number[][] = new Array(count);
      const alphas: number[] = new Array(count);
      for (let s = 0; s < count; s++) {
        const slot = (oldest + s) % T;
        const ringIdx = i * T + slot;
        const px = this.trailX[ringIdx];
        const py = this.trailY[ringIdx];
        const sp = this.trailSpeed[ringIdx];
        const xy = toPixel([px, py]);
        points[s] = [xy[0], xy[1]];

        // Position in trail: 0 (tail) .. 1 (head). trailAlphaGamma shapes
        // the brightness profile along the trail (1 = linear, >1 head-loaded,
        // <1 tail-loaded).
        const tailToHead = s / (count - 1);
        const trailFade = trailAlphaGamma === 1
          ? tailToHead
          : Math.pow(tailToHead, trailAlphaGamma);

        let alpha = 1;
        if (speedColorMode === 'alpha') {
          const speedFactor = alphaFloor + (1 - alphaFloor) * Math.pow(sp, speedGamma);
          alpha = trailFade * speedFactor;
        } else if (speedColorMode === 'ramp') {
          alpha = trailFade; // brightness encoded in stroke color elsewhere; alpha is fade only
        } else {
          alpha = trailFade;
        }
        alphas[s] = alpha;
      }

      trajectories.push(points);
      perSegmentAlphas.push(alphas);
    }

    // CPU path: drawTrajectories with a 2D context goes through the
    // synchronous CPU codepath even though the function signature is async.
    //
    // GPU path: pass the canvas element directly. The trajectory renderer
    // caches a GPUTrajectoryRenderer per canvas; on first call it creates the
    // pipeline, on subsequent calls it reuses. clearCanvas defaults to true,
    // clearing to transparent — the visible background comes from the CSS
    // `background-color` on the canvas element.
    //
    // segmentIndex: the GPU data preparation clips trajectories to
    // `segmentIndex + 1` points, while the CPU path with perSegmentAlphas
    // ignores it. Pass trailLength so all segments make it through on GPU.
    const target: CanvasRenderingContext2D | HTMLCanvasElement =
      this.resolvedBackend === 'gpu' ? this.canvas! : this.ctx!;
    const segmentIndex = this.opts.trailLength;

    void drawTrajectories(target, trajectories, segmentIndex, {
      strokeWidth,
      color,
      opacity: 1.0,
      pointRadius: 0,
      showPreview: false,
      showHeadMarker: false,
      perSegmentAlphas,
      gradientSubdivisions,
    });
  }
}
