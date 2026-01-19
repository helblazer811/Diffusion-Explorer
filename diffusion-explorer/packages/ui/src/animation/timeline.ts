// ===== Layer Constants =====
export const Layer = {
  BASE: 0,
  INTERACTION: 10,
  OVERRIDE: 20,
} as const;

// ===== Clip =====
// A clip maps local time (0..1) to partial state updates (reducer pattern)
// Clips are timing-agnostic - they define behavior, not when they play.
// Timing is provided when adding to a timeline via { start, end }.
export type Clip<TState> = {
  name: string;
  reduce(t: number, current: Readonly<TState>): Partial<TState> | null;
};

// Timing info for scheduling a clip
export type ClipTiming = {
  start: number; // normalized 0..1
  end: number;   // normalized 0..1 (use start === end for instant clips)
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
  end: number;   // normalized end time on timeline
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

  private _isSeeking = false;
  get isSeeking(): boolean {
    return this._isSeeking;
  }

  // Computed state (cached, recomputed on tick/seek)
  private _cachedState: TState | null = null;
  get state(): Readonly<TState> {
    if (this._cachedState === null) {
      this._cachedState = this.resolveState();
    }
    return this._cachedState;
  }

  // Clips
  private clips: ScheduledClip<TState>[] = [];
  private nextClipId = 0;

  // Internal
  private clock = new Clock();
  private tickCallbacks: Set<(normalizedTime: number, state: Readonly<TState>) => void> = new Set();
  private endPauseRemaining = 0;

  // ===== Clip Management =====

  /**
   * Add a clip to the timeline.
   * @param clip - The clip to add (timing-agnostic behavior)
   * @param timing - When the clip plays: { start, end } in normalized 0-1 time
   * @param options - Layer, ephemeral flag, and optional ID
   * @returns Clip ID for later removal
   */
  add(clip: Clip<TState>, timing: ClipTiming, options: ClipOptions = {}): string {
    const id = options.id ?? `clip-${this.nextClipId++}`;

    this.clips.push({
      clip,
      start: timing.start,
      end: timing.end,
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

  // ===== Convenience Methods =====

  /**
   * Add an instant state change at the current time.
   * Creates a start===end clip that applies the update immediately.
   */
  setState(name: string, update: Partial<TState>, options: ClipOptions = {}): string {
    const currentT = this._time / this.duration;
    return this.add(
      { name, reduce: () => update },
      { start: currentT, end: currentT },
      options
    );
  }

  /**
   * Play an ephemeral clip at the current time.
   * The clip will auto-remove after one complete play.
   * @param clip - The clip behavior to play
   * @param duration - How long the clip should play (normalized 0-1)
   */
  playClip(
    clip: Clip<TState>,
    duration: number,
    options: Omit<ClipOptions, 'ephemeral'> = {}
  ): string {
    const currentT = this._time / this.duration;
    return this.add(clip, { start: currentT, end: currentT + duration }, { ...options, ephemeral: true });
  }

  /**
   * Set a pause duration at the end of the timeline before looping.
   * During the pause, the timeline stays at t=1.0 and state is preserved.
   * @param durationSeconds - How long to pause at the end (in seconds)
   */
  setEndPause(durationSeconds: number): void {
    this.endPauseDuration = durationSeconds;
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
   * Start seeking (temporarily pauses time progression).
   * Called when user starts dragging the time slider.
   */
  startSeeking(): void {
    this._isSeeking = true;
  }

  /**
   * End seeking (resumes time progression if playing).
   * Called when user stops dragging the time slider.
   */
  endSeeking(): void {
    this._isSeeking = false;
  }

  /**
   * Seek to a specific time.
   * @param normalizedT - Time in range [0, 1]
   */
  seek(normalizedT: number): void {
    this._time = Math.max(0, Math.min(normalizedT * this.duration, this.duration));
    this.endPauseRemaining = 0;
    this._cachedState = null;
    this.tickCallbacks.forEach(cb => cb(this._time / this.duration, this.state));
  }

  reset(): void {
    this._time = 0;
    this.endPauseRemaining = 0;
    this._cachedState = null;
  }

  /**
   * Fully dispose of the timeline, stopping playback and clearing all state.
   * Call this before creating a new Timeline instance to prevent memory leaks.
   */
  dispose(): void {
    this.pause();
    this.tickCallbacks.clear();
    this.clips = [];
    this._cachedState = null;
  }

  /**
   * Reset time and state without removing clips.
   * Useful for restarting an animation with the same clip configuration.
   */
  resetState(): void {
    this._time = 0;
    this.endPauseRemaining = 0;
    this._cachedState = null;
    this.clips.forEach(s => s.playCount = 0);
  }

  /**
   * Replace all clips at once without recreating the timeline.
   * Useful when data changes and clips need to be updated.
   * @param clips - Array of clips with their timing and options
   */
  replaceClips(clips: Array<{ clip: Clip<TState>; timing: ClipTiming; options?: ClipOptions }>): void {
    this.clips = [];
    this._cachedState = null;
    clips.forEach(({ clip, timing, options }) => this.add(clip, timing, options));
  }

  // ===== Events =====

  /**
   * Register tick callback (for figure to redraw).
   * Multiple callbacks can be registered; each receives (normalizedTime, state).
   * @param callback - Receives normalized time (0-1) and current state
   * @returns Unsubscribe function
   */
  onTick(callback: (normalizedTime: number, state: Readonly<TState>) => void): () => void {
    this.tickCallbacks.add(callback);
    return () => {
      this.tickCallbacks.delete(callback);
    };
  }

  get isAtEnd(): boolean {
    return this._time >= this.duration;
  }

  // ===== Internal =====

  private tick(dt: number): void {
    // Skip time progression if seeking (but still fire callbacks for redraws)
    if (this._isSeeking) {
      this.tickCallbacks.forEach(cb => cb(this._time / this.duration, this.state));
      return;
    }

    // If in end pause state, count down
    if (this.endPauseRemaining > 0) {
      this.endPauseRemaining -= dt;
      if (this.endPauseRemaining <= 0 && this.looping) {
        this._time = 0;
        this._cachedState = null;
      }
      this.tickCallbacks.forEach(cb => cb(this._time / this.duration, this.state));
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

    this.tickCallbacks.forEach(cb => cb(this._time / this.duration, this.state));
  }

  private resolveState(): TState {
    const initial = this.initialState;
    let result = { ...initial };

    // Group active clips by layer
    const clipsByLayer = new Map<number, ScheduledClip<TState>[]>();

    for (const scheduled of this.clips) {
      const { clip, start, end, options } = scheduled;
      const duration = end - start;
      const isInstant = duration === 0;

      // Check if clip has started (clips contribute from start onwards, holding final state after end)
      // For instant clips (start === end), they're active only at their start time
      const normalizedTime = this._time / this.duration;
      const hasStarted = isInstant
        ? Math.abs(normalizedTime - start) < 0.0001 // Instant clip at start time
        : normalizedTime >= start;

      if (!hasStarted) continue;

      // Compute local time within clip (0 to 1)
      // If clip has ended, use t=1 (final state) to persist its contribution
      const hasEnded = normalizedTime > end;
      const localT = isInstant
        ? 1 // Instant clips get t=1
        : hasEnded ? 1 : Math.min(1, Math.max(0, (normalizedTime - start) / duration));

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
        const { clip, start, end } = scheduled;
        const duration = end - start;
        const isInstant = duration === 0;
        const normalizedTime = this._time / this.duration;
        const hasEnded = normalizedTime > end;
        const localT = isInstant
          ? 1
          : hasEnded ? 1 : Math.min(1, Math.max(0, (normalizedTime - start) / duration));

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
/**
 * Creates a pause clip that preserves the current state.
 * During its active window [start, end], it returns the current accumulated state unchanged.
 * Use with timeline.add(createPauseClip(), { start, end }) to schedule it.
 */
export function createPauseClip<TState>(): Clip<TState> {
  return {
    name: "Pause",
    // Return null to make no state changes - previous clip's final state is preserved
    // Note: returning { ...current } doesn't work because `current` is the pre-layer state,
    // which would overwrite other clips' contributions in the same layer.
    reduce: () => null,
  };
}
