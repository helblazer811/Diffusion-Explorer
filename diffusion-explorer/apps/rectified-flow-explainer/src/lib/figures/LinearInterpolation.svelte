<!-- Visualizes linear interpolation between source and target distributions with an animated dot. -->

<script>
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import Figure from '$lib/components/Figure.svelte';
  import TimeSlider from '$lib/components/TimeSlider.svelte';
  import { plotKatexInSVG } from '@diffusion-explorer/ui';
  import { settings } from '$lib/settings';
  import { plotSourceTargetScatter, plotSourceTargetLabels, createSourceTargetScales } from '$lib/d3_helpers';

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
  export let sourcePointColor = settings.scatterPlotStyling.color;
  export let targetPointColor = settings.scatterPlotStyling.color;
  export let lineColor = '#f17720';
  export let animatedDotColor = '#f17720';

  // Animation
  export let animationDuration = 4000;
  export let pauseDuration = 500;
  export let playingByDefault = true;

  // Layout/Styling
  export let width = 800;
  export let height = 275;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let flowWidth = 10;
  export let pointRadius = settings.scatterPlotStyling.radius;
  export let pointOpacity = settings.scatterPlotStyling.opacity;
  export let yShiftFactor = settings.scatterPlotStyling.yShiftFactor;
  export let lineWidth = 3;
  export let animatedDotRadius = 6;
  export let labelFontSize = settings.labelStyling.fontSize;
  export let labelColor = settings.labelStyling.color;
  export let outlineColor = settings.labelStyling.outlineColor;
  export let outlineOpacity = settings.labelStyling.outlineOpacity;
  export let sourceLabelText = 'Source Distribution';
  export let targetLabelText = 'Target Distribution';
  export let pointLabelFontSize = 18;
  export let pointLabelBgOpacity = 0.9;
  export let figureLatexColor = settings.figureLatexStyling.color;

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

  // Visibility-based animation control
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

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
    plotKatexInSVG(labelGroup, 'x_0', sourceX - 18, sourceY - 50, { fontSize: pointLabelFontSize, bg: false, color: figureLatexColor });

    // x_1 label above target point
    const targetX = xScale(targetPoint[0] + flowWidth);
    const targetY = yScale(targetPoint[1]);
    plotKatexInSVG(labelGroup, 'x_1', targetX - 18, targetY - 50, { fontSize: pointLabelFontSize, bg: false, color: figureLatexColor });
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

  function plotLabels() {
    if (!svgElement || !xScale || !yScale) return;

    const svg = d3.select(svgElement);
    const labelsGroup = svg.select('#labels');

    // Source and target distribution labels at top
    plotSourceTargetLabels(svg, xScale, yScale, {
      flowWidth,
      sourceLabelText,
      targetLabelText,
      labelFontSize,
      labelColor,
      outlineColor,
      outlineOpacity
    });

    // Formula at bottom center
    const formulaX = width / 2;
    const formulaY = height - marginHeight - 10;
    plotKatexInSVG(labelsGroup, 'x_t \\sim X_t = (1-t)X_0 + tX_1', formulaX - 130, formulaY - 30, { fontSize: pointLabelFontSize, bg: false, color: figureLatexColor });
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
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.5);

    lineGroup.append('circle')
      .attr('cx', x2)
      .attr('cy', y2)
      .attr('r', pointRadius)
      .attr('fill', animatedDotColor)
      .attr('stroke', 'white')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.5);
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
    const g = plotKatexInSVG(labelGroup, 'x_t', initialX - 18, initialY - 50, { fontSize: pointLabelFontSize, bg: false, color: figureLatexColor });
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
    const scales = createSourceTargetScales(sourceDistributionSamples, targetDistributionSamples, {
      width, height, marginWidth, marginHeight, flowWidth, yShiftFactor
    });
    xScale = scales.xScale;
    yScale = scales.yScale;
    const svg = d3.select(svgElement);
    plotSourceTargetScatter(svg, sourceDistributionSamples, targetDistributionSamples, xScale, yScale, {
      flowWidth,
      sourcePointColor,
      targetPointColor,
      pointRadius,
      pointOpacity
    });
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

<Figure caption={caption} bind:isActive={figureIsActive}>
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
