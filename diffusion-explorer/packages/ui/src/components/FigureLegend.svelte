<script>
  // Props
  export let items = [];       // Array of { type, color, label }
  export let gap = 24;         // Gap between items (px)
  export let fontSize = 18;    // Label font size (px)
  export let textColor = '#666'; // Label color
</script>

<div class="legend" style="--gap: {gap}px; --font-size: {fontSize}px; --text-color: {textColor};">
  {#each items as item}
    <div class="legend-item">
      {#if item.type === 'line'}
        <span class="legend-indicator line" style="background-color: {item.color};"></span>
      {:else if item.type === 'dashed'}
        <span class="legend-indicator dashed" style="--color: {item.color};"></span>
      {:else if item.type === 'circle'}
        <span class="legend-indicator circle" style="background-color: {item.color};"></span>
      {:else if item.type === 'square'}
        <span class="legend-indicator square" style="background-color: {item.color};"></span>
      {:else if item.type === 'triangle'}
        <span class="legend-indicator triangle" style="--color: {item.color};"></span>
      {/if}
      <span class="legend-text">{item.label}</span>
    </div>
  {/each}
</div>

<style>
  .legend {
    display: flex;
    justify-content: center;
    gap: var(--gap);
    flex-wrap: wrap;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .legend-indicator {
    flex-shrink: 0;
  }

  .legend-indicator.line {
    width: 20px;
    height: 4px;
    border-radius: 2px;
  }

  .legend-indicator.dashed {
    width: 20px;
    height: 4px;
    background: repeating-linear-gradient(
      90deg,
      var(--color) 0px,
      var(--color) 4px,
      transparent 4px,
      transparent 7px
    );
  }

  .legend-indicator.circle {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }

  .legend-indicator.square {
    width: 12px;
    height: 12px;
  }

  .legend-indicator.triangle {
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-bottom: 10px solid var(--color);
  }

  .legend-text {
    font-size: var(--font-size);
    color: var(--text-color);
    font-family: Helvetica, Arial, sans-serif;
  }

  @media (max-width: 600px) {
    .legend {
      gap: calc(var(--gap) / 2);
    }
    .legend-text {
      font-size: 11px;
    }
  }
</style>
