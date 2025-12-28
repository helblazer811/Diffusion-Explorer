<!-- Visualizes Euler's method on a circular vector field -->

<script>
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import Figure from '$lib/components/Figure.svelte';
  import TimeSlider from '$lib/components/TimeSlider.svelte';
  import {
    createEllipticalVectorField,
    generateEulerTrajectory,
    generateVectorFieldGrid,
    computeMaxVelocity
  } from '$lib/euler_circle';

  // Ellipse parameters (semi-major axis a=2, semi-minor axis b=1)
  const ellipseA = 2;
  const ellipseB = 1;
  const ellipticalVectorField = createEllipticalVectorField(ellipseA, ellipseB);

  // Caption slot
  export let children = undefined;
  $: caption = children;

  // Layout props
  export let width = 600;
  export let height = 400;
  export let margin = 40;

  // Vector field props
  export let gridResolutionX = 12;
  export let gridResolutionY = 8;
  export let arrowScale = 40;
  export let arrowColor = '#3b82f6';
  export let arrowOpacity = 0.7;
  export let arrowThickness = 2.0;

  // Trajectory props
  export let startPoint = [2, 0];  // Start on the ellipse (a=2)
  let stepSize = 0.1;
  export let numSteps = 63;
  export let trajectoryColor = '#f17720';
  export let trajectoryWidth = 3;
  export let pointRadius = 6;
  export let pointColor = '#f17720';

  // Animation props
  export let animationDuration = 6000;
  export let playingByDefault = true;
  export let backgroundVisible = true;

  // Domain range (wider for ellipse)
  const domainRange = { xMin: -4, xMax: 4, yMin: -2, yMax: 2 };

  // State
  let svgElement;
  let time = 0;
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let animationStartTime = null;
  let isInitialized = false;
  let totalPathLength = 0;

  // Generate data
  $: vectorFieldData = generateVectorFieldGrid(gridResolutionX, gridResolutionY, domainRange, ellipticalVectorField);
  $: trajectory = generateEulerTrajectory(startPoint, stepSize, numSteps, ellipticalVectorField);
  $: maxVelocity = computeMaxVelocity(vectorFieldData.velocities);

  // Scales
  $: xScale = d3.scaleLinear()
    .domain([domainRange.xMin, domainRange.xMax])
    .range([margin, width - margin]);

  $: yScale = d3.scaleLinear()
    .domain([domainRange.yMin, domainRange.yMax])
    .range([height - margin, margin]);

  // Generate SVG path from trajectory
  $: trajectoryPath = trajectory.length > 0
    ? d3.line()
        .x(d => xScale(d[0]))
        .y(d => yScale(d[1]))(trajectory)
    : '';

  function toggleAnimation() {
    isPlaying = !isPlaying;
  }

  function handleSliderInput() {
    const now = performance.now();
    animationStartTime = now - (time * animationDuration);
  }

  function initializeVisualization() {
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();

    // Add arrow marker definition
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'arrow-marker')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 8)
      .attr('refY', 0)
      .attr('markerWidth', 4)
      .attr('markerHeight', 4)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', arrowColor);

    // Draw vector field arrows
    const arrowsGroup = svg.append('g').attr('id', 'arrows');

    vectorFieldData.gridPoints.forEach((point, i) => {
      const [x, y] = point;
      const [vx, vy] = vectorFieldData.velocities[i];
      const mag = Math.sqrt(vx * vx + vy * vy);

      if (mag > 0.01) {
        const scale = arrowScale / maxVelocity;
        arrowsGroup.append('line')
          .attr('x1', xScale(x))
          .attr('y1', yScale(y))
          .attr('x2', xScale(x) + vx * scale)
          .attr('y2', yScale(y) - vy * scale)  // Negative because SVG y is flipped
          .attr('stroke', arrowColor)
          .attr('stroke-width', arrowThickness)
          .attr('stroke-opacity', arrowOpacity)
          .attr('marker-end', 'url(#arrow-marker)');
      }
    });

    // Draw trajectory background (full path, lighter)
    svg.append('path')
      .attr('id', 'trajectory-bg')
      .attr('d', trajectoryPath)
      .attr('fill', 'none')
      .attr('stroke', trajectoryColor)
      .attr('stroke-width', trajectoryWidth)
      .attr('stroke-opacity', 0.2);

    // Draw trajectory progress (animated)
    const progressPath = svg.append('path')
      .attr('id', 'trajectory-progress')
      .attr('d', trajectoryPath)
      .attr('fill', 'none')
      .attr('stroke', trajectoryColor)
      .attr('stroke-width', trajectoryWidth)
      .attr('stroke-linecap', 'round');

    // Get total path length for animation
    totalPathLength = progressPath.node().getTotalLength();

    progressPath
      .attr('stroke-dasharray', totalPathLength)
      .attr('stroke-dashoffset', totalPathLength);

    // Draw current position marker
    svg.append('circle')
      .attr('id', 'position-marker')
      .attr('r', pointRadius)
      .attr('fill', pointColor)
      .attr('cx', xScale(trajectory[0][0]))
      .attr('cy', yScale(trajectory[0][1]));

    isInitialized = true;
  }

  function updateVisualization() {
    if (!svgElement || !isInitialized) return;

    const svg = d3.select(svgElement);
    const visibleLength = totalPathLength * time;

    // Update trajectory progress
    svg.select('#trajectory-progress')
      .attr('stroke-dashoffset', totalPathLength - visibleLength);

    // Update position marker
    const pathElement = svg.select('#trajectory-progress').node();
    if (pathElement && visibleLength > 0) {
      const point = pathElement.getPointAtLength(visibleLength);
      svg.select('#position-marker')
        .attr('cx', point.x)
        .attr('cy', point.y);
    } else {
      svg.select('#position-marker')
        .attr('cx', xScale(trajectory[0][0]))
        .attr('cy', yScale(trajectory[0][1]));
    }
  }

  function startAnimation() {
    function animate(currentTime) {
      if (!isPlaying) {
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      if (animationStartTime === null) {
        animationStartTime = currentTime;
      }

      const elapsed = currentTime - animationStartTime;
      time = Math.min(elapsed / animationDuration, 1);

      if (time >= 1) {
        // Reset animation with random step size
        animationStartTime = currentTime;
        time = 0;
        stepSize = Math.round((0.01 + Math.random() * (0.15 - 0.01)) * 100) / 100;
      }

      updateVisualization();
      animationFrameId = requestAnimationFrame(animate);
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  $: if (isInitialized) {
    updateVisualization();
  }

  // Reinitialize when stepSize changes
  $: if (isInitialized && stepSize) {
    initializeVisualization();
  }

  function handleStepSizeInput(event) {
    stepSize = parseFloat(event.target.value);
  }

  onMount(() => {
    initializeVisualization();
    startAnimation();

    return () => {
      stopAnimation();
    };
  });
</script>

<Figure {caption} {backgroundVisible} onContentClick={toggleAnimation}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <svg
        bind:this={svgElement}
        viewBox="0 0 {width} {height}"
        preserveAspectRatio="xMidYMid meet"
        style="width: 100%; height: auto; max-width: {width}px;"
      >
      </svg>
      <TimeSlider
        bind:value={time}
        bind:isPlaying={isPlaying}
        min={0}
        max={1}
        onTogglePlay={toggleAnimation}
        onInput={handleSliderInput}
        color={trajectoryColor}
      />
      <div class="step-slider-container">
        <div class="step-slider-inner">
          <input
            type="range"
            class="step-slider"
            min="0.01"
            max="0.15"
            step="0.01"
            value={stepSize}
            oninput={handleStepSizeInput}
            style="--slider-color: {trajectoryColor}; background: linear-gradient(to right, {trajectoryColor} {((stepSize - 0.01) / (0.15 - 0.01)) * 100}%, #d3d3d3 {((stepSize - 0.01) / (0.15 - 0.01)) * 100}%);"
          />
          <div class="step-tick-container">
            <div class="step-tick" style="left: 1%;"></div>
            <div class="step-tick-label" style="left: 1%;">0.01</div>
            <div class="step-slider-label">Step Size: {stepSize.toFixed(2)}</div>
            <div class="step-tick" style="left: 99%;"></div>
            <div class="step-tick-label" style="left: 99%;">0.15</div>
          </div>
        </div>
      </div>
    </div>
  {/snippet}
</Figure>

<style>
  .step-slider-container {
    width: 100%;
    max-width: 600px;
    padding: 10px 44px 5px 44px;
    margin-top: 20px;
    margin-left: auto;
    margin-right: auto;
    box-sizing: border-box;
  }

  .step-slider-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  .step-tick-container {
    position: relative;
    width: 100%;
    height: 20px;
    margin-top: 2px;
  }

  .step-tick {
    position: absolute;
    top: 0;
    width: 2px;
    height: 10px;
    background-color: #7b7b7b;
  }

  .step-tick-label {
    position: absolute;
    top: 12px;
    font-size: 16px;
    transform: translateX(-50%);
    font-family: Helvetica, sans-serif;
    color: #7b7b7b;
  }

  .step-slider-label {
    position: absolute;
    left: 50%;
    top: 0;
    transform: translateX(-50%);
    font-size: 16px;
    font-family: Helvetica, sans-serif;
    color: #7b7b7b;
  }

  .step-slider {
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

  .step-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    background: var(--slider-color, #f17720);
    border-radius: 50%;
    cursor: pointer;
  }

  .step-slider::-moz-range-thumb {
    width: 10px;
    height: 10px;
    background: var(--slider-color, #f17720);
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }
</style>
