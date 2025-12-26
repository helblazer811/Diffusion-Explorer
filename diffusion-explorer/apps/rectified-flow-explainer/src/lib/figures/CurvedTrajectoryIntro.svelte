<!-- This figure shows curved trajectories from flow matching, demonstrating non-straight paths. -->

<script>
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import Figure from '$lib/components/Figure.svelte';
  import TimeSlider from '$lib/components/TimeSlider.svelte';
  import { settings } from '$lib/settings';
  import { plotSourceTargetLabels, createSourceTargetScales } from '$lib/d3_helpers';

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props (from parent +page.svelte)
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];
  export let allTimeSamples;
  export let isTraining;

  // Props/Configuration
  export let width = 750;
  export let height = 275;

  // Trajectory props
  export let numTrajectories = 20; // Number of trajectories to display

  // Styling props for visualization
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceLabelText = 'Source Distribution';
  export let targetLabelText = 'Target Distribution';
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;
  export let outlineColor = settings.stylingSettings.label.outlineColor;
  export let outlineOpacity = settings.stylingSettings.label.outlineOpacity;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let flowWidth = 10; // Gap between source and target in data units
  export let yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;

  // Animation settings
  export let animationDuration = 8000; // Duration in milliseconds
  export let playingByDefault = true;
  export let animationPauseTime = 1000; // Pause time between loops in milliseconds

  // Trajectory styling props
  export let trajectoryColor = '#f17720'; // Orange
  export let trajectoryFullOpacity = 0.4;
  export let trajectoryProgressOpacity = 0.8;
  export let trajectoryStrokeWidth = 2;
  export let trajectoryPointRadius = 4;
  export let trainingObjective = 'Flow Matching';

  // Visibility controls for each visualization element
  export let showSourceScatter = true;
  export let showTargetScatter = true;

  // Selected trajectory indices (visualization-specific state)
  let selectedTrajectoryIndices = [];
  let svgElement;
  let xScale = null;
  let yScale = null;
  let time = 0; // Animation time parameter (0 to 1)
  let animationFrameId = null;
  let trajectoryLengths = new Map(); // Cache total path lengths

  // Local animation control state
  let isPlaying = playingByDefault;
  let isPausedByFigure = false;

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

  /**
   * Randomly select a subset of trajectory indices to display
   * @param numSamples - Total number of available trajectories
   * @param numToSelect - Number of trajectories to display
   * @returns Array of selected indices
   */
  function selectTrajectoryIndices(numSamples, numToSelect) {
    // If requesting more than available, return all indices
    if (numToSelect >= numSamples) {
      return Array.from({ length: numSamples }, (_, i) => i);
    }

    // Use uniform spacing for better coverage
    const step = numSamples / numToSelect;
    const indices = [];
    for (let i = 0; i < numToSelect; i++) {
      indices.push(Math.floor(i * step));
    }

    return indices;
  }

  /**
   * Generate SVG path data for a trajectory
   * @param trajectoryIndex - Index of the sample to trace
   * @param endStep - Final timestep to include (for progress path)
   * @returns SVG path data string ("M x,y L x,y L x,y ...")
   */
  function generateTrajectoryPath(trajectoryIndex, endStep = null) {
    const allSamples = $allTimeSamples;
    if (!allSamples || allSamples.length === 0) return '';

    const maxStep = endStep !== null ? endStep : allSamples.length - 1;
    const pathData = [];

    for (let step = 0; step <= maxStep; step++) {
      const samples = allSamples[step];
      if (!samples || !samples[trajectoryIndex]) continue;

      const [x, y] = samples[trajectoryIndex];
      // Apply x-shift based on time progression
      const timeAtStep = step / (allSamples.length - 1);
      const xShifted = x + timeAtStep * flowWidth;

      // Transform to SVG coordinates
      const svgX = xScale(xShifted);
      const svgY = yScale(y);

      if (step === 0) {
        pathData.push(`M ${svgX},${svgY}`);
      } else {
        pathData.push(`L ${svgX},${svgY}`);
      }
    }

    return pathData.join(' ');
  }

  /**
   * Initialize trajectory paths in the SVG
   */
  function initTrajectories() {
    const svg = d3.select(svgElement);
    const trajectoryGroup = svg.select('#trajectories');

    // Create full path (background) and progress path (foreground) for each trajectory
    selectedTrajectoryIndices.forEach(idx => {
      // Generate the full trajectory path once
      const fullPath = generateTrajectoryPath(idx, null);

      // Full trajectory path (lighter, always complete)
      trajectoryGroup
        .append('path')
        .attr('class', `trajectory-full-${idx}`)
        .attr('d', fullPath)
        .attr('stroke', trajectoryColor)
        .attr('stroke-width', trajectoryStrokeWidth)
        .attr('stroke-opacity', trajectoryFullOpacity)
        .attr('fill', 'none')
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');

      // Animated progress path using stroke-dasharray
      const progressPath = trajectoryGroup
        .append('path')
        .attr('class', `trajectory-progress-${idx}`)
        .attr('d', fullPath)  // Same path as background
        .attr('stroke', trajectoryColor)
        .attr('stroke-width', trajectoryStrokeWidth)
        .attr('stroke-opacity', trajectoryProgressOpacity)
        .attr('fill', 'none')
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');

      // Get the total path length for dasharray animation
      const totalLength = progressPath.node().getTotalLength();

      // Cache the path length for performance
      trajectoryLengths.set(idx, totalLength);

      // Set up stroke-dasharray animation
      progressPath
        .attr('stroke-dasharray', totalLength)
        .attr('stroke-dashoffset', totalLength);  // Start hidden

      // Current position marker
      trajectoryGroup
        .append('circle')
        .attr('class', `trajectory-point-${idx}`)
        .attr('r', trajectoryPointRadius)
        .attr('fill', trajectoryColor)
        .attr('fill-opacity', trajectoryProgressOpacity);
    });

    // Initial render at time=0
    updateTrajectories(0);
  }

  /**
   * Update trajectory visualization for current animation time
   * @param time - Normalized time from 0 to 1
   */
  function updateTrajectories(time) {
    const svg = d3.select(svgElement);
    const allSamples = $allTimeSamples;
    if (!allSamples || allSamples.length === 0) return;

    selectedTrajectoryIndices.forEach(idx => {
      // Get the total path length for this trajectory
      const totalLength = trajectoryLengths.get(idx) || 0;

      // Linear interpolation: reveal path proportional to time
      const visibleLength = totalLength * time;

      // dashoffset = totalLength - visibleLength reveals visibleLength of the path
      svg.select(`.trajectory-progress-${idx}`)
        .attr('stroke-dashoffset', totalLength - visibleLength);

      // Update current position marker at the end of the visible path
      const pathElement = svg.select(`.trajectory-progress-${idx}`).node();
      if (pathElement && totalLength > 0) {
        const point = pathElement.getPointAtLength(visibleLength);
        svg.select(`.trajectory-point-${idx}`)
          .attr('cx', point.x)
          .attr('cy', point.y);
      }
    });
  }


  function initializeLayers() {
    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();
    svg.append('g').attr('id', 'sourceScatter');
    svg.append('g').attr('id', 'targetScatter');
    svg.append('g').attr('id', 'trajectories');
    svg.append('g').attr('id', 'labels');
  }

  function initScatter(points, color, groupId, opacity = pointOpacity) {
    if (!svgElement || !xScale || !yScale || points.length === 0) return;
    const svg = d3.select(svgElement);
    const group = svg.select(`#${groupId}`);
    group.selectAll('circle').data(points).enter().append('circle')
      .attr('r', pointRadius).attr('fill', color).attr('opacity', opacity);
  }

  function updateScatter(points, groupId, time) {
    if (!svgElement || !xScale || !yScale || points.length === 0) return;
    const xShift = time * flowWidth;
    const svg = d3.select(svgElement);
    const group = svg.select(`#${groupId}`);
    group.selectAll('circle').data(points)
      .attr('cx', d => xScale(d[0] + xShift))
      .attr('cy', d => yScale(d[1]));
  }

  function plotLabels() {
    if (!svgElement || !xScale || !yScale) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    const svg = d3.select(svgElement);
    const labelsGroup = svg.select('#labels');
    labelsGroup.selectAll('*').remove();

    plotSourceTargetLabels(svg, xScale, yScale, {
      flowWidth,
      sourceLabelText,
      targetLabelText,
      labelFontSize,
      labelColor,
      outlineColor,
      outlineOpacity
    });
  }

  function draw() {
    if (!svgElement || !xScale || !yScale) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;
    if (showSourceScatter) updateScatter(sourceDistributionSamples, 'sourceScatter', 0);
    if (showTargetScatter) updateScatter(targetDistributionSamples, 'targetScatter', 1);
    updateTrajectories(time);
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

    if (showSourceScatter) initScatter(sourceDistributionSamples, sourcePointColor, 'sourceScatter');
    if (showTargetScatter) initScatter(targetDistributionSamples, targetPointColor, 'targetScatter');

    selectedTrajectoryIndices = selectTrajectoryIndices(sourceDistributionSamples.length, numTrajectories);
    initTrajectories();
    draw();
    plotLabels();
  }

  function startAnimation() {
    let startTime = null;
    let isPaused = false;
    let pauseStartTime = null;
    let pausedElapsedTime = 0;

    function animate(currentTime) {
      if (isPausedByFigure) {
        if (startTime !== null && pausedElapsedTime === 0) {
          pausedElapsedTime = currentTime - startTime;
        }
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      if (pausedElapsedTime > 0) {
        startTime = currentTime - pausedElapsedTime;
        pausedElapsedTime = 0;
      }

      if (startTime === null) startTime = currentTime;
      const elapsed = currentTime - startTime;

      if (elapsed >= animationDuration) {
        if (!isPaused) {
          isPaused = true;
          pauseStartTime = currentTime;
          time = 1;
          draw();
        }
        if (pauseStartTime && currentTime - pauseStartTime >= animationPauseTime) {
          startTime = currentTime;
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

  // Reactive initialization flag
  let isInitialized = false;

  // Update visualization when time changes (e.g., from slider drag)
  $: if (isInitialized) {
    draw();
  }

  // React to data changes and initialize visualization once
  $: if (!isInitialized &&
         sourceDistributionSamples.length > 0 &&
         targetDistributionSamples.length > 0 &&
         $allTimeSamples.length > 0 &&
         svgElement) {
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

<Figure {caption} bind:isActive={figureIsActive}>
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
