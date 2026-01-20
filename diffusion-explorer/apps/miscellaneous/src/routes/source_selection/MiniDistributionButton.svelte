<script lang="ts">
  import * as d3 from "d3";
  import { contourDensity } from "d3-contour";

  // Props
  export let data: number[][] = [];
  export let active: boolean = false;
  export let onclick: () => void = () => {};
  export let label: string = "";
  export let size: number = 64;

  // Compute scales based on fixed bounds
  const padding = 8;
  $: plotSize = size - 2 * padding;
  $: xScale = d3.scaleLinear()
    .domain([bounds.xMin, bounds.xMax])
    .range([padding, padding + plotSize]);
  $: yScale = d3.scaleLinear()
    .domain([bounds.yMin, bounds.yMax])
    .range([padding + plotSize, padding]);

  // Compute contours
  $: contours = computeContours(data);

  // Fixed bounds for all distributions
  const bounds = { xMin: -1.8, xMax: 1.8, yMin: -1.8, yMax: 1.8 };

  function computeContours(points: number[][]): string[] {
    if (points.length === 0) return [];

    // Create contour density generator
    const density = contourDensity<number[]>()
      .x(d => xScale(d[0]))
      .y(d => yScale(d[1]))
      .size([size, size])
      .bandwidth(1)
      .thresholds(4);

    const contourData = density(points);

    // Convert to path strings
    return contourData.map(c => d3.geoPath()(c) || "");
  }
</script>

<div class="mini-button-container">
  <span class="button-label" class:active>{label}</span>
  <button
    class="mini-button"
    class:active
    {onclick}
    style="width: {size}px; height: {size}px;"
    title={label}
  >
    <svg width={size} height={size}>
      <!-- Contours -->
      {#each contours as pathD, i}
        <path
          d={pathD}
          fill="#3b82f6"
          fill-opacity={0.15 + i * 0.1}
          stroke="none"
        />
      {/each}
    </svg>
  </button>
</div>

<style>
  .mini-button-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .button-label {
    font-size: 16px;
    color: #666;
    font-weight: 500;
  }

  .button-label.active {
    color: #4682b4;
  }

  .mini-button {
    padding: 0;
    border: 2px solid #ccc;
    border-radius: 8px;
    background: #fff;
    cursor: pointer;
    transition: all 0.15s ease;
    box-sizing: content-box;
  }

  .mini-button:hover {
    border-color: #999;
    background: #f8f8f8;
  }

  .mini-button.active {
    border-color: #4682b4;
    background: #f0f6fa;
  }

  .mini-button svg {
    display: block;
  }
</style>
