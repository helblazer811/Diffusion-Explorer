<script>
  export let isPlaying = true;
  export let onclick = () => {};

  // Timing circle props
  export let showTimingCircle = true;
  export let time = 0;  // Normalized time (0-1)
  export let circleColor = '#f17720';  // Standard orange
  export let circleThickness = 3;

  // Circle geometry
  const radius = 16;
  const circumference = 2 * Math.PI * radius;

  $: dashOffset = circumference * (1 - time);
</script>

<div class="play-button-container">
  {#if showTimingCircle}
    <svg class="timing-circle" viewBox="0 0 40 40">
      <circle
        cx="20"
        cy="20"
        r={radius}
        fill="none"
        stroke={circleColor}
        stroke-width={circleThickness}
        stroke-dasharray={circumference}
        stroke-dashoffset={dashOffset}
        stroke-linecap="round"
        transform="rotate(-90 20 20)"
      />
    </svg>
  {/if}

  <button
    class="play-pause-button"
    {onclick}
    aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
  >
    {#if isPlaying}
      <!-- Pause icon (two vertical bars) -->
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="4" height="16" />
        <rect x="14" y="4" width="4" height="16" />
      </svg>
    {:else}
      <!-- Play icon (triangle) -->
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
    {/if}
  </button>
</div>

<style>
  .play-button-container {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 10;
    width: 40px;
    height: 40px;
  }

  .timing-circle {
    position: absolute;
    top: 0;
    left: 0;
    width: 40px;
    height: 40px;
    pointer-events: none;
  }

  .play-pause-button {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 32px;
    height: 32px;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.2s;
    opacity: 0.7;
  }

  .play-pause-button:hover {
    opacity: 1;
  }

  .play-pause-button:active {
    opacity: 0.5;
  }

  .play-pause-button svg {
    color: #333;
    display: block;
  }
</style>
