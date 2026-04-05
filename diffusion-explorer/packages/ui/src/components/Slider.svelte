<script>
  import { onDestroy } from 'svelte';

  // Props
  export let value = 0;
  export let min = 0;
  export let max = 1;
  export let step = 0.001;
  export let disabled = false;
  export let color = '#4594e3';
  export let showTicks = true;
  export let showLabel = true;
  export let label = '';
  export let minLabel = 't=0';
  export let maxLabel = 't=1';
  export let dragEnabled = true;
  export let onInput = () => {};  // Called when user drags slider
  export let onDragStart = () => {};  // Called when user starts dragging
  export let onDragEnd = () => {};    // Called when user stops dragging
  export let showValue = false;
  export let maxWidth = '600px';
  export let labelSize = '';
  export let valueFormatter = (v) => v.toFixed(2);  // Function to format displayed value

  // Custom ticks: array of {position: number (0-1), label: string}
  // When provided, overrides minLabel/maxLabel
  export let ticks = null;

  // Index of active tick to highlight (used with custom ticks)
  export let activeTickIndex = -1;

  // Show tick marks (vertical lines) at each tick position
  // When true with custom ticks, shows marks at each tick position
  export let showTickMarks = false;

  // Snap fill to step boundaries (for discrete animations)
  export let discreteFill = false;

  // Track dragging state
  let isDragging = false;

  function handleDragStart() {
    if (isDragging || typeof document === 'undefined') return;
    isDragging = true;
    onDragStart();
    // Listen for drag end on document (user may release outside slider)
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchend', handleDragEnd);
  }

  function handleDragEnd() {
    if (!isDragging || typeof document === 'undefined') return;
    isDragging = false;
    onDragEnd();
    document.removeEventListener('mouseup', handleDragEnd);
    document.removeEventListener('touchend', handleDragEnd);
  }

  // Cleanup on component destroy
  onDestroy(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('mouseup', handleDragEnd);
      document.removeEventListener('touchend', handleDragEnd);
    }
  });

  // Dynamic background gradient based on current value
  let sliderStyle;
  $: {
    let displayValue = value;
    if (discreteFill && step > 0) {
      // Snap to nearest step boundary
      displayValue = Math.round((value - min) / step) * step + min;
    }
    const fillPercent = ((displayValue - min) / (max - min)) * 100;
    sliderStyle = `background: linear-gradient(to right, ${color} ${fillPercent}%, #d3d3d3 ${fillPercent}%)`;
  }
</script>

<div class="slider-container" class:disabled style={labelSize ? `--slider-label-size: ${labelSize};` : ''}>
  <div class="slider-inner" style="max-width: {maxWidth};">
    <div class="slider-wrapper">
      <input
        type="range"
        {min}
        {max}
        {step}
        class="slider"
        style="{sliderStyle}; --slider-color: {color};{dragEnabled ? '' : ' pointer-events: none;'}"
        bind:value
        {disabled}
        oninput={onInput}
        onmousedown={handleDragStart}
        ontouchstart={handleDragStart}
      />

      {#if showTicks}
        <div class="tick-container">
          {#if ticks && ticks.length > 0}
            <!-- Custom ticks -->
            {#each ticks as tick, i}
              {#if showTickMarks}
                <div
                  class="tick"
                  class:active={i === activeTickIndex}
                  style="left: {tick.position * 100}%"
                ></div>
              {/if}
              {#if tick.label}
                <span
                  class="tick-label"
                  class:active={i === activeTickIndex}
                  style="left: {tick.position * 100}%"
                >{tick.label}</span>
              {/if}
            {/each}
          {:else}
            <!-- Default min/max ticks -->
            <div class="tick" style="left: 1%;"></div>
            <div class="tick-label" style="left: 1%;">{minLabel}</div>
            {#if showLabel && (label || showValue)}
              <div class="center-label">
                {#if label}{label}{/if}{#if label && showValue}:{/if}{#if showValue} {valueFormatter(value)}{/if}
              </div>
            {/if}
            <div class="tick" style="left: 99%;"></div>
            <div class="tick-label" style="left: 99%;">{maxLabel}</div>
          {/if}
        </div>
      {:else if showLabel && label}
        <div class="label-standalone">{label}</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .slider-container {
    width: 100%;
    padding: 5px 0;
    display: flex;
    justify-content: center;
  }

  .slider-container.disabled {
    pointer-events: none;
    opacity: 0.5;
  }

  .slider-inner {
    display: flex;
    align-items: center;
    width: 100%;
  }

  .slider-wrapper {
    flex: 1;
    position: relative;
    padding-top: 4px;
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
    transform: translateX(-50%);
  }

  .tick.active {
    background-color: var(--slider-color, #4594e3);
  }

  .tick-label {
    position: absolute;
    top: 12px;
    font-size: var(--slider-label-size, 11px);
    transform: translateX(-50%);
    font-family: monospace;
    color: #888;
  }

  .tick-label.active {
    color: var(--slider-color, #4594e3);
    font-weight: 600;
  }

  .center-label {
    position: absolute;
    left: 50%;
    top: 0;
    transform: translateX(-50%);
    font-size: var(--slider-label-size, 16px);
    font-family: Helvetica, sans-serif;
    color: #7b7b7b;
  }

  .label-standalone {
    text-align: center;
    font-size: 16px;
    font-family: Helvetica, sans-serif;
    color: #7b7b7b;
    opacity: 0.6;
  }
</style>
