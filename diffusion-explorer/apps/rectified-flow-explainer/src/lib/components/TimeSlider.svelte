<script>
  // Props
  export let value = 0;
  export let isPlaying = false;
  export let min = 0;
  export let max = 1;
  export let step = 0.001;
  export let disabled = false;
  export let color = '#4594e3';
  export let showTicks = true;
  export let onTogglePlay = () => {};

  // Dynamic background gradient based on current value
  let sliderStyle;
  $: {
    const fillPercent = ((value - min) / (max - min)) * 100;
    sliderStyle = `background: linear-gradient(to right, ${color} ${fillPercent}%, #d3d3d3 ${fillPercent}%)`;
  }

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
      <input
        type="range"
        {min}
        {max}
        {step}
        class="slider"
        style="{sliderStyle}; --slider-color: {color};"
        bind:value
        {disabled}
      />

      {#if showTicks}
        <div class="tick-container">
          <div class="tick" style="left: 1%;"></div>
          <div class="tick-label" style="left: 1%;">t=0</div>
          <div class="tick" style="left: 99%;"></div>
          <div class="tick-label" style="left: 99%;">t=1</div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .time-slider-container {
    width: 100%;
    padding: 5px 0;
    display: flex;
    justify-content: center;
  }

  .time-slider-container.disabled {
    pointer-events: none;
    opacity: 0.5;
  }

  .time-slider-inner {
    display: flex;
    align-items: center;
    width: 100%;
    max-width: 600px;
  }

  .play-button {
    width: 32px;
    height: 32px;
    padding: 0;
    margin-right: 12px;
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
    position: relative;
  }

  .slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 5px;
    border-radius: 3px;
    outline: none;
    cursor: pointer;
    line-height: 0;
    padding: 0;
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    background: var(--slider-color, #4594e3);
    border-radius: 50%;
    cursor: pointer;
  }

  .slider::-moz-range-thumb {
    width: 10px;
    height: 10px;
    background: var(--slider-color, #4594e3);
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .tick-container {
    position: relative;
    width: 100%;
    height: 20px;
    margin-top: 2px;
  }

  .tick {
    position: absolute;
    top: 0;
    width: 2px;
    height: 10px;
    background-color: #7b7b7b;
  }

  .tick-label {
    position: absolute;
    top: 12px;
    font-size: 16px;
    transform: translateX(-50%);
    font-family: Helvetica, sans-serif;
    color: #7b7b7b;
  }
</style>
