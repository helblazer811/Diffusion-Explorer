<script>
  // Props
  export let leftLabel = "Left";
  export let rightLabel = "Right";
  export let value = false;  // false = left selected, true = right selected
  export let borderRadius = 20;  // px
  export let activeColor = "#f17720";  // Orange (matching trajectory color)
  export let inactiveColor = "#e5e5e5";  // Light gray
  export let textColor = "#333";
  export let activeTextColor = "#fff";
  export let fontSize = 18;  // px
  export let padding = "8px 16px";
  export let onchange = (newValue) => {};

  // Button references for width tracking
  let leftButton;
  let rightButton;
  let leftWidth = 0;
  let rightWidth = 0;

  // Slider dimensions based on active button
  $: sliderWidth = value ? rightWidth : leftWidth;
  $: sliderX = value ? leftWidth + 5 : 0; // 5px gap

  function select(newValue) {
    if (newValue !== value) {
      value = newValue;
      onchange(newValue);
    }
  }
</script>

<div
  class="toggle-container"
  style="--border-radius: {borderRadius}px; --inactive-color: {inactiveColor};"
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
  <button
    bind:this={leftButton}
    bind:clientWidth={leftWidth}
    class="toggle-option left"
    class:active={!value}
    onclick={() => select(false)}
    style="
      --text-color: {textColor};
      --active-text-color: {activeTextColor};
      --font-size: {fontSize}px;
      --padding: {padding};
      --border-radius: {borderRadius}px;
    "
  >
    {leftLabel}
  </button>
  <button
    bind:this={rightButton}
    bind:clientWidth={rightWidth}
    class="toggle-option right"
    class:active={value}
    onclick={() => select(true)}
    style="
      --text-color: {textColor};
      --active-text-color: {activeTextColor};
      --font-size: {fontSize}px;
      --padding: {padding};
      --border-radius: {borderRadius}px;
    "
  >
    {rightLabel}
  </button>
</div>

<style>
  .toggle-container {
    display: inline-flex;
    position: relative;
    background-color: var(--inactive-color);
    border-radius: var(--border-radius);
    border: 1px solid rgba(0, 0, 0, 0.15);
    padding: 3px;
    gap: 5px;
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
