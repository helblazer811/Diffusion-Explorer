// ===== Clip =====
// A clip maps local time (0..1) to state mutations
export type Clip<TParams, TState> = {
  name?: string;
  duration: number; // normalized 0..1
  apply(t: number, params: TParams, state: TState): void;
};

// ===== Track =====
// A track is a sequence of clips placed at specific start times
type ScheduledClip<TParams, TState> = {
  clip: Clip<TParams, TState>;
  start: number; // normalized start time on track
};

export class Track<TParams, TState> {
  time = 0;
  duration = 1;
  looping = false;
  clips: ScheduledClip<TParams, TState>[] = [];

  add(clip: Clip<TParams, TState>, start = 0): this {
    this.clips.push({ clip, start });
    return this;
  }

  reset(): void {
    this.time = 0;
  }

  get isAtEnd(): boolean {
    return this.time >= this.duration;
  }

  update(dt: number, params: TParams, state: TState): void {
    this.time = Math.min(this.time + dt, this.duration);

    for (const { clip, start } of this.clips) {
      const localT = (this.time - start) / clip.duration;
      if (localT >= 0 && localT <= 1) {
        clip.apply(localT, params, state);
      }
    }

    if (this.isAtEnd && this.looping) {
      this.reset();
    }
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
// Duration is in normalized time units (relative to track duration)
export function createPauseClip<TParams, TState>(duration: number): Clip<TParams, TState> {
  return {
    name: "Pause",
    duration,
    apply(_t, _params, _state) {
      // Intentionally empty - pause clips don't modify state
    }
  };
}
