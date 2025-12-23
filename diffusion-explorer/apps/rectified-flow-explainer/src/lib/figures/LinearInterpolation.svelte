<!-- Visualizes linear interpolation between source and target distributions with an animated dot. -->

<script>
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import Figure from '$lib/components/Figure.svelte';
  import TimeSlider from '$lib/components/TimeSlider.svelte';
  import { plotKatexInSVG } from '@diffusion-explorer/ui';

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];

  // Point selection for the line
  export let sourcePointIndex = 0;
  export let targetPointIndex = 0;

  // Colors
  export let sourcePointColor = '#3b82f6';
  export let targetPointColor = '#3b82f6';
  export let lineColor = '#f17720';
  export let animatedDotColor = '#f17720';

  // Animation
  export let animationDuration = 4000;
  export let pauseDuration = 500;
  export let playingByDefault = true;

  // Layout/Styling
  export let width = 800;
  export let height = 300;
  export let marginWidth = 20;
  export let marginHeight = 0;
  export let flowWidth = 10;
  export let pointRadius = 5;
  export let pointOpacity = 0.25;
  export let lineWidth = 3;
  export let animatedDotRadius = 6;
  export let labelFontSize = 22;
  export let labelColor = '#666';
  export let sourceLabelText = 'Source Distribution';
  export let targetLabelText = 'Target Distribution';
  export let pointLabelFontSize = 18;
  export let pointLabelBgOpacity = 0.9;
  export let latexLabelColor = '#111';

  // SVG and scale state
  let svgElement;
  let xScale = null;
  let yScale = null;

  // Animation state
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let time = 0.5;
  let direction = 1; // 1 = forward, -1 = backward
  let isPaused = false;
  let pauseStartTime = null;
  let lastTimestamp = null;
  let isInitialized = false;

  function toggleAnimation() {
    isPlaying = !isPlaying;
  }

  function plotPointLabel() {
    if (!svgElement || !xScale || !yScale) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    const svg = d3.select(svgElement);
    const labelGroup = svg.select('#pointLabels');

    const sourcePoint = sourceDistributionSamples[sourcePointIndex];
    const targetPoint = targetDistributionSamples[targetPointIndex];
    if (!sourcePoint || !targetPoint) return;

    // x_0 label above source point
    const sourceX = xScale(sourcePoint[0]);
    const sourceY = yScale(sourcePoint[1]);
    plotKatexInSVG(labelGroup, 'x_0', sourceX - 18, sourceY - 50, { fontSize: pointLabelFontSize });

    // x_1 label above target point
    const targetX = xScale(targetPoint[0] + flowWidth);
    const targetY = yScale(targetPoint[1]);
    plotKatexInSVG(labelGroup, 'x_1', targetX - 18, targetY - 50, { fontSize: pointLabelFontSize });
  }

  function createScales(sourcePoints, targetPoints) {
    const drawableWidth = width - 2 * marginWidth;
    const drawableHeight = height - 2 * marginHeight;
    const aspectRatio = drawableHeight / drawableWidth;

    // Shift target points by flowWidth for extent calculation
    const shiftedTargetPoints = targetPoints.map(p => [p[0] + flowWidth, p[1]]);
    const allPoints = [...sourcePoints, ...shiftedTargetPoints];

    const xExtent = d3.extent(allPoints, d => d[0]);
    const yExtent = d3.extent(allPoints, d => d[1]);

    const xRange = xExtent[1] - xExtent[0];
    const yRange = yExtent[1] - yExtent[0];

    const xCenter = (xExtent[0] + xExtent[1]) / 2;
    const yCenter = (yExtent[0] + yExtent[1]) / 2;

    let adjustedXRange = xRange;
    let adjustedYRange = yRange;

    if (yRange / xRange > aspectRatio) {
      adjustedXRange = yRange / aspectRatio;
    } else {
      adjustedYRange = xRange * aspectRatio;
    }

    const yCenterOffset = -adjustedYRange * 0.07;

    xScale = d3.scaleLinear()
      .domain([xCenter - adjustedXRange / 2, xCenter + adjustedXRange / 2])
      .range([marginWidth, width - marginWidth]);

    yScale = d3.scaleLinear()
      .domain([yCenter - adjustedYRange / 2 - yCenterOffset, yCenter + adjustedYRange / 2 - yCenterOffset])
      .range([marginHeight, height - marginHeight]);
  }

  function initializeLayers() {
    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();
    svg.append('g').attr('id', 'sourceScatter');
    svg.append('g').attr('id', 'targetScatter');
    svg.append('g').attr('id', 'connectionLine');
    svg.append('g').attr('id', 'animatedDot');
    svg.append('g').attr('id', 'movingLabel');
    svg.append('g').attr('id', 'pointLabels');
    svg.append('g').attr('id', 'labels');
  }

  function plotScatter(points, color, groupId, xShift = 0) {
    if (!svgElement || !xScale || !yScale || points.length === 0) return;

    const svg = d3.select(svgElement);
    const group = svg.select(`#${groupId}`);

    group.selectAll('circle')
      .data(points)
      .enter()
      .append('circle')
      .attr('cx', d => xScale(d[0] + xShift))
      .attr('cy', d => yScale(d[1]))
      .attr('r', pointRadius)
      .attr('fill', color)
      .attr('opacity', pointOpacity);
  }

  function plotLabels() {
    if (!svgElement || !xScale || !yScale) return;

    const svg = d3.select(svgElement);
    const labelsGroup = svg.select('#labels');

    // Formula at bottom center
    const formulaX = width / 2;
    const formulaY = height - marginHeight - 10;
    plotKatexInSVG(labelsGroup, 'x_t \\sim X_t = (1-t)X_0 + tX_1', formulaX - 90, formulaY - 30, { fontSize: pointLabelFontSize });
  }

  function plotLine() {
    if (!svgElement || !xScale || !yScale) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    const svg = d3.select(svgElement);
    const lineGroup = svg.select('#connectionLine');

    const sourcePoint = sourceDistributionSamples[sourcePointIndex];
    const targetPoint = targetDistributionSamples[targetPointIndex];

    if (!sourcePoint || !targetPoint) return;

    const x1 = xScale(sourcePoint[0]);
    const y1 = yScale(sourcePoint[1]);
    const x2 = xScale(targetPoint[0] + flowWidth);
    const y2 = yScale(targetPoint[1]);

    lineGroup.append('line')
      .attr('x1', x1)
      .attr('y1', y1)
      .attr('x2', x2)
      .attr('y2', y2)
      .attr('stroke', lineColor)
      .attr('stroke-width', lineWidth)
      .attr('opacity', 0.8);

    // Orange endpoints on the line
    lineGroup.append('circle')
      .attr('cx', x1)
      .attr('cy', y1)
      .attr('r', pointRadius)
      .attr('fill', animatedDotColor)
      .attr('stroke', 'white')
      .attr('stroke-width', 2);

    lineGroup.append('circle')
      .attr('cx', x2)
      .attr('cy', y2)
      .attr('r', pointRadius)
      .attr('fill', animatedDotColor)
      .attr('stroke', 'white')
      .attr('stroke-width', 2);
  }

  function initAnimatedDot() {
    if (!svgElement || !xScale || !yScale) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    const svg = d3.select(svgElement);
    const dotGroup = svg.select('#animatedDot');
    const labelGroup = svg.select('#movingLabel');

    const sourcePoint = sourceDistributionSamples[sourcePointIndex];
    if (!sourcePoint) return;

    const initialX = xScale(sourcePoint[0]);
    const initialY = yScale(sourcePoint[1]);

    dotGroup.append('circle')
      .attr('id', 'movingDot')
      .attr('cx', initialX)
      .attr('cy', initialY)
      .attr('r', animatedDotRadius)
      .attr('fill', animatedDotColor);

    // x_t label above moving dot
    const g = plotKatexInSVG(labelGroup, 'x_t', initialX - 18, initialY - 50, { fontSize: pointLabelFontSize });
    g.attr('id', 'movingLabelGroup');
  }

  function updateDotPosition(progress) {
    if (!svgElement || !xScale || !yScale) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    const svg = d3.select(svgElement);
    const dot = svg.select('#movingDot');
    const labelGroup = svg.select('#movingLabelGroup');

    const sourcePoint = sourceDistributionSamples[sourcePointIndex];
    const targetPoint = targetDistributionSamples[targetPointIndex];

    if (!sourcePoint || !targetPoint) return;

    const x1 = xScale(sourcePoint[0]);
    const y1 = yScale(sourcePoint[1]);
    const x2 = xScale(targetPoint[0] + flowWidth);
    const y2 = yScale(targetPoint[1]);

    const currentX = x1 + progress * (x2 - x1);
    const currentY = y1 + progress * (y2 - y1);

    dot.attr('cx', currentX).attr('cy', currentY);

    // Update x_t label position via transform, hide when outside 0.07-0.93
    const labelVisible = progress >= 0.07 && progress <= 0.93;
    labelGroup
      .attr('transform', `translate(${currentX - 18}, ${currentY - 50})`)
      .attr('opacity', labelVisible ? 1 : 0);
  }

  function animate(timestamp) {
    if (!isPlaying) {
      animationFrameId = null;
      return;
    }

    if (lastTimestamp === null) {
      lastTimestamp = timestamp;
    }

    const elapsed = timestamp - lastTimestamp;

    // Handle pause at endpoints
    if (isPaused && pauseStartTime !== null) {
      const pauseElapsed = timestamp - pauseStartTime;
      if (pauseElapsed >= pauseDuration) {
        isPaused = false;
        pauseStartTime = null;
        lastTimestamp = timestamp;
        direction = -direction;
      }
      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    // Update time based on direction
    const deltaTime = elapsed / animationDuration;
    time += direction * deltaTime;

    // Clamp and handle endpoint pause
    if (time >= 1.0) {
      time = 1.0;
      isPaused = true;
      pauseStartTime = timestamp;
    } else if (time <= 0.0) {
      time = 0.0;
      isPaused = true;
      pauseStartTime = timestamp;
    }

    updateDotPosition(time);
    lastTimestamp = timestamp;
    animationFrameId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (animationFrameId !== null) return;
    lastTimestamp = null;
    animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function initializeVisualization() {
    if (!svgElement) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    initializeLayers();
    createScales(sourceDistributionSamples, targetDistributionSamples);
    plotScatter(sourceDistributionSamples, sourcePointColor, 'sourceScatter', 0);
    plotScatter(targetDistributionSamples, targetPointColor, 'targetScatter', flowWidth);
    plotLine();
    initAnimatedDot();
    plotPointLabel();
    plotLabels();
    updateDotPosition(time);
    isInitialized = true;
  }

  // Reactive initialization
  $: if (!isInitialized &&
         sourceDistributionSamples.length > 0 &&
         targetDistributionSamples.length > 0 &&
         svgElement) {
    initializeVisualization();
    if (isPlaying) startAnimation();
  }

  // Handle play/pause changes
  $: if (isPlaying && !animationFrameId && isInitialized) {
    startAnimation();
  }

  $: if (!isPlaying && animationFrameId) {
    stopAnimation();
  }

  // Update dot position when time changes (e.g., from slider drag)
  $: if (isInitialized) {
    updateDotPosition(time);
  }

  onMount(() => {
    return () => {
      stopAnimation();
    };
  });
</script>

<Figure caption={caption} inline={true}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; max-width: {width}px;">
      </svg>
      <TimeSlider
        bind:value={time}
        bind:isPlaying={isPlaying}
        min={0}
        max={1}
        onTogglePlay={toggleAnimation}
        color="#f17720"
      />
    </div>
  {/snippet}
</Figure>
