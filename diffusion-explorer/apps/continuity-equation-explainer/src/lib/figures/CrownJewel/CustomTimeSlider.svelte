<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Timeline } from '@diffusion-explorer/ui';

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

  // Loop range visualization props
  export let loopStart = 0.8;  // Start of loop range (normalized 0-1)
  export let loopEnd = 1.0;     // End of loop range (normalized 0-1)
  export let loopMarkerColor = '#7b7b7b';  // Same as tick marks
  export let preLoopOpacity = 0.25;  // Opacity for region before loop
  export let trackColor = '#d3d3d3';  // Background track color

  // Optional Timeline instance
  export let timeline: Timeline<unknown> | null = null;

  // Optional callbacks
  export let onTogglePlay: (() => void) | null = null;
  export let onInput: ((value: number) => void) | null = null;

  // Display time override
  export let displayTime: number | null = null;
  export let onSeekByDisplayTime: ((t: number) => void) | null = null;

  // Internal state
  let sliderValue = 0;
  let playing = false;
  let unsubscribe: (() => void) | null = null;

  // Subscribe to timeline tick updates
  $: if (timeline) {
    sliderValue = displayTime ?? timeline.time / timeline.duration;
    playing = timeline.isPlaying;

    unsubscribe?.();
    unsubscribe = timeline.onTick((t) => {
      sliderValue = displayTime ?? t;
      playing = timeline.isPlaying;
    });
  } else {
    unsubscribe?.();
    unsubscribe = null;
  }

  // React to displayTime changes
  $: if (timeline && displayTime !== null) {
    sliderValue = displayTime;
  }

  // Sync legacy props when not using timeline
  $: if (!timeline) {
    sliderValue = value;
    playing = isPlaying;
  }

  // Compute fill percentage (0-100)
  $: fillPercent = ((sliderValue - min) / (max - min)) * 100;

  // Compute fill segments for pre-loop (dimmed) and loop (full opacity) regions
  $: loopStartPercent = loopStart * 100;
  $: preLoopFillWidth = Math.min(fillPercent, loopStartPercent);
  $: loopFillWidth = Math.max(0, fillPercent - loopStartPercent);

  // Cleanup
  onDestroy(() => unsubscribe?.());

  // Toggle play/pause
  function togglePlay() {
    if (timeline && 'play' in timeline && 'pause' in timeline) {
      if (timeline.isPlaying) {
        timeline.pause();
      } else {
        timeline.play();
      }
      playing = timeline.isPlaying;
    } else if (onTogglePlay) {
      onTogglePlay();
    } else {
      isPlaying = !isPlaying;
      playing = isPlaying;
    }
  }
</script>

<div class="time-slider-container">
  <div class="time-slider-inner">
    <!-- Play button is always interactive -->
    <button
      class="play-button"
      onclick={togglePlay}
      aria-label={playing ? 'Pause' : 'Play'}
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

    <div class="slider-wrapper">
      <div class="custom-track-container">
        <!-- Background track with opacity regions -->
        <div class="track-background">
          <!-- Pre-loop region (dimmed) -->
          <div
            class="track-segment pre-loop"
            style="width: {loopStart * 100}%; background: {trackColor}; opacity: {preLoopOpacity};"
          ></div>
          <!-- Loop region (full opacity) -->
          <div
            class="track-segment loop-region"
            style="left: {loopStart * 100}%; width: {(loopEnd - loopStart) * 100}%; background: {trackColor};"
          ></div>
        </div>

        <!-- Loop boundary markers -->
        <div class="loop-marker" style="left: {loopStart * 100}%; background: {loopMarkerColor};"></div>
        <div class="loop-marker" style="left: {loopEnd * 100}%; background: {loopMarkerColor};"></div>

        <!-- Animated fill - split into pre-loop (dimmed) and loop (full opacity) segments -->
        <div class="track-fill pre-loop-fill" style="width: {preLoopFillWidth}%; background: {color}; opacity: {preLoopOpacity};"></div>
        {#if loopFillWidth > 0}
          <div class="track-fill loop-fill" style="left: {loopStartPercent}%; width: {loopFillWidth}%; background: {color};"></div>
        {/if}

        <!-- Thumb indicator -->
        <div class="thumb" style="left: {fillPercent}%; background: {color};"></div>
      </div>

      <!-- Tick labels -->
      {#if showTicks}
        <div class="tick-container">
          <div class="tick" style="left: 1%;"></div>
          <div class="tick-label" style="left: 1%;">{minLabel}</div>
          {#if showTimeLabel && timeLabel}
            <div class="center-label">{timeLabel}</div>
          {/if}
          <div class="tick" style="left: 99%;"></div>
          <div class="tick-label" style="left: 99%;">{maxLabel}</div>
        </div>
      {/if}
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

  .play-button svg {
    color: #333;
  }

  .slider-wrapper {
    flex: 1;
    padding: 5px 0;
  }

  .custom-track-container {
    position: relative;
    width: 100%;
    height: 5px;
    padding-top: 4px;
  }

  .track-background {
    position: absolute;
    top: 4px;
    left: 0;
    right: 0;
    height: 5px;
    border-radius: 3px;
    overflow: hidden;
  }

  .track-segment {
    position: absolute;
    top: 0;
    height: 100%;
  }

  .track-segment.pre-loop {
    left: 0;
    border-radius: 3px 0 0 3px;
  }

  .track-segment.loop-region {
    border-radius: 0 3px 3px 0;
  }

  .loop-marker {
    position: absolute;
    top: 0px;
    width: 2px;
    height: 13px;
    transform: translateX(-50%);
    z-index: 2;
  }

  .track-fill {
    position: absolute;
    top: 4px;
    height: 5px;
    z-index: 1;
  }

  .track-fill.pre-loop-fill {
    left: 0;
    border-radius: 3px 0 0 3px;
  }

  .track-fill.loop-fill {
    border-radius: 0;
  }

  .thumb {
    position: absolute;
    top: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    transform: translateX(-50%);
    z-index: 3;
  }

  .tick-container {
    position: relative;
    width: 100%;
    height: 20px;
    margin-top: 6px;
  }

  .tick {
    position: absolute;
    top: 0;
    width: 2px;
    height: 10px;
    background-color: #7b7b7b;
    transform: translateX(-50%);
  }

  .tick-label {
    position: absolute;
    top: 12px;
    font-size: 11px;
    transform: translateX(-50%);
    font-family: monospace;
    color: #888;
  }

  .center-label {
    position: absolute;
    left: 50%;
    top: 0;
    transform: translateX(-50%);
    font-size: 16px;
    font-family: Helvetica, sans-serif;
    color: #7b7b7b;
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
