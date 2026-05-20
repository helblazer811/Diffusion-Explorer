<script lang="ts">
  import { onDestroy } from 'svelte';
  import Slider from './Slider.svelte';

  // Duck-typed transport surface. TimeSlider works against any object that
  // exposes the read+write playback surface below. Both the legacy mutable
  // `Timeline` (from `tempus/legacy`) and the new `Player` (from `tempus`)
  // satisfy this — the legacy class also exposes `t` / `timeline` getters
  // for inspector compatibility, and the new Player has every method here.
  type TransportLike = {
    isPlaying: boolean;
    duration?: number;            // legacy Timeline
    time?: number;                 // legacy Timeline
    t?: number;                    // new Player
    play(): void;
    pause(): void;
    seek(t: number): void;
    onTick(cb: (t: number, state: any) => void): () => void;
    // Optional legacy-only seeking hooks; ignored on Player.
    startSeeking?: () => void;
    endSeeking?: () => void;
  };

  // Props
  export let value = 0;
  export let isPlaying = false;
  export let min = 0;
  export let max = 1;
  export let step = 0.001;
  export let disabled = false;
  export let color = '#4594e3';
  export let showTicks = true;
  export let showTimeLabel = true;
  export let timeLabel = 'Time';
  export let minLabel = 't=0';
  export let maxLabel = 't=1';
  export let dragEnabled = true;
  export let hideSpacerOnMobile = false;
  export let discreteFill = false;  // Snap fill to step boundaries
  export let showPlayButton = true;
  export let maxWidth = '644px';
  export let labelSize = '1em';

  // Optional Timeline/Player instance — when provided, TimeSlider drives
  // playback directly (seek + play/pause). Accepts either a legacy mutable
  // Timeline or a new Player (duck-typed).
  export let timeline: TransportLike | null = null;

  // Optional callbacks (not required when using timeline)
  export let onTogglePlay: (() => void) | null = null;  // Called when play/pause is clicked
  export let onInput: ((value: number) => void) | null = null;  // Called when slider is dragged (receives numeric value)

  // Display time override - when set, shows this instead of timeline's internal time
  // Useful for animations where semantic time differs from timeline time (e.g., forward-backward animations)
  export let displayTime: number | null = null;
  export let onSeekByDisplayTime: ((t: number) => void) | null = null;  // Called when seeking with display time

  // Internal state (synced from timeline when provided)
  let sliderValue = 0;
  let playing = false;
  let unsubscribe: (() => void) | null = null;

  // Helper: normalized playhead. Legacy Timeline exposes `time` + `duration`;
  // Player exposes `t`. Both work via this small adapter.
  function currentT(tl: TransportLike): number {
    if (typeof tl.t === 'number') return tl.t;
    if (typeof tl.time === 'number' && typeof tl.duration === 'number' && tl.duration > 0) {
      return tl.time / tl.duration;
    }
    return 0;
  }

  // Subscribe to timeline tick updates when timeline changes
  $: if (timeline) {
    sliderValue = displayTime ?? currentT(timeline);
    playing = timeline.isPlaying;

    unsubscribe?.();
    unsubscribe = timeline.onTick((t) => {
      sliderValue = displayTime ?? t;
      playing = timeline!.isPlaying;
    });
  } else {
    // No timeline: use legacy props
    unsubscribe?.();
    unsubscribe = null;
  }

  // React to displayTime changes when timeline exists
  $: if (timeline && displayTime !== null) {
    sliderValue = displayTime;
  }

  // Sync legacy props to internal state when not using timeline
  $: if (!timeline) {
    sliderValue = value;
    playing = isPlaying;
  }

  // Cleanup on component destroy
  onDestroy(() => unsubscribe?.());

  // Toggle play/pause - uses timeline methods if available, otherwise calls callback
  function togglePlay() {
    if (timeline && 'play' in timeline && 'pause' in timeline) {
      // Use Timeline's play/pause methods
      if (timeline.isPlaying) {
        timeline.pause();
      } else {
        timeline.play();
      }
      playing = timeline.isPlaying;
    } else if (onTogglePlay) {
      // Legacy: let callback handle the toggle (avoids double-toggle)
      onTogglePlay();
    } else {
      // No timeline and no callback: toggle via two-way binding
      isPlaying = !isPlaying;
      playing = isPlaying;
    }
  }

  // Handle slider input - use timeline.seek() if available
  function handleSliderInput(event) {
    const newValue = parseFloat(event.currentTarget.value);

    if (timeline && 'seek' in timeline) {
      if (onSeekByDisplayTime) {
        // Use custom seek handler for display time mapping
        onSeekByDisplayTime(newValue);
      } else {
        // Default: seek directly on timeline
        timeline.seek(newValue);
      }
    }

    // Call optional user callback with the VALUE (not event)
    if (onInput) onInput(newValue);
  }

  // Drag-pause: snapshot the play state and stop the clock at drag start;
  // restore at drag end. Player has no `startSeeking`/`endSeeking` (those
  // were a transport-state leak); legacy Timeline still uses them if
  // available. We do both — the local snapshot covers the Player path, and
  // the legacy hooks keep the previous "freeze the clock but stay rendered"
  // behavior on figures that haven't migrated.
  let wasPlayingAtDragStart = false;
  function handleDragStart() {
    if (!timeline) return;
    wasPlayingAtDragStart = timeline.isPlaying;
    timeline.startSeeking?.();
    timeline.pause();
  }

  function handleDragEnd() {
    if (!timeline) return;
    timeline.endSeeking?.();
    if (wasPlayingAtDragStart) timeline.play();
    wasPlayingAtDragStart = false;
  }
</script>

<div class="time-slider-container" class:disabled style="font-size: {labelSize};">
  <div class="time-slider-inner" style="max-width: {maxWidth};">
    {#if showPlayButton}
      <button
        class="play-button"
        onclick={togglePlay}
        aria-label={playing ? 'Pause' : 'Play'}
        {disabled}
      >
        {#if playing}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        {:else}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        {/if}
      </button>
    {/if}

    <div class="slider-wrapper">
      <Slider
        value={sliderValue}
        {min}
        {max}
        {step}
        {disabled}
        {color}
        {showTicks}
        showLabel={showTimeLabel}
        label={timeLabel}
        {minLabel}
        {maxLabel}
        {dragEnabled}
        onInput={handleSliderInput}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        {discreteFill}
        {maxWidth}
        {labelSize}
      />
    </div>

    <div class="spacer" class:desktop-only={hideSpacerOnMobile}></div>
  </div>
</div>

<style>
  .time-slider-container {
    width: 100%;
    display: flex;
    justify-content: center;
  }

  .time-slider-container.disabled {
    pointer-events: none;
    opacity: 0.5;
  }

  .time-slider-inner {
    display: flex;
    align-items: flex-start;
    width: 100%;
    max-width: 644px;
  }

  .play-button {
    width: 32px;
    height: 32px;
    padding: 0;
    margin-right: 12px;
    margin-top: 5px;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
    transition: opacity 0.2s;
    flex-shrink: 0;
  }

  .play-button:hover {
    opacity: 1;
  }

  .play-button:disabled {
    cursor: not-allowed;
    opacity: 0.3;
  }

  .play-button svg {
    color: #333;
  }

  .slider-wrapper {
    flex: 1;
  }

  .spacer {
    width: 32px;
    margin-left: 12px;
    flex-shrink: 0;
  }

  .desktop-only {
    display: block;
  }

  @media (max-width: 600px) {
    .desktop-only {
      display: none;
    }
  }
</style>
