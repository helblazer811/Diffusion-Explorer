<script>
  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import { DoubleFigure, PlayButton } from '@diffusion-explorer/ui';
  import { settings } from '$lib/settings';

  // Data props
  export let vectorFieldData = null;

  export let allTimeSamples = [];

  // Configuration props
  export let marginWidth = 20;
  export let marginHeight = 20;
  export let gridMargin = 60;
  export let arrowScale = 50;
  export let arrowWidth = 2;
  export let arrowColor = '#333';
  export let arrowOpacity = 0.5;
  export let trajectoryColor = settings.stylingSettings.trajectory.color;
  export let targetColor = '#3b82f6';
  export let targetOpacity = 0.35;
  export let targetPointRadius = 5;
  export let trajectoryIndex = 1;
  export let animationDuration = 5000; // ms per full loop
  export let playingByDefault = true;
  export let pauseDuration = 1000; // ms pause at end of animation
  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // SVG references and dimensions
  let leftSvgElement;
  let rightSvgElement;
  const svgWidth = 400;
  const svgHeight = 400;

  // Scales
  let xScale;
  let yScale;
  let xScaleGrid;
  let yScaleGrid;

  // Animation state
  let currentTimeIndex = 0;
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let isInitialized = false;

  // Normalized time for timing circle (0-1)
  $: numTimeSteps = vectorFieldData?.timeSteps?.length || 1;
  $: normalizedTime = numTimeSteps > 1 ? currentTimeIndex / (numTimeSteps - 1) : 0;

  // Pre-calculated grid positions
  let gridPositions = [];

  function initializeScales() {
    if (!vectorFieldData) return;

    const { xMin, xMax, yMin, yMax } = vectorFieldData.domainRange;

    // Main scales for trajectories and target points
    xScale = d3.scaleLinear()
      .domain([xMin, xMax])
      .range([marginWidth, svgWidth - marginWidth]);

    yScale = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([marginHeight, svgHeight - marginHeight]);

    // Grid scales for vector field arrows
    xScaleGrid = d3.scaleLinear()
      .domain([xMin, xMax])
      .range([gridMargin, svgWidth - gridMargin]);

    yScaleGrid = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([gridMargin, svgHeight - gridMargin]);
  }

  function calculateGridPositions() {
    if (!vectorFieldData || !vectorFieldData.gridPoints) return [];

    const positions = [];

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

  function calculateMaxVelocity(velocities) {
    let max = 0;
    for (const [vx, vy] of velocities) {
      const magnitude = Math.sqrt(vx * vx + vy * vy);
      if (magnitude > max) max = magnitude;
    }
    return max || 1;
  }

  function initializeLeftSvg() {
    if (!leftSvgElement || !vectorFieldData) return;

    const svg = d3.select(leftSvgElement);
    svg.selectAll('*').remove();

    // Create arrow marker
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'vector-arrow-left')
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

    // Create arrows group
    const arrowsGroup = svg.append('g').attr('id', 'arrows');

    arrowsGroup.selectAll('line')
      .data(gridPositions)
      .enter()
      .append('line')
      .attr('class', 'vector-arrow')
      .attr('stroke', arrowColor)
      .attr('stroke-width', arrowWidth)
      .attr('stroke-opacity', arrowOpacity)
      .attr('marker-end', 'url(#vector-arrow-left)');

    // Add target distribution scatter
    if (allTimeSamples.length > 0) {
      const finalTimeStep = allTimeSamples[allTimeSamples.length - 1];
      const targetGroup = svg.append('g').attr('id', 'target-scatter-left');

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
  }

  function initializeRightSvg() {
    if (!rightSvgElement || !vectorFieldData) return;

    const svg = d3.select(rightSvgElement);
    svg.selectAll('*').remove();

    // Add target distribution scatter
    if (allTimeSamples.length > 0) {
      const finalTimeStep = allTimeSamples[allTimeSamples.length - 1];
      const targetGroup = svg.append('g').attr('id', 'target-scatter-right');

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
  }

  function initializeVisualization() {
    if (!leftSvgElement || !rightSvgElement || !vectorFieldData) return;

    initializeLeftSvg();
    initializeRightSvg();
    updateVisualization(currentTimeIndex);
    isInitialized = true;
  }

  function updateVisualization(timeIndex) {
    if (!vectorFieldData || !leftSvgElement || !rightSvgElement || allTimeSamples.length === 0) return;

    const leftSvg = d3.select(leftSvgElement);
    const rightSvg = d3.select(rightSvgElement);

    // Update arrows on left SVG
    const velocities = vectorFieldData.velocities[timeIndex];
    const maxVelocity = calculateMaxVelocity(velocities);

    leftSvg.select('#arrows').selectAll('line')
      .data(gridPositions)
      .attr('x1', d => d.x)
      .attr('y1', d => d.y)
      .attr('x2', d => {
        const [vx] = velocities[d.dataIndex];
        return d.x + (vx / maxVelocity) * arrowScale;
      })
      .attr('y2', d => {
        const [, vy] = velocities[d.dataIndex];
        return d.y + (vy / maxVelocity) * arrowScale;
      });

    // Update trajectory on right SVG
    const trajectoryGroup = rightSvg.select('#trajectory-group');
    trajectoryGroup.selectAll('*').remove();

    // Map timeIndex to allTimeSamples index
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
      rightSvg.select('#current-position')
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

      // Add pause at the end of animation cycle
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

  $: if (vectorFieldData && leftSvgElement && rightSvgElement && !isInitialized) {
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
  <DoubleFigure {caption}>
    {#snippet left()}
      <PlayButton {isPlaying} onclick={togglePlayPause} time={normalizedTime} />
      <svg
        bind:this={leftSvgElement}
        viewBox="0 0 {svgWidth} {svgHeight}"
        preserveAspectRatio="xMidYMid meet"
        style="width: 100%; height: auto; max-width: {svgWidth}px;">
      </svg>
    {/snippet}

    {#snippet right()}
      <svg
        bind:this={rightSvgElement}
        viewBox="0 0 {svgWidth} {svgHeight}"
        preserveAspectRatio="xMidYMid meet"
        style="width: 100%; height: auto; max-width: {svgWidth}px;">
      </svg>
    {/snippet}
  </DoubleFigure>
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
