/**
 * TimelineBuilder - Incremental timeline construction with absolute durations.
 *
 * Use this when you know the duration of each unit (e.g., 5ms per step)
 * but don't know the total duration upfront.
 *
 * @example
 * const builder = new TimelineBuilder<AnimationState>()
 *   .setInitialState(initialState)
 *   .setLooping(true);
 *
 * for (const pathline of pathlines) {
 *   builder.add(integrationClip, { durationMs: pathline.length * 5 });
 *   if (hasCollision) {
 *     builder.add(flashFadeClip, { durationMs: 40 });
 *   }
 * }
 *
 * const timeline = builder.build();  // duration auto-computed
 */

import { Timeline, type Clip } from "./timeline";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export interface TimelineBuilderAddOptions {
  /** Duration of the clip in milliseconds */
  durationMs: number;
  /** Layer for clip priority (default: 0) */
  layer?: number;
}

export interface TimelineBuilderAddAtOptions extends TimelineBuilderAddOptions {
  /** Absolute start time in milliseconds */
  startMs: number;
}

interface ScheduledClipInfo<TState> {
  clip: Clip<TState>;
  startMs: number;
  endMs: number;
  layer: number;
}

// ----------------------------------------------------------------
// TimelineBuilder
// ----------------------------------------------------------------

export class TimelineBuilder<TState> {
  private _initialState: TState | null = null;
  private _looping = false;
  private _endPauseMs = 0;
  private _currentTimeMs = 0;

  private clips: ScheduledClipInfo<TState>[] = [];

  // ----------------------------------------------------------------
  // Configuration
  // ----------------------------------------------------------------

  /**
   * Set the initial state for the timeline.
   * Required before calling build().
   */
  setInitialState(state: TState): this {
    this._initialState = state;
    return this;
  }

  /**
   * Set whether the timeline should loop.
   */
  setLooping(looping: boolean): this {
    this._looping = looping;
    return this;
  }

  /**
   * Set pause duration at end before looping (in milliseconds).
   */
  setEndPause(ms: number): this {
    this._endPauseMs = ms;
    return this;
  }

  // ----------------------------------------------------------------
  // Accessors
  // ----------------------------------------------------------------

  /**
   * Current accumulated time (end of last sequential clip).
   * Use this to schedule parallel clips or to check accumulated duration.
   */
  get currentTimeMs(): number {
    return this._currentTimeMs;
  }

  /**
   * Manually set the cursor position.
   * Useful for positioning after parallel clip sequences.
   */
  set currentTimeMs(ms: number) {
    this._currentTimeMs = ms;
  }

  // ----------------------------------------------------------------
  // Adding Clips
  // ----------------------------------------------------------------

  /**
   * Add a clip sequentially at the current time.
   * Advances the cursor by the clip's duration.
   *
   * @param clip - The clip to add
   * @param options - Duration and optional layer
   */
  add(clip: Clip<TState>, options: TimelineBuilderAddOptions): this {
    const startMs = this._currentTimeMs;
    const endMs = startMs + options.durationMs;

    this.clips.push({
      clip,
      startMs,
      endMs,
      layer: options.layer ?? 0,
    });

    this._currentTimeMs = endMs;
    return this;
  }

  /**
   * Add a clip at a specific absolute time.
   * Does NOT advance the cursor (use for parallel clips).
   * Updates cursor only if this clip extends beyond current cursor position.
   *
   * @param clip - The clip to add
   * @param options - Start time, duration, and optional layer
   */
  addAt(clip: Clip<TState>, options: TimelineBuilderAddAtOptions): this {
    const endMs = options.startMs + options.durationMs;

    this.clips.push({
      clip,
      startMs: options.startMs,
      endMs,
      layer: options.layer ?? 0,
    });

    // Update cursor only if this extends beyond
    this._currentTimeMs = Math.max(this._currentTimeMs, endMs);
    return this;
  }

  // ----------------------------------------------------------------
  // Build
  // ----------------------------------------------------------------

  /**
   * Build the Timeline from accumulated clips.
   * Computes total duration from max end time of all clips.
   * Normalizes all clip times to 0-1 range.
   *
   * @returns A configured Timeline ready for playback
   */
  build(): Timeline<TState> {
    if (!this._initialState) {
      throw new Error("TimelineBuilder: initialState must be set before build()");
    }

    // Compute total duration from all clips
    const totalDurationMs = this.clips.length > 0
      ? Math.max(...this.clips.map((c) => c.endMs))
      : 1;

    const timeline = new Timeline<TState>();
    timeline.initialState = this._initialState;
    timeline.duration = totalDurationMs / 1000; // Convert to seconds
    timeline.looping = this._looping;

    if (this._endPauseMs > 0) {
      timeline.setEndPause(this._endPauseMs / 1000);
    }

    // Add clips with normalized times
    for (const { clip, startMs, endMs, layer } of this.clips) {
      timeline.add(
        clip,
        {
          start: startMs / totalDurationMs,
          end: endMs / totalDurationMs,
        },
        { layer }
      );
    }

    return timeline;
  }

  // ----------------------------------------------------------------
  // Utilities
  // ----------------------------------------------------------------

  /**
   * Get the computed total duration based on current clips.
   * Useful for debugging or display before calling build().
   */
  get totalDurationMs(): number {
    return this.clips.length > 0
      ? Math.max(...this.clips.map((c) => c.endMs))
      : 0;
  }

  /**
   * Get the number of clips added so far.
   */
  get clipCount(): number {
    return this.clips.length;
  }
}
