/**
 * Animation System
 * ================
 *
 * A composable animation system built around Timeline, Clip, and Layer abstractions.
 * Clips are reducer functions that return partial state updates, enabling conflict
 * resolution through a priority-based layer system.
 *
 *
 * ## Architecture Overview
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │                        Timeline                             │
 * │              (single source of truth)                       │
 * │                                                             │
 * │   ┌─────────┐                                               │
 * │   │  Clock  │ (internal - owns RAF loop)                    │
 * │   └────┬────┘                                               │
 * │        │ dt                                                 │
 * │        ▼                                                    │
 * │   time: 0 ──────────────────────────────────────────► 1    │
 * │                                                             │
 * │   Layer 0 (BASE):        │ Clip A      │ Clip B      │     │
 * │   Layer 10 (INTERACTION):     │ Ephemeral │            │     │
 * │                                                             │
 * │   Higher layers override lower for conflicting state keys   │
 * │                                                             │
 * │   Methods: play() | pause() | seek(t) | reset()             │
 * └─────────────────────────────────────────────────────────────┘
 *         ▲                           │
 *         │ seek()                    │ onTick(time, state)
 *         │ play/pause                │
 *         │                           ▼
 * ┌───────────────┐           ┌───────────────┐
 * │  TimeSlider   │           │    Figure     │
 * │               │           │               │
 * │ timeline.seek()│          │ draw(state)   │
 * │ timeline.play()│          │               │
 * └───────────────┘           └───────────────┘
 * ```
 *
 *
 * ## Core Concepts
 *
 * ### Clip (Reducer Pattern)
 * Clips are functions that take time and current state, returning partial state updates.
 * They close over any external values they need (no params argument).
 *
 * ```typescript
 * const fadeClip: Clip<State> = {
 *   name: 'fade',
 *   duration: 0.5,  // 50% of timeline duration
 *   reduce(t, current) {
 *     return { opacity: t };  // Partial state update
 *   }
 * };
 * ```
 *
 * ### Layer Priority
 * Higher layer numbers take precedence for conflicting state keys.
 * Use built-in constants or any number:
 *
 * ```typescript
 * Layer.BASE = 0         // Default animations
 * Layer.INTERACTION = 10 // Hover effects, temporary states
 * Layer.OVERRIDE = 20    // User-triggered animations
 * ```
 *
 * ### Ephemeral Clips
 * One-shot clips that auto-remove after playing once. Perfect for click animations.
 *
 * ```typescript
 * timeline.playClip({
 *   name: 'flash',
 *   duration: 0.3,
 *   reduce(t) { return { flash: 1 - t }; }
 * });
 * ```
 *
 * ### Instant Clips (duration=0)
 * For immediate state changes that should appear on the timeline for debugging.
 *
 * ```typescript
 * timeline.setState('click', { clicked: true });
 * ```
 *
 *
 * ## TimeSlider Integration
 *
 * ```svelte
 * <script>
 *   let time = 0;
 *   let isPlaying = false;
 *
 *   timeline.onTick((t, state) => {
 *     time = t;
 *     draw(state);
 *   });
 * </script>
 *
 * <TimeSlider bind:value={time} bind:isPlaying timeline={timeline} />
 * ```
 *
 * For multiple independent sliders (like CrownJewel), make slider values
 * part of state and control them via clips.
 *
 *
 * ## Usage Examples
 *
 * ### Basic Animation
 * ```typescript
 * const numSegments = 10;
 *
 * const timeline = new Timeline<{ segmentIndex: number }>();
 * timeline.initialState = { segmentIndex: 0 };
 *
 * timeline.add({
 *   name: 'segments',
 *   duration: 0.8,
 *   reduce(t) {
 *     return { segmentIndex: Math.floor(t * numSegments) };
 *   }
 * }, 0);
 *
 * timeline.onTick((time, state) => draw(state));
 * timeline.play();
 * ```
 *
 * ### Hover Override
 * ```typescript
 * let hoverId: string | null = null;
 *
 * function onMouseEnter(id: string) {
 *   hoverId = timeline.add({
 *     name: 'hover',
 *     duration: 1,
 *     reduce() { return { hoveredId: id, hoverOpacity: 1 }; }
 *   }, 'now', { layer: Layer.INTERACTION });
 * }
 *
 * function onMouseLeave() {
 *   if (hoverId) timeline.remove(hoverId);
 * }
 * ```
 */

// ===== Layer Constants =====
export const Layer = {
  BASE: 0,
  INTERACTION: 10,
  OVERRIDE: 20,
} as const;

// ===== Clip =====
// A clip maps local time (0..1) to partial state updates (reducer pattern)
export type Clip<TState> = {
  name: string;
  duration: number; // normalized 0..1, or 0 for instant clips
  reduce(t: number, current: Readonly<TState>): Partial<TState> | null;
};

// ===== Clip Options =====
export type ClipOptions = {
  layer?: number;      // Default: 0. Higher = higher priority
  ephemeral?: boolean; // Default: false. Auto-remove after one play
  id?: string;         // For removal. Auto-generated if not provided
};

// ===== Internal Types =====
type ScheduledClip<TState> = {
  clip: Clip<TState>;
  start: number; // normalized start time on timeline
  options: Required<ClipOptions>;
  playCount: number; // for ephemeral clips
};

// ===== Timeline =====
export class Timeline<TState> {
  // Configuration
  duration = 1;
  looping = false;
  endPauseDuration = 0; // Seconds to pause at end before looping

  // Initial state (required before play)
  private _initialState: TState | null = null;

  get initialState(): TState {
    if (this._initialState === null) {
      throw new Error('Timeline.initialState must be set before use');
    }
    return this._initialState;
  }

  set initialState(value: TState) {
    this._initialState = value;
    this._cachedState = null; // Invalidate cache
  }

  // Read-only time state
  private _time = 0;
  get time(): number {
    return this._time;
  }

  private _isPlaying = false;
  get isPlaying(): boolean {
    return this._isPlaying;
  }

  // Computed state (cached, recomputed on tick/seek)
  private _cachedState: TState | null = null;
  get state(): Readonly<TState> {
    if (this._cachedState === null) {
      this._cachedState = this.computeState();
    }
    return this._cachedState;
  }

  // Clips
  private clips: ScheduledClip<TState>[] = [];
  private nextClipId = 0;

  // Internal
  private clock = new Clock();
  private tickCallback: ((time: number, state: Readonly<TState>) => void) | null = null;
  private endPauseRemaining = 0;

  // ===== Clip Management =====

  /**
   * Add a clip to the timeline.
   * @param clip - The clip to add
   * @param start - Start time (normalized 0-1), or 'now' for current time
   * @param options - Layer, ephemeral flag, and optional ID
   * @returns Clip ID for later removal
   */
  add(clip: Clip<TState>, start: number | 'now' = 0, options: ClipOptions = {}): string {
    const normalizedStart = start === 'now' ? this._time / this.duration : start;
    const id = options.id ?? `clip-${this.nextClipId++}`;

    this.clips.push({
      clip,
      start: normalizedStart,
      options: {
        layer: options.layer ?? 0,
        ephemeral: options.ephemeral ?? false,
        id,
      },
      playCount: 0,
    });

    this._cachedState = null; // Invalidate cache
    return id;
  }

  /**
   * Remove a clip by ID.
   * @returns true if clip was found and removed
   */
  remove(clipId: string): boolean {
    const index = this.clips.findIndex(s => s.options.id === clipId);
    if (index !== -1) {
      this.clips.splice(index, 1);
      this._cachedState = null;
      return true;
    }
    return false;
  }

  /**
   * Remove all clips on a specific layer.
   */
  clearLayer(layer: number): void {
    this.clips = this.clips.filter(s => s.options.layer !== layer);
    this._cachedState = null;
  }

  /**
   * Remove all ephemeral clips.
   */
  clearEphemeral(): void {
    this.clips = this.clips.filter(s => !s.options.ephemeral);
    this._cachedState = null;
  }

  // ===== Convenience Methods =====

  /**
   * Add an instant state change at the current time.
   * Creates a duration=0 clip that applies the update immediately.
   */
  setState(name: string, update: Partial<TState>, options: ClipOptions = {}): string {
    return this.add({
      name,
      duration: 0,
      reduce: () => update,
    }, 'now', options);
  }

  /**
   * Play an ephemeral clip at the current time.
   * The clip will auto-remove after one complete play.
   */
  playClip(
    clip: Clip<TState>,
    options: Omit<ClipOptions, 'ephemeral'> = {}
  ): string {
    return this.add(clip, 'now', { ...options, ephemeral: true });
  }

  // ===== Playback Control =====

  play(): void {
    if (this._isPlaying) return;
    this._isPlaying = true;
    this.clock.start((dt) => this.tick(dt));
  }

  pause(): void {
    if (!this._isPlaying) return;
    this._isPlaying = false;
    this.clock.stop();
  }

  /**
   * Seek to a specific time.
   * @param normalizedT - Time in range [0, 1]
   */
  seek(normalizedT: number): void {
    this._time = Math.max(0, Math.min(normalizedT * this.duration, this.duration));
    this.endPauseRemaining = 0;
    this._cachedState = null;
    this.tickCallback?.(this._time, this.state);
  }

  reset(): void {
    this._time = 0;
    this.endPauseRemaining = 0;
    this._cachedState = null;
  }

  // ===== Events =====

  /**
   * Register tick callback (for figure to redraw).
   * @returns Unsubscribe function
   */
  onTick(callback: (time: number, state: Readonly<TState>) => void): () => void {
    this.tickCallback = callback;
    return () => {
      this.tickCallback = null;
    };
  }

  get isAtEnd(): boolean {
    return this._time >= this.duration;
  }

  // ===== Internal =====

  private tick(dt: number): void {
    // If in end pause state, count down
    if (this.endPauseRemaining > 0) {
      this.endPauseRemaining -= dt;
      if (this.endPauseRemaining <= 0 && this.looping) {
        this._time = 0;
        this._cachedState = null;
      }
      this.tickCallback?.(this._time, this.state);
      return;
    }

    this._time = Math.min(this._time + dt, this.duration);
    this._cachedState = null; // Invalidate cache for recomputation

    if (this.isAtEnd) {
      if (this.endPauseDuration > 0 && this.looping) {
        this.endPauseRemaining = this.endPauseDuration;
      } else if (this.looping) {
        this._time = 0;
        // Cleanup ephemeral clips at loop boundary
        this.cleanupEphemeralClips();
      } else {
        this.pause();
      }
    }

    this.tickCallback?.(this._time, this.state);
  }

  private computeState(): TState {
    const initial = this.initialState;
    let result = { ...initial };

    // Group active clips by layer
    const clipsByLayer = new Map<number, ScheduledClip<TState>[]>();

    for (const scheduled of this.clips) {
      const { clip, start, options } = scheduled;
      const end = start + clip.duration;

      // Check if clip is active at current time
      // For duration=0 (instant) clips, they're active only at their start time
      const normalizedTime = this._time / this.duration;
      const isActive = clip.duration === 0
        ? Math.abs(normalizedTime - start) < 0.0001 // Instant clip at start time
        : normalizedTime >= start && normalizedTime <= end;

      if (!isActive) continue;

      // Compute local time within clip (0 to 1)
      const localT = clip.duration === 0
        ? 1 // Instant clips get t=1
        : Math.min(1, Math.max(0, (normalizedTime - start) / clip.duration));

      // Track ephemeral completion
      if (localT >= 1 && options.ephemeral) {
        scheduled.playCount++;
      }

      // Group by layer
      if (!clipsByLayer.has(options.layer)) {
        clipsByLayer.set(options.layer, []);
      }
      clipsByLayer.get(options.layer)!.push(scheduled);
    }

    // Process layers in order (lowest to highest priority)
    const sortedLayers = Array.from(clipsByLayer.keys()).sort((a, b) => a - b);

    for (const layer of sortedLayers) {
      const layerClips = clipsByLayer.get(layer)!;
      let layerUpdate: Partial<TState> = {};

      // Compute updates from all clips in this layer (last-wins for same keys)
      for (const scheduled of layerClips) {
        const { clip, start } = scheduled;
        const normalizedTime = this._time / this.duration;
        const localT = clip.duration === 0
          ? 1
          : Math.min(1, Math.max(0, (normalizedTime - start) / clip.duration));

        const update = clip.reduce(localT, result);
        if (update !== null) {
          layerUpdate = { ...layerUpdate, ...update };
        }
      }

      // Apply layer update to result
      result = { ...result, ...layerUpdate };
    }

    return result;
  }

  private cleanupEphemeralClips(): void {
    this.clips = this.clips.filter(s => !s.options.ephemeral || s.playCount === 0);
  }
}

// ===== Clock =====
// Clock owns the requestAnimationFrame loop and provides delta time
export class Clock {
  private rafId: number | null = null;
  private lastTime: number | null = null;

  start(onTick: (dt: number) => void): void {
    const loop = (ts: number) => {
      if (this.lastTime === null) this.lastTime = ts;
      const dt = (ts - this.lastTime) / 1000; // Convert to seconds
      this.lastTime = ts;

      onTick(dt);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastTime = null;
  }

  get isRunning(): boolean {
    return this.rafId !== null;
  }
}

// ===== Pause Clip =====
// A clip that does nothing - just lets time pass
export function createPauseClip<TState>(duration: number): Clip<TState> {
  return {
    name: "Pause",
    duration,
    reduce: () => null, // No state changes
  };
}
