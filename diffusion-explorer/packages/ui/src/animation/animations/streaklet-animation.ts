/**
 * StreakletAnimation - Live particle-advection visualization in the "wind map"
 * style (Viégas & Wattenberg, 2012).
 *
 * Unlike StreamlineAnimation / PathlineAnimation, no path data is precomputed.
 * The animation maintains a population of `Particle`s that are advected by the
 * vector field each frame; the visible "streamlines" emerge from short fading
 * trails left on the canvas by each particle. The trail fade is implemented by
 * painting a low-alpha background rectangle over the whole canvas each frame
 * before drawing one new segment per particle.
 *
 * IMPORTANT: `draw(state)` is not a pure function of `state` — the canvas
 * contents from prior frames are part of the visible image, and the particle
 * positions advance every time it is called. Calling `draw` multiple times for
 * the same state will advect particles multiple times. This is inherent to the
 * technique.
 *
 * Lifecycle matches StreamlineAnimation / PathlineAnimation:
 *   1. Create with StreakletAnimation.create()
 *   2. await anim.init(canvas)
 *   3. anim.draw(state) on each tick
 *   4. anim.destroy() on cleanup
 *
 * Timeline integration: the `clip` is a no-op. Compute `dt` in your `onTick`
 * callback (e.g. via performance.now()) and pass it via `state.dt`.
 *
 * @example
 * const anim = StreakletAnimation.create({
 *   vectorFieldFn,
 *   domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *   toPixel,
 *   numParticles: 5000,
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

// ============================================================================
// Types
// ============================================================================

/**
 * Base animation state for streaklet animation. Carries the real-time delta
 * since the last draw, computed by the figure's onTick callback.
 *
 * Users may extend this for their own animation state:
 *   type MyState = StreakletAnimationState & { highlightIndex: number };
 */
export type StreakletAnimationState = {
  /** Seconds elapsed since the previous draw call. */
  dt: number;
};

/**
 * Data exposed by StreakletAnimation for figures that want to inspect it.
 */
export type StreakletAnimationData = {
  /** Current number of active particles. */
  numParticles: number;
  /** Estimated max |v| over the domain (sampled once at init). */
  maxSpeed: number;
};

/**
 * Seeding strategy for new / respawned particles.
 *
 * - `'uniform'`     — pure uniform random in domain.
 * - `'speed-balanced'` — wind-map style: reject high-speed seeds (with prob ~m)
 *                       so visual particle density is uniform despite uneven
 *                       flow rates. Slow regions get more seeds because their
 *                       particles barely move.
 * - `'toward-fast'`    — bias seeds *toward* fast regions, emphasizing the
 *                       interesting structure of the field.
 */
export type StreakletSeedingBias = 'uniform' | 'speed-balanced' | 'toward-fast';

/**
 * How per-segment color/alpha relates to local velocity magnitude.
 *
 * - `'none'`  — every segment is drawn with the same uniform color/opacity.
 * - `'alpha'` — segment alpha = (|v|/maxV)^gamma; fast regions are brighter.
 * - `'ramp'`  — segment color is sampled from a perceptual gray ramp indexed
 *               by (|v|/maxV)^gamma.
 */
export type StreakletSpeedColorMode = 'none' | 'alpha' | 'ramp';

/**
 * Options for creating a StreakletAnimation.
 */
export interface StreakletAnimationOptions {
  // --- Required ---
  vectorFieldFn: VectorFieldFn;
  domain: StreamlineDomain;
  toPixel: (p: [number, number]) => [number, number];

  // --- Particle population ---
  /** Number of active particles. Default: 5000. */
  numParticles?: number;
  /** Max particle lifetime in frames; actual age is uniform in [1, baseLifetimeFrames]. Default: 40. */
  baseLifetimeFrames?: number;
  /** Per-frame Euler step multiplier in domain units. Default: 0.01. */
  speedScale?: number;

  // --- Seeding ---
  seedingBias?: StreakletSeedingBias;

  // --- Rendering ---
  /** Base segment color (CSS string). Default: '#dc2626'. */
  color?: string;
  /** Line width in CSS pixels. Default: 0.75. */
  strokeWidth?: number;
  /** Per-frame background-paint alpha. Higher = trails fade faster. Default: 0.02. */
  fadeAlpha?: number;
  /** Background color of the fade fill. Default: 'rgb(255,255,255)' (white). */
  background?: string;
  /** How local speed maps to per-segment color/alpha. Default: 'alpha'. */
  speedColorMode?: StreakletSpeedColorMode;
  /** Gamma applied to (|v|/maxV) before color/alpha mapping. Default: 0.7. */
  speedGamma?: number;
  /** Lower clamp on per-segment alpha in 'alpha' mode, so slow regions don't disappear. Default: 0.05. */
  alphaFloor?: number;
  /**
   * Every N frames, scan the canvas and snap pixels close to `background` back
   * to exact background. Compensates for 8-bit alpha-blend rounding which would
   * otherwise leave a residual color plateau (e.g. gray haze on white). Set to
   * 0 to disable. Default: 30.
   */
  snapToBackgroundInterval?: number;
  /**
   * Per-channel max distance from background for the snap to fire. Higher values
   * snap more aggressively; too high will erase faint trail tails. Default: 28.
   */
  snapToBackgroundEpsilon?: number;
}

// ============================================================================
// Internals
// ============================================================================

interface Particle {
  /** Position in domain coordinates. */
  x: number;
  y: number;
  /** Previous pixel position (-1 if just respawned). */
  oldX: number;
  oldY: number;
  /** Frames remaining before respawn. */
  age: number;
}

const DEFAULTS = {
  numParticles: 5000,
  baseLifetimeFrames: 40,
  speedScale: 0.01,
  seedingBias: 'speed-balanced' as StreakletSeedingBias,
  color: '#dc2626',
  strokeWidth: 0.75,
  fadeAlpha: 0.02,
  background: 'rgb(255,255,255)',
  speedColorMode: 'alpha' as StreakletSpeedColorMode,
  speedGamma: 0.7,
  alphaFloor: 0.05,
  snapToBackgroundInterval: 30,
  snapToBackgroundEpsilon: 28,
};

function parseRgbBackground(str: string): [number, number, number] {
  // Accept 'rgb(r,g,b)' or '#rrggbb'.
  const rgb = /^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(str);
  if (rgb) return [parseInt(rgb[1], 10), parseInt(rgb[2], 10), parseInt(rgb[3], 10)];
  const hex = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(str);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
  return [255, 255, 255];
}

function parseHexColor(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  return [220, 38, 38];
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

export class StreakletAnimation<TState extends StreakletAnimationState>
  implements AnimationWithData<TState, StreakletAnimationData> {

  readonly clip: Clip<TState>;
  readonly data: StreakletAnimationData;

  private readonly opts: Required<StreakletAnimationOptions>;
  private readonly baseColor: [number, number, number];
  private readonly bgRGB: [number, number, number];

  // Init/draw state
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private particles: Particle[] = [];
  private _initialized = false;
  private snapFrameCounter = 0;

  private constructor(options: StreakletAnimationOptions) {
    this.opts = {
      ...DEFAULTS,
      ...options,
    } as Required<StreakletAnimationOptions>;

    const maxSpeed = estimateMaxSpeed(this.opts.vectorFieldFn, this.opts.domain);
    this.data = { numParticles: this.opts.numParticles, maxSpeed };
    this.baseColor = parseHexColor(this.opts.color);
    this.bgRGB = parseRgbBackground(this.opts.background);

    // Clip is intentionally a no-op: figure code computes dt itself in onTick
    // and passes it via state.dt. We return an empty partial state so existing
    // state fields on TState (if any) are not clobbered.
    this.clip = {
      name: 'Streaklet',
      reduce: () => ({}) as Partial<TState>,
    };
  }

  static create<TState extends StreakletAnimationState = StreakletAnimationState>(
    options: StreakletAnimationOptions,
  ): StreakletAnimation<TState> {
    return new StreakletAnimation<TState>(options);
  }

  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Bind to a canvas. The canvas's backing buffer size is used as-is — set
   * `canvas.width` / `canvas.height` to your physical (DPR-scaled) dimensions
   * before calling and call `ctx.scale(dpr, dpr)` via your own setup if you
   * want CSS-pixel coordinates. (Or just use the helper in the figure.)
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (this._initialized && this.canvas === canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('StreakletAnimation: failed to get 2D context');

    this.canvas = canvas;
    this.ctx = ctx;

    // Initial paint: solid background so the first fade-fill doesn't reveal
    // any previous canvas content.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.opts.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Seed the particle population.
    this.particles = new Array(this.opts.numParticles);
    for (let i = 0; i < this.opts.numParticles; i++) {
      this.particles[i] = this.makeParticle();
    }

    this._initialized = true;
  }

  /**
   * Advance particles by one frame and paint one segment per particle.
   *
   * `state.dt` is accepted but currently unused — v1 uses frame-count speed
   * (matching the wind-map reference). Switching to dt-based speed is a small
   * change inside this method.
   */
  draw(state: TState): void {
    if (!this._initialized || !this.ctx) return;
    void state; // dt currently unused; see note above
    this.tickAndPaint();
  }

  destroy(): void {
    this.particles = [];
    this.canvas = null;
    this.ctx = null;
    this._initialized = false;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private makeParticle(): Particle {
    const { vectorFieldFn, domain, seedingBias, baseLifetimeFrames } = this.opts;
    const maxV = this.data.maxSpeed;

    let x = 0, y = 0;
    let accepted = false;
    for (let tries = 0; tries < 11; tries++) {
      const a = Math.random();
      const b = Math.random();
      x = a * domain.xMin + (1 - a) * domain.xMax;
      y = b * domain.yMin + (1 - b) * domain.yMax;
      if (maxV <= 0) { accepted = true; break; }
      const [vx, vy] = vectorFieldFn(x, y);
      const m = Math.sqrt(vx * vx + vy * vy) / maxV;
      const force = tries >= 10; // after 10 rejections, just accept
      if (seedingBias === 'uniform') {
        accepted = true;
      } else if (seedingBias === 'speed-balanced') {
        // Wind-map heuristic: reject more often in fast regions.
        accepted = force || Math.random() > m * 0.9;
      } else if (seedingBias === 'toward-fast') {
        accepted = force || Math.random() < m + 0.1;
      }
      if (accepted) break;
    }

    return {
      x,
      y,
      oldX: -1,
      oldY: -1,
      age: 1 + Math.floor(Math.random() * this.opts.baseLifetimeFrames),
    };
  }

  private inDomain(x: number, y: number): boolean {
    const { xMin, xMax, yMin, yMax } = this.opts.domain;
    return x >= xMin && x < xMax && y >= yMin && y < yMax;
  }

  private tickAndPaint(): void {
    const ctx = this.ctx!;
    const {
      vectorFieldFn,
      toPixel,
      speedScale,
      color,
      strokeWidth,
      fadeAlpha,
      background,
      speedColorMode,
      speedGamma,
      alphaFloor,
    } = this.opts;
    const maxV = this.data.maxSpeed;

    // 1) Fade the previous frame by painting the background at low alpha.
    //    Using the canvas's physical-pixel space (we set the transform to
    //    identity for this op) so we cover the whole buffer regardless of
    //    DPR scaling applied to ctx.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = fadeAlpha;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.canvas!.width, this.canvas!.height);
    ctx.restore();

    // 2) Advect particles and paint a segment per particle.
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';

    const useAlpha = speedColorMode === 'alpha';
    const useRamp = speedColorMode === 'ramp';

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      // Respawn if dead or out of bounds.
      if (p.age <= 0 || !this.inDomain(p.x, p.y)) {
        this.particles[i] = this.makeParticle();
        continue;
      }

      const [vx, vy] = vectorFieldFn(p.x, p.y);
      p.x += speedScale * vx;
      p.y += speedScale * vy;
      p.age--;

      // Project to CSS pixel coords (ctx is already DPR-scaled by the figure).
      const [px, py] = toPixel([p.x, p.y]);

      // Skip drawing if we don't have a previous pixel (just spawned), but
      // remember this position so the next frame has something to draw from.
      if (p.oldX !== -1) {
        // Speed-keyed appearance.
        const m = maxV > 0 ? Math.min(1, Math.sqrt(vx * vx + vy * vy) / maxV) : 1;
        const s = Math.pow(m, speedGamma);

        if (useAlpha) {
          ctx.globalAlpha = alphaFloor + (1 - alphaFloor) * s;
          ctx.strokeStyle = color;
        } else if (useRamp) {
          // Map speed to a gray ramp: dark for slow, bright for fast.
          // 90..255 covers the perceptual sweet spot used by the wind map.
          const c = Math.max(0, Math.min(255, Math.round(90 + 165 * s)));
          ctx.globalAlpha = 1;
          ctx.strokeStyle = `rgb(${c},${c},${c})`;
        } else {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = color;
        }

        ctx.beginPath();
        ctx.moveTo(p.oldX, p.oldY);
        ctx.lineTo(px, py);
        ctx.stroke();
      }

      p.oldX = px;
      p.oldY = py;
    }

    ctx.globalAlpha = 1;

    // Periodic snap pass: forces near-background pixels to exact background,
    // compensating for the 8-bit alpha-blend rounding plateau.
    if (this.opts.snapToBackgroundInterval > 0) {
      this.snapFrameCounter++;
      if (this.snapFrameCounter >= this.opts.snapToBackgroundInterval) {
        this.snapFrameCounter = 0;
        this.snapToBackground();
      }
    }
  }

  private snapToBackground(): void {
    const ctx = this.ctx!;
    const canvas = this.canvas!;
    const [bgR, bgG, bgB] = this.bgRGB;
    const eps = this.opts.snapToBackgroundEpsilon;
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;

    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    const totalPixels = data.length / 4;

    // Diagnostics: classify each pixel.
    let snapped = 0;             // within eps on all channels — got forced to background
    let nearMissTint = 0;        // close but with one channel >eps — likely tinted residue
    let identicalAlready = 0;    // exactly equal to background already
    let strongColor = 0;         // every channel deviates >eps from background

    // Track the max deviation seen on each channel among NON-snapped, NON-strong
    // pixels — useful for tuning eps and for confirming the rounding plateau.
    let maxNearR = 0, maxNearG = 0, maxNearB = 0;
    // Sample one representative "tinted residue" pixel for inspection.
    let sampleR = -1, sampleG = -1, sampleB = -1;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const dr = r - bgR;
      const dg = g - bgG;
      const db = b - bgB;
      const ar = dr < 0 ? -dr : dr;
      const ag = dg < 0 ? -dg : dg;
      const ab = db < 0 ? -db : db;

      const allWithin = ar <= eps && ag <= eps && ab <= eps;
      if (allWithin) {
        if (ar === 0 && ag === 0 && ab === 0) {
          identicalAlready++;
        } else {
          snapped++;
          data[i]     = bgR;
          data[i + 1] = bgG;
          data[i + 2] = bgB;
        }
        continue;
      }

      const allOutside = ar > eps && ag > eps && ab > eps;
      if (allOutside) {
        strongColor++;
      } else {
        nearMissTint++;
        if (ar > maxNearR) maxNearR = ar;
        if (ag > maxNearG) maxNearG = ag;
        if (ab > maxNearB) maxNearB = ab;
        if (sampleR === -1) { sampleR = r; sampleG = g; sampleB = b; }
      }
    }

    ctx.putImageData(img, 0, 0);

    // eslint-disable-next-line no-console
    console.log(
      `[Streaklet snap] total=${totalPixels} | snapped=${snapped} ` +
      `(forced to bg) | identical=${identicalAlready} (already bg) | ` +
      `nearMissTint=${nearMissTint} (within eps on some chans, not all) | ` +
      `strongColor=${strongColor} (fresh trails) | ` +
      `maxNearMissDev=[${maxNearR},${maxNearG},${maxNearB}] | ` +
      `sampleTint=${sampleR === -1 ? 'none' : `(${sampleR},${sampleG},${sampleB})`}`,
    );
  }
}
