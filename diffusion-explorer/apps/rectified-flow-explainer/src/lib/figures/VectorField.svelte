<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import Figure from '$lib/components/Figure.svelte';
  import PlayButton from '$lib/components/PlayButton.svelte';

  // Data props
  export let vectorFieldData: {
    gridResolution: number;
    timeSteps: number[];
    domainRange: { xMin: number; xMax: number; yMin: number; yMax: number };
    velocities: number[][][];
    gridPoints: number[][];
  } | null = null;

  export let allTimeSamples: number[][][] = [];

  // Configuration props
  export let margin = 0;
  export let gridMargin = 60;
  export let arrowScale = 50;
  export let arrowWidth = 2;
  export let arrowColor = '#333';
  export let arrowOpacity = 0.5;
  export let trajectoryColor = '#ef4444';
  export let targetColor = '#3b82f6';
  export let targetOpacity = 0.35;
  export let targetPointRadius = 5;
  export let trajectoryIndex = 1;
  export let animationDuration = 5000; // ms per full loop
  export let playingByDefault = true;
  export let pauseDuration = 1000; // ms pause at end of animation
  export let figureNumber = '5';
  export let captionText = 'Sample trajectory (red) flowing through the animated vector field toward the target distribution (blue points).';

  // SVG references and dimensions
  let svgElement: SVGSVGElement;
  const svgWidth = 500;
  const svgHeight = 500;

  // Scales
  let xScale: d3.ScaleLinear<number, number>;
  let yScale: d3.ScaleLinear<number, number>;
  let xScaleGrid: d3.ScaleLinear<number, number>;
  let yScaleGrid: d3.ScaleLinear<number, number>;

  // Animation state
  let currentTimeIndex = 0;
  let isPlaying = playingByDefault;
  let animationFrameId: number | null = null;
  let isInitialized = false;

  // Pre-calculated grid positions
  interface GridPoint {
    x: number;      // SVG coordinate
    y: number;      // SVG coordinate
    dataIndex: number; // Index in velocities array
  }
  let gridPositions: GridPoint[] = [];

  function initializeScales() {
    if (!vectorFieldData) return;

    const { xMin, xMax, yMin, yMax } = vectorFieldData.domainRange;

    // Main scales for trajectories and target points
    xScale = d3.scaleLinear()
      .domain([xMin, xMax])
      .range([margin, svgWidth - margin]);

    yScale = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([margin, svgHeight - margin]);

    // Grid scales for vector field arrows
    xScaleGrid = d3.scaleLinear()
      .domain([xMin, xMax])
      .range([gridMargin, svgWidth - gridMargin]);

    yScaleGrid = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([gridMargin, svgHeight - gridMargin]);
  }

  function calculateGridPositions(): GridPoint[] {
    if (!vectorFieldData || !vectorFieldData.gridPoints) return [];

    const positions: GridPoint[] = [];

    // Use the loaded grid points from the cached data with grid scales
    vectorFieldData.gridPoints.forEach((point, index) => {
      positions.push({
        x: xScaleGrid(point[0]),
        y: yScaleGrid(point[1]),
        dataIndex: index
      });
    });

    return positions;
  }

  function calculateMaxVelocity(velocities: number[][]): number {
    let max = 0;
    for (const [vx, vy] of velocities) {
      const magnitude = Math.sqrt(vx * vx + vy * vy);
      if (magnitude > max) max = magnitude;
    }
    return max || 1;
  }

  function initializeVisualization() {
    if (!svgElement || !vectorFieldData) return;

    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();

    // Create arrow marker (lighter for background)
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'vector-arrow')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 8)
      .attr('refY', 5)
      .attr('markerWidth', 4)
      .attr('markerHeight', 4)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M 0 0 L 10 5 L 0 10 z')
      .attr('fill', arrowColor)
      .attr('opacity', arrowOpacity);

    // Create arrows group (background)
    const arrowsGroup = svg.append('g').attr('id', 'arrows');

    arrowsGroup.selectAll('line')
      .data(gridPositions)
      .enter()
      .append('line')
      .attr('class', 'vector-arrow')
      .attr('stroke', arrowColor)
      .attr('stroke-width', arrowWidth)
      .attr('stroke-opacity', arrowOpacity)
      .attr('marker-end', 'url(#vector-arrow)');

    // Add target distribution scatter (final time step of all trajectories)
    if (allTimeSamples.length > 0) {
      const finalTimeStep = allTimeSamples[allTimeSamples.length - 1];
      const targetGroup = svg.append('g').attr('id', 'target-scatter');

      targetGroup.selectAll('circle')
        .data(finalTimeStep)
        .enter()
        .append('circle')
        .attr('cx', d => xScale(d[0]))
        .attr('cy', d => yScale(d[1]))
        .attr('r', targetPointRadius)
        .attr('fill', targetColor)
        .attr('opacity', targetOpacity);
    }

    // Add trajectory path group
    svg.append('g').attr('id', 'trajectory-group');

    // Add current position marker
    svg.append('circle')
      .attr('id', 'current-position')
      .attr('r', 6)
      .attr('fill', trajectoryColor);

    updateVisualization(currentTimeIndex);
    isInitialized = true;
  }

  function updateVisualization(timeIndex: number) {
    if (!vectorFieldData || !svgElement || allTimeSamples.length === 0) return;

    const svg = d3.select(svgElement);

    // Update arrows
    const velocities = vectorFieldData.velocities[timeIndex];
    const maxVelocity = calculateMaxVelocity(velocities);

    svg.select('#arrows').selectAll('line')
      .data(gridPositions)
      .attr('x1', d => d.x)
      .attr('y1', d => d.y)
      .attr('x2', d => {
        const [vx, vy] = velocities[d.dataIndex];
        return d.x + (vx / maxVelocity) * arrowScale;
      })
      .attr('y2', d => {
        const [vx, vy] = velocities[d.dataIndex];
        return d.y + (vy / maxVelocity) * arrowScale;
      });

    // Update trajectory path
    const trajectoryGroup = svg.select('#trajectory-group');
    trajectoryGroup.selectAll('*').remove();

    // Map timeIndex (0 to vectorFieldData.timeSteps.length-1) to allTimeSamples index
    const numVectorFieldSteps = vectorFieldData.timeSteps.length;
    const numTrajectorySteps = allTimeSamples.length;
    const trajectoryTimeIndex = Math.floor((timeIndex / (numVectorFieldSteps - 1)) * (numTrajectorySteps - 1));

    // Draw full trajectory path (lighter)
    const fullPath = allTimeSamples.map((step, i) => {
      const [x, y] = step[trajectoryIndex];
      return `${i === 0 ? 'M' : 'L'} ${xScale(x)},${yScale(y)}`;
    }).join(' ');

    trajectoryGroup.append('path')
      .attr('d', fullPath)
      .attr('fill', 'none')
      .attr('stroke', '#ddd')
      .attr('stroke-width', 2)
      .attr('opacity', 0.5);

    // Draw animated trajectory path (darker, up to current time)
    const animatedPath = allTimeSamples.slice(0, trajectoryTimeIndex + 1).map((step, i) => {
      const [x, y] = step[trajectoryIndex];
      return `${i === 0 ? 'M' : 'L'} ${xScale(x)},${yScale(y)}`;
    }).join(' ');

    if (animatedPath) {
      trajectoryGroup.append('path')
        .attr('d', animatedPath)
        .attr('fill', 'none')
        .attr('stroke', trajectoryColor)
        .attr('stroke-width', 3);
    }

    // Update current position marker
    if (trajectoryTimeIndex < allTimeSamples.length) {
      const [currentX, currentY] = allTimeSamples[trajectoryTimeIndex][trajectoryIndex];
      svg.select('#current-position')
        .attr('cx', xScale(currentX))
        .attr('cy', yScale(currentY));
    }
  }

  function startAnimation() {
    if (!vectorFieldData) return;

    const numSteps = vectorFieldData.timeSteps.length;
    const stepDuration = animationDuration / numSteps;

    function animate() {
      if (!isPlaying) {
        animationFrameId = null;
        return;
      }

      updateVisualization(currentTimeIndex);

      const isLastFrame = currentTimeIndex === numSteps - 1;

      // Add pause at the end of animation cycle, otherwise use normal step duration
      const delay = isLastFrame ? stepDuration + pauseDuration : stepDuration;

      // Move to next frame
      const nextTimeIndex = (currentTimeIndex + 1) % numSteps;

      // When animation completes, pick a new random trajectory
      if (isLastFrame && allTimeSamples.length > 0 && allTimeSamples[0].length > 0) {
        const numSamples = allTimeSamples[0].length;
        trajectoryIndex = Math.floor(Math.random() * numSamples);
      }

      currentTimeIndex = nextTimeIndex;

      setTimeout(() => {
        animationFrameId = requestAnimationFrame(animate);
      }, delay);
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  function togglePlayPause() {
    isPlaying = !isPlaying;
    if (isPlaying) {
      startAnimation();
    } else if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  $: if (vectorFieldData && svgElement && !isInitialized) {
    initializeScales();
    gridPositions = calculateGridPositions();
    initializeVisualization();
    if (isPlaying) startAnimation();
  }

  onMount(() => {
    if (vectorFieldData) {
      initializeScales();
      gridPositions = calculateGridPositions();
      if (isPlaying) startAnimation();
    }
  });

  onDestroy(() => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
  });
</script>

{#if vectorFieldData && allTimeSamples.length > 0}
  <Figure>
    {#snippet children()}
      <div style="position: relative; width: 100%; display: flex; flex-direction: column; align-items: center;">
        <PlayButton {isPlaying} onclick={togglePlayPause} />
        <svg
          bind:this={svgElement}
          width={svgWidth}
          height={svgHeight}
          viewBox="0 0 {svgWidth} {svgHeight}">
        </svg>
      </div>
    {/snippet}

    {#snippet caption()}
      <div class="caption">
        <span class="figure-number">Figure {figureNumber}:</span> {captionText}
      </div>
    {/snippet}
  </Figure>
{:else}
  <div class="placeholder">
    <p>Vector field visualization requires:</p>
    <ul>
      {#if !vectorFieldData}
        <li>Vector field data (set <code>cachedVectorFieldPath</code> in +page.svelte)</li>
      {/if}
      {#if allTimeSamples.length === 0}
        <li>Trajectory samples</li>
      {/if}
    </ul>
  </div>
{/if}

<style>
  .caption {
    font-size: 1.1rem;
    line-height: 1.5;
    color: #555;
  }

  .figure-number {
    font-weight: 600;
  }

  .placeholder {
    padding: 2rem;
    text-align: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    color: #666;
  }

  .placeholder code {
    background-color: #e8e8e8;
    padding: 0.2em 0.4em;
    border-radius: 3px;
    font-family: monospace;
  }

  .placeholder ul {
    text-align: left;
    display: inline-block;
  }
</style>
