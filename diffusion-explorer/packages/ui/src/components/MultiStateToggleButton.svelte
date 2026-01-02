<script>
  // Props
  export let labels = ["Option 1", "Option 2", "Option 3"];  // Array of labels
  export let value = 0;  // Index of selected option (0, 1, 2, ...)
  export let borderRadius = 20;  // px
  export let activeColor = "#f17720";  // Orange (matching trajectory color)
  export let inactiveColor = "rgba(200, 200, 200, 0.4)";  // Light gray, semi-transparent
  export let textColor = "rgba(51, 51, 51, 0.7)";  // Dark text, slightly transparent
  export let activeTextColor = "#fff";
  export let fontSize = 16;  // px
  export let padding = "8px 16px";
  export let gap = 5;  // px gap between buttons
  export let onchange = (newValue) => {};

  // Button widths for slider positioning
  let buttonWidths = labels.map(() => 0);

  // Slider dimensions based on active button
  $: sliderWidth = buttonWidths[value] || 0;
  $: sliderX = buttonWidths.slice(0, value).reduce((sum, w) => sum + w + gap, 0);

  function select(newValue) {
    if (newValue !== value) {
      value = newValue;
      onchange(newValue);
    }
  }
</script>

<div
  class="toggle-container"
  style="--border-radius: {borderRadius}px; --inactive-color: {inactiveColor}; --gap: {gap}px;"
>
  <div
    class="toggle-slider"
    style="
      width: {sliderWidth}px;
      transform: translateX({sliderX}px);
      --active-color: {activeColor};
      --border-radius: {borderRadius}px;
    "
  ></div>
  {#each labels as label, index}
    <button
      bind:clientWidth={buttonWidths[index]}
      class="toggle-option"
      class:active={value === index}
      onclick={() => select(index)}
      style="
        --text-color: {textColor};
        --active-text-color: {activeTextColor};
        --font-size: {fontSize}px;
        --padding: {padding};
        --border-radius: {borderRadius}px;
      "
    >
      {label}
    </button>
  {/each}
</div>

<style>
  .toggle-container {
    display: inline-flex;
    position: relative;
    background-color: var(--inactive-color);
    border-radius: var(--border-radius);
    border: 1px solid rgba(0, 0, 0, 0.15);
    padding: 3px;
    gap: var(--gap);
  }

  .toggle-slider {
    position: absolute;
    top: 4px;
    left: 4px;
    height: calc(100% - 8px);
    background-color: var(--active-color);
    border-radius: calc(var(--border-radius) - 4px);
    border: 1px solid rgba(0, 0, 0, 0.1);
    box-sizing: border-box;
    transition: transform 0.25s ease, width 0.25s ease;
    z-index: 0;
    pointer-events: none;
  }

  .toggle-option {
    position: relative;
    z-index: 1;
    background: transparent;
    border: 1px solid transparent;
    padding: var(--padding);
    font-size: var(--font-size);
    color: var(--text-color);
    cursor: pointer;
    transition: color 0.2s ease;
    font-family: inherit;
    border-radius: calc(var(--border-radius) - 4px);
    margin: 0;
    white-space: nowrap;
  }

  .toggle-option.active {
    color: var(--active-text-color);
  }

  .toggle-option:hover:not(.active) {
    background-color: rgba(0, 0, 0, 0.05);
  }

  .toggle-option:focus {
    outline: none;
  }

  .toggle-option:focus-visible {
    outline: 2px solid var(--active-color);
    outline-offset: 2px;
  }

  @media (max-width: 600px) {
    .toggle-option {
      font-size: 14px;
      padding: 6px 12px;
    }
  }
</style>
