<!-- This figure shows curved trajectories from flow matching, demonstrating non-straight paths. -->

<script lang="ts">
  import { onMount } from 'svelte';
  import { type Writable } from 'svelte/store';
  import * as d3 from 'd3';
  import Figure from '$lib/components/Figure.svelte';
  import PlayButton from '$lib/components/PlayButton.svelte';

  // Caption props
  export let figureNumber = '2';
  export let captionText = 'Curved trajectories produced by flow matching visualization.';

  // Data props (from parent +page.svelte)
  export let sourceDistributionSamples: number[][] = [];
  export let targetDistributionSamples: number[][] = [];
  export let allTimeSamples: Writable<number[][][]>;
  export let isTraining: Writable<boolean>;

  // Props/Configuration
  export let width = 800;
  export let height = 300;

  // Trajectory props
  export let numTrajectories = 20; // Number of trajectories to display

  // Styling props for visualization
  export let sourcePointColor = '#3b82f6'; // Blue
  export let targetPointColor = '#3b82f6'; // Blue
  export let marginWidth = 60;
  export let marginHeight = 20;
  export let sourceLabelText = 'Source Distribution';
  export let targetLabelText = 'Target Distribution';
  export let labelFontSize = 22;
  export let labelColor = '#666';
  export let pointRadius = 5;
  export let pointOpacity = 0.25;
  export let flowWidth = 10; // Gap between source and target in data units
  export let yShiftFactor = -0.5; // Vertical shift for distributions (positive shifts down)

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
  let selectedTrajectoryIndices: number[] = [];
  let svgElement: SVGSVGElement;
  let xScale = null;
  let yScale = null;
  let time = 0; // Animation time parameter (0 to 1)
  let animationFrameId: number | null = null;
  let trajectoryLengths: Map<number, number> = new Map(); // Cache total path lengths
  let trajectoryArcLengths: Map<number, number[]> = new Map(); // Cache arc lengths per timestep

  // Local animation control state
  let isPlaying = playingByDefault;
  let isPausedByFigure = false;

  // Update isPausedByFigure when isPlaying changes
  $: isPausedByFigure = !isPlaying;

  function toggleAnimation() {
    isPlaying = !isPlaying;
  }

  /**
   * Randomly select a subset of trajectory indices to display
   * @param numSamples - Total number of available trajectories
   * @param numToSelect - Number of trajectories to display
   * @returns Array of selected indices
   */
  function selectTrajectoryIndices(numSamples: number, numToSelect: number): number[] {
    // If requesting more than available, return all indices
    if (numToSelect >= numSamples) {
      return Array.from({ length: numSamples }, (_, i) => i);
    }

    // Use uniform spacing for better coverage
    const step = numSamples / numToSelect;
    const indices: number[] = [];
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
  function generateTrajectoryPath(trajectoryIndex: number, endStep: number | null = null): string {
    const allSamples = $allTimeSamples;
    if (!allSamples || allSamples.length === 0) return '';

    const maxStep = endStep !== null ? endStep : allSamples.length - 1;
    const pathData: string[] = [];

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

      // Pre-compute cumulative arc lengths at each timestep
      const allSamples = $allTimeSamples;
      const numSteps = allSamples.length;
      const arcLengths: number[] = new Array(numSteps);

      for (let step = 0; step < numSteps; step++) {
        // Generate path up to this step
        const partialPath = generateTrajectoryPath(idx, step);

        // Create temporary path element to measure its length
        const tempPath = trajectoryGroup.append('path')
          .attr('d', partialPath);

        // Get cumulative length at this step
        arcLengths[step] = tempPath.node().getTotalLength();

        // Remove temporary path
        tempPath.remove();
      }

      // Cache arc lengths for this trajectory
      trajectoryArcLengths.set(idx, arcLengths);

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
  function updateTrajectories(time: number) {
    const svg = d3.select(svgElement);
    const allSamples = $allTimeSamples;
    if (!allSamples || allSamples.length === 0) return;

    const currentStep = Math.round(time * (allSamples.length - 1));

    selectedTrajectoryIndices.forEach(idx => {
      // Get the total path length and arc lengths for this trajectory
      const totalLength = trajectoryLengths.get(idx) || 0;
      const arcLengths = trajectoryArcLengths.get(idx);

      if (arcLengths && currentStep < arcLengths.length) {
        // Get the actual arc length at the current timestep
        const arcLengthAtStep = arcLengths[currentStep];

        // Set dashoffset to reveal path up to this arc length
        // dashoffset = totalLength - arcLength reveals the path from start to arcLength
        svg.select(`.trajectory-progress-${idx}`)
          .attr('stroke-dashoffset', totalLength - arcLengthAtStep);
      }

      // Update current position marker
      const currentSamples = allSamples[currentStep];
      if (currentSamples && currentSamples[idx]) {
        const [x, y] = currentSamples[idx];
        const xShifted = x + time * flowWidth;
        svg.select(`.trajectory-point-${idx}`)
          .attr('cx', xScale(xShifted))
          .attr('cy', yScale(y));
      }
    });
  }


  function createScales(sourcePoints: number[][], targetPoints: number[][]) {
    const drawableWidth = width - 2 * marginWidth;
    const drawableHeight = height - 2 * marginHeight;
    const aspectRatio = drawableHeight / drawableWidth;

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

    const yCenterOffset = -adjustedYRange * 0.07 - yShiftFactor;

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
    svg.append('g').attr('id', 'trajectories');
    svg.append('g').attr('id', 'labels');
  }

  function initScatter(points: number[][], color: string, groupId: string, opacity: number = pointOpacity) {
    if (!svgElement || !xScale || !yScale || points.length === 0) return;
    const svg = d3.select(svgElement);
    const group = svg.select(`#${groupId}`);
    group.selectAll('circle').data(points).enter().append('circle')
      .attr('r', pointRadius).attr('fill', color).attr('opacity', opacity);
  }

  function updateScatter(points: number[][], groupId: string, time: number) {
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

    const sourceLabelX = xScale(0);
    const targetLabelX = xScale(flowWidth);
    const yDomain = yScale.domain();
    const yTop = yDomain[0];
    const labelY = yScale(yTop) + 0.5 * labelFontSize;

    labelsGroup.append('text')
      .attr('x', sourceLabelX).attr('y', labelY)
      .attr('text-anchor', 'middle').attr('font-size', `${labelFontSize}px`)
      .attr('fill', labelColor).attr('stroke', '#ffffff')
      .attr('stroke-width', '4').attr('paint-order', 'stroke')
      .text(sourceLabelText);

    labelsGroup.append('text')
      .attr('x', targetLabelX).attr('y', labelY)
      .attr('text-anchor', 'middle').attr('font-size', `${labelFontSize}px`)
      .attr('fill', labelColor).attr('stroke', '#ffffff')
      .attr('stroke-width', '4').attr('paint-order', 'stroke')
      .text(targetLabelText);
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
    createScales(sourceDistributionSamples, targetDistributionSamples);

    if (showSourceScatter) initScatter(sourceDistributionSamples, sourcePointColor, 'sourceScatter');
    if (showTargetScatter) initScatter(targetDistributionSamples, targetPointColor, 'targetScatter');

    selectedTrajectoryIndices = selectTrajectoryIndices(sourceDistributionSamples.length, numTrajectories);
    initTrajectories();
    draw();
    plotLabels();
  }

  function startAnimation() {
    let startTime: number | null = null;
    let isPaused = false;
    let pauseStartTime: number | null = null;
    let pausedElapsedTime = 0;

    function animate(currentTime: number) {
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

  // React to data changes and initialize visualization once
  $: if (!isInitialized &&
         sourceDistributionSamples.length > 0 &&
         targetDistributionSamples.length > 0 &&
         $allTimeSamples.length > 0) {
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

<Figure>
  {#snippet children()}
    <PlayButton {isPlaying} onclick={toggleAnimation} />
    <svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; max-width: {width}px;">
    </svg>
  {/snippet}
  {#snippet caption()}
    <div class="caption">
      <span class="figure-number">Figure {figureNumber}:</span> {captionText}
    </div>
  {/snippet}
</Figure>
