<script>
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
  export let dragEnabled = true;
  export let onTogglePlay = () => {};
  export let onInput = () => {};  // Called when user drags slider
  export let hideSpacerOnMobile = false;

  function handleTogglePlay() {
    onTogglePlay();
  }
</script>

<div class="time-slider-container" class:disabled>
  <div class="time-slider-inner">
    <button
      class="play-button"
      onclick={handleTogglePlay}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      {disabled}
    >
      {#if isPlaying}
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
      <Slider
        bind:value
        {min}
        {max}
        {step}
        {disabled}
        {color}
        {showTicks}
        showLabel={showTimeLabel}
        label={timeLabel}
        {dragEnabled}
        {onInput}
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
