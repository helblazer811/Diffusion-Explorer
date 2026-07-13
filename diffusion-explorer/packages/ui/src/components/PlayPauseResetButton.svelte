<script>
  export let isPlaying = true;
  export let onclick = () => {};
  export let onreset = () => {};

  // Timing circle props
  export let showTimingCircle = true;
  export let time = 0;  // Normalized time (0-1)
  export let circleColor = '#f17720';  // Standard orange
  export let circleThickness = 3;

  // Circle geometry
  const radius = 16;
  const circumference = 2 * Math.PI * radius;

  $: dashOffset = circumference * (1 - time);
  $: isComplete = time >= 0.999;

  function handleClick() {
    if (isComplete) onreset();
    else onclick();
  }

  $: ariaLabel = isComplete
    ? 'Restart animation'
    : isPlaying
      ? 'Pause animation'
      : 'Play animation';
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
    on:click={handleClick}
    aria-label={ariaLabel}
  >
    {#if isComplete}
      <!-- Restart icon: arc centered at (13, 13), arrowhead on right end with wider base -->
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M 9 6.07 A 8 8 0 1 0 17 6.07"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          fill="none"
        />
        <path
          d="M 14.4 4.57 L 15.75 8.235 L 18.25 3.905 Z"
          fill="currentColor"
          stroke="currentColor"
          stroke-width="0.6"
          stroke-linejoin="round"
        />
      </svg>
    {:else if isPlaying}
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

  @media (max-width: 600px) {
    .play-button-container {
      display: none;
    }
  }
</style>
