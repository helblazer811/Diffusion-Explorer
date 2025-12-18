<script lang="ts">
  let { isPlaying = true, onclick = () => {} } = $props();
</script>

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

<style>
  .play-pause-button {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 10;
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
