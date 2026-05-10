<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Timeline } from 'tempus';
  import Slider from './Slider.svelte';

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

  // Optional Timeline instance - when provided, TimeSlider controls the timeline directly
  // This enables seamless scrubbing while animation is playing
  // See: packages/ui/src/animation/animation.ts for Timeline documentation
  export let timeline: Timeline<unknown> | null = null;

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

  // Subscribe to timeline tick updates when timeline changes
  $: if (timeline) {
    // Sync initial state - use displayTime if provided, otherwise timeline time
    sliderValue = displayTime ?? timeline.time / timeline.duration;
    playing = timeline.isPlaying;

    // Subscribe to updates (replaces any previous subscription)
    unsubscribe?.();
    unsubscribe = timeline.onTick((t) => {
      // Use displayTime prop if provided (it's reactively updated by parent)
      sliderValue = displayTime ?? t;
      playing = timeline.isPlaying;
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

  // Handle drag start - pause time progression while seeking
  function handleDragStart() {
    if (timeline && 'startSeeking' in timeline) {
      timeline.startSeeking();
    }
  }

  // Handle drag end - resume time progression
  function handleDragEnd() {
    if (timeline && 'endSeeking' in timeline) {
      timeline.endSeeking();
    }
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
