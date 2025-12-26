<!-- Compares flow matching vector field (curved) vs rectified flow vector field (straighter) -->

<script>
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import DoubleFigure from '$lib/components/DoubleFigure.svelte';
  import TimeSlider from '$lib/components/TimeSlider.svelte';
  import { settings } from '$lib/settings';

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props
  export let flowMatchingVectorField = null;
  export let rectifiedFlowVectorField = null;

  // Data validation
  $: isDataValid =
    flowMatchingVectorField &&
    flowMatchingVectorField.velocities &&
    flowMatchingVectorField.velocities.length > 0 &&
    rectifiedFlowVectorField &&
    rectifiedFlowVectorField.velocities &&
    rectifiedFlowVectorField.velocities.length > 0;

  // Layout props
  export let svgWidth = 350;
  export let svgHeight = 350;
  export let marginWidth = 40;
  export let marginTop = 50;
  export let marginBottom = 10;
  export let gap = 30;

  // Label props
  export let leftLabel = 'Flow Matching';
  export let rightLabel = 'Rectified Flow';
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;

  // Arrow styling
  export let arrowColor = '#f17720';
  export let arrowScale = 35;
  export let arrowWidth = 2;
  export let arrowOpacity = 0.7;
  export let normalizeVectors = false;

  // Animation settings
  export let animationDuration = 8000;
  export let playingByDefault = true;
  export let animationPauseTime = 1000;

  // Background visibility
  export let backgroundVisible = true;

  // SVG references
  let leftSvgElement;
  let rightSvgElement;

  // Scales
  let leftScales = null;
  let rightScales = null;

  // Pre-calculated grid positions
  let leftGridPositions = [];
  let rightGridPositions = [];

  // Animation state
  let time = 0;
  let animationFrameId = null;
  let animationStartTime = null;
  let isPlaying = playingByDefault;
  let isPausedByFigure = false;
  let isInitialized = false;

  // Visibility-based animation control
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // Update isPausedByFigure when isPlaying changes
  $: isPausedByFigure = !isPlaying;

  // Pause animation when figure goes off-screen, resume when back
  $: if (figureIsActive && isInitialized) {
    if (!$figureIsActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false;
    } else if ($figureIsActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true;
    }
  }

  function toggleAnimation() {
    isPlaying = !isPlaying;
  }

  function handleSliderInput() {
    // Sync animation start time so it continues from the new slider position
    const now = performance.now();
    animationStartTime = now - (time * animationDuration);
  }

  function initializeScales(vectorFieldData) {
    if (!vectorFieldData) return null;

    const { xMin, xMax, yMin, yMax } = vectorFieldData.domainRange;

    const xScale = d3.scaleLinear()
      .domain([xMin, xMax])
      .range([marginWidth, svgWidth - marginWidth]);

    const yScale = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([marginTop, svgHeight - marginBottom]);

    return { xScale, yScale };
  }

  function calculateGridPositions(vectorFieldData, scales) {
    if (!vectorFieldData || !vectorFieldData.gridPoints || !scales) return [];

    return vectorFieldData.gridPoints.map((point, index) => ({
      x: scales.xScale(point[0]),
      y: scales.yScale(point[1]),
      dataIndex: index
    }));
  }

  function calculateMaxVelocity(velocities) {
    let max = 0;
    for (const [vx, vy] of velocities) {
      const magnitude = Math.sqrt(vx * vx + vy * vy);
      if (magnitude > max) max = magnitude;
    }
    return max || 1;
  }

  function createArrowMarker(svg, markerId) {
    const defs = svg.select('defs').empty() ? svg.append('defs') : svg.select('defs');

    defs.select(`#${markerId}`).remove();

    defs.append('marker')
      .attr('id', markerId)
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
  }

  function plotPanelLabel(svgElement, label) {
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    svg.select('.panel-label').remove();

    const labelGroup = svg.append('g').attr('class', 'panel-label');
    const labelX = svgWidth / 2;
    const labelY = 1.0 * labelFontSize;

    labelGroup
      .append('text')
      .attr('x', labelX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${labelFontSize}px`)
      .attr('fill', labelColor)
      .text(label);
  }

  function initializePanel(svgElement, gridPositions, markerId, label) {
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();

    // Create arrow marker
    createArrowMarker(svg, markerId);

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
      .attr('marker-end', `url(#${markerId})`);

    // Plot panel label
    plotPanelLabel(svgElement, label);
  }

  function updateVectorField(svgElement, vectorFieldData, gridPositions, timeIndex) {
    if (!svgElement || !vectorFieldData) return;

    const svg = d3.select(svgElement);
    const velocities = vectorFieldData.velocities[timeIndex];
    const maxVelocity = calculateMaxVelocity(velocities);

    svg.select('#arrows').selectAll('line')
      .data(gridPositions)
      .attr('x1', d => d.x)
      .attr('y1', d => d.y)
      .attr('x2', d => {
        const [vx, vy] = velocities[d.dataIndex];
        if (normalizeVectors) {
          const magnitude = Math.sqrt(vx * vx + vy * vy);
          if (magnitude === 0) return d.x;
          return d.x + (vx / magnitude) * arrowScale;
        }
        return d.x + (vx / maxVelocity) * arrowScale;
      })
      .attr('y2', d => {
        const [vx, vy] = velocities[d.dataIndex];
        if (normalizeVectors) {
          const magnitude = Math.sqrt(vx * vx + vy * vy);
          if (magnitude === 0) return d.y;
          return d.y + (vy / magnitude) * arrowScale;
        }
        return d.y + (vy / maxVelocity) * arrowScale;
      });
  }

  function draw() {
    if (!leftSvgElement || !rightSvgElement || !isDataValid) return;

    // Map time (0-1) to time indices for each vector field
    const leftNumSteps = flowMatchingVectorField.timeSteps.length;
    const rightNumSteps = rectifiedFlowVectorField.timeSteps.length;

    const leftTimeIndex = Math.min(Math.floor(time * leftNumSteps), leftNumSteps - 1);
    const rightTimeIndex = Math.min(Math.floor(time * rightNumSteps), rightNumSteps - 1);

    updateVectorField(leftSvgElement, flowMatchingVectorField, leftGridPositions, leftTimeIndex);
    updateVectorField(rightSvgElement, rectifiedFlowVectorField, rightGridPositions, rightTimeIndex);
  }

  function initializeVisualization() {
    if (!leftSvgElement || !rightSvgElement || !isDataValid) return;

    // Initialize scales for each panel
    leftScales = initializeScales(flowMatchingVectorField);
    rightScales = initializeScales(rectifiedFlowVectorField);

    // Calculate grid positions
    leftGridPositions = calculateGridPositions(flowMatchingVectorField, leftScales);
    rightGridPositions = calculateGridPositions(rectifiedFlowVectorField, rightScales);

    // Initialize panels
    initializePanel(leftSvgElement, leftGridPositions, 'arrow-left', leftLabel);
    initializePanel(rightSvgElement, rightGridPositions, 'arrow-right', rightLabel);

    // Initial draw
    draw();
  }

  function startAnimation() {
    let isPaused = false;
    let pauseStartTime = null;
    let pausedElapsedTime = 0;

    function animate(currentTime) {
      if (isPausedByFigure) {
        if (animationStartTime !== null && pausedElapsedTime === 0) {
          pausedElapsedTime = currentTime - animationStartTime;
        }
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      if (pausedElapsedTime > 0) {
        animationStartTime = currentTime - pausedElapsedTime;
        pausedElapsedTime = 0;
      }

      if (animationStartTime === null) {
        animationStartTime = currentTime;
      }

      const elapsed = currentTime - animationStartTime;

      if (elapsed >= animationDuration) {
        if (!isPaused) {
          isPaused = true;
          pauseStartTime = currentTime;
          time = 1;
          draw();
        }

        if (pauseStartTime && currentTime - pauseStartTime >= animationPauseTime) {
          animationStartTime = currentTime;
          isPaused = false;
          pauseStartTime = null;
          time = 0;
        }
      } else {
        time = Math.min(elapsed / animationDuration, 1);
        draw();
      }

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

  // Update visualization when time changes (e.g., from slider drag)
  $: if (isInitialized) {
    draw();
  }

  // React to data changes and initialize visualization once
  $: if (!isInitialized && isDataValid && leftSvgElement && rightSvgElement) {
    initializeVisualization();
    startAnimation();
    isInitialized = true;
  }

  // Cleanup on component destroy
  onMount(() => {
    return () => {
      stopAnimation();
    };
  });
</script>

{#if isDataValid}
  <DoubleFigure {gap} {caption} {backgroundVisible} bind:isActive={figureIsActive}>
    {#snippet left()}
      <svg
        bind:this={leftSvgElement}
        viewBox="0 0 {svgWidth} {svgHeight}"
        preserveAspectRatio="xMidYMid meet"
        style="width: 100%; height: auto; max-width: {svgWidth}px;"
      >
      </svg>
    {/snippet}

    {#snippet right()}
      <svg
        bind:this={rightSvgElement}
        viewBox="0 0 {svgWidth} {svgHeight}"
        preserveAspectRatio="xMidYMid meet"
        style="width: 100%; height: auto; max-width: {svgWidth}px;"
      >
      </svg>
    {/snippet}

    {#snippet footer()}
      <TimeSlider
        bind:value={time}
        bind:isPlaying={isPlaying}
        min={0}
        max={1}
        onTogglePlay={toggleAnimation}
        onInput={handleSliderInput}
        color="#f17720"
      />
    {/snippet}
  </DoubleFigure>
{:else}
  <div class="placeholder">
    <p>Vector field comparison requires both flow matching and rectified flow vector field data.</p>
  </div>
{/if}

<style>
  .placeholder {
    padding: 2rem;
    text-align: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    color: #666;
  }
</style>
