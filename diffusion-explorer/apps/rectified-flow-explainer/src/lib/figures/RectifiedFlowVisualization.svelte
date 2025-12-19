<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import Figure from '$lib/components/Figure.svelte';
  import PlayButton from '$lib/components/PlayButton.svelte';

  // Data props
  export let allRectifiedTrajectories: number[][][][]; // [step][timestep][sample][dim]
  export let sourceDistributionSamples: number[][] = [];
  export let targetDistributionSamples: number[][] = [];

  // Animation props
  export let animationDuration = 3000; // Duration per rectified step (ms)
  export let pauseBetweenSteps = 1000; // Pause between rectified steps (ms)
  export let pauseBeforeRestart = 2000; // Pause before looping animation (ms)

  // Trajectory selection
  export let numTrajectoriesToShow = 10; // Number of trajectories to visualize

  // Styling props (colors)
  export let trajectoryColor = '#f17720'; // Orange
  export let sourcePointColor = '#3b82f6'; // Blue
  export let targetPointColor = '#3b82f6'; // Blue

  // Styling props (opacity)
  export let trajectoryFullOpacity = 0.3; // Background paths
  export let trajectoryProgressOpacity = 0.8; // Animated paths
  export let pointOpacity = 0.25; // Distribution points

  // Styling props (dimensions)
  export let trajectoryStrokeWidth = 2;
  export let trajectoryPointRadius = 4;
  export let pointRadius = 5;

  // Layout
  export let width = 800;
  export let height = 300;
  export let marginWidth = 60;
  export let marginHeight = 20;
  export let yShiftFactor = -0.5; // Vertical shift for distributions (positive shifts down)
  export let flowWidth = 10; // Horizontal gap between source and target in data units

  // Label props
  export let sourceLabelText = 'Source Distribution';
  export let targetLabelText = 'Target Distribution';
  export let labelFontSize = 18;
  export let labelColor = '#666';

  // Caption
  export let caption: import('svelte').Snippet | undefined = undefined;

  // Animation state
  let currentRectifiedStep = 0;
  let time = 0; // Normalized time (0-1) within current step
  let isPlaying = true;
  let selectedTrajectoryIndices: number[] = [];
  let animationFrameId: number | null = null;
  let lastTimestamp: number | null = null;
  let isPaused = false;
  let pauseStartTime: number | null = null;
  let pauseDuration = 0; // Which pause we're in: 0 = none, 1 = between steps, 2 = before restart

  // SVG elements
  let svg: SVGSVGElement;
  let xScale: d3.ScaleLinear<number, number>;
  let yScale: d3.ScaleLinear<number, number>;

  // Data validation
  $: isDataValid = allRectifiedTrajectories &&
                    allRectifiedTrajectories.length > 0 &&
                    allRectifiedTrajectories[0] &&
                    allRectifiedTrajectories[0].length > 0;

  /**
   * Toggle animation play/pause
   */
  function toggleAnimation() {
    isPlaying = !isPlaying;
  }

  /**
   * Select random trajectory indices (same particles across all steps)
   */
  function selectTrajectoryIndices() {
    if (!isDataValid) return;

    const numAvailable = allRectifiedTrajectories[0]?.[0]?.length || 0;
    const numToSelect = Math.min(numTrajectoriesToShow, numAvailable);

    // Random selection, but same for all steps
    const indices: number[] = [];
    const availableIndices = Array.from({ length: numAvailable }, (_, i) => i);

    for (let i = 0; i < numToSelect; i++) {
      const randomIndex = Math.floor(Math.random() * availableIndices.length);
      indices.push(availableIndices.splice(randomIndex, 1)[0]);
    }

    selectedTrajectoryIndices = indices;
  }

  /**
   * Get trajectory data for a specific rectified step and sample index
   */
  function getTrajectoryData(rectifiedStep: number, sampleIndex: number): number[][] {
    const stepData = allRectifiedTrajectories[rectifiedStep]; // [timestep][sample][dim]
    return stepData.map(timestep => timestep[sampleIndex]); // [timestep][dim]
  }

  /**
   * Create D3 scales based on all data
   * Target points are shifted right by flowWidth to create the transformation effect
   */
  function createScales() {
    if (!isDataValid) return;

    let allX: number[] = [];
    let allY: number[] = [];

    // Include source points (at original x position)
    for (const pt of sourceDistributionSamples) {
      allX.push(pt[0]);
      allY.push(pt[1]);
    }

    // Include target points (shifted right by flowWidth)
    for (const pt of targetDistributionSamples) {
      allX.push(pt[0] + flowWidth);
      allY.push(pt[1]);
    }

    // Include trajectory points (they will be shifted during animation)
    for (const stepData of allRectifiedTrajectories) {
      for (const timestep of stepData) {
        for (const point of timestep) {
          allX.push(point[0]);
          allY.push(point[1]);
          allX.push(point[0] + flowWidth); // Also include shifted version
        }
      }
    }

    // Calculate x-scale using marginWidth
    xScale = d3.scaleLinear()
      .domain([Math.min(...allX), Math.max(...allX)])
      .range([marginWidth, width - marginWidth]);

    // Calculate y-scale with yShiftFactor and marginHeight
    const yMin = Math.min(...allY);
    const yMax = Math.max(...allY);
    const yRange = yMax - yMin;
    const yCenter = (yMin + yMax) / 2;

    // Apply yShiftFactor similar to FlowModelIntro
    // Reserve space at top for labels (7% of range) and apply shift factor
    const yCenterOffset = -yRange * 0.07 - yShiftFactor;

    yScale = d3.scaleLinear()
      .domain([yCenter - yRange / 2 - yCenterOffset, yCenter + yRange / 2 - yCenterOffset])
      .range([marginHeight, height - marginHeight]); // Flipped: smaller y values at top
  }

  /**
   * Generate SVG path for a trajectory up to endTime
   * Applies x-shift transformation to create source-to-target flow effect
   */
  function generateTrajectoryPath(
    rectifiedStep: number,
    trajectoryIndex: number,
    endTime: number  // 0 to 1
  ): string {
    const trajectoryData = getTrajectoryData(rectifiedStep, selectedTrajectoryIndices[trajectoryIndex]);
    const numPoints = trajectoryData.length;
    const endIndex = Math.floor(endTime * (numPoints - 1));

    let path = '';
    for (let i = 0; i <= endIndex; i++) {
      const [x, y] = trajectoryData[i];

      // Apply x-shift based on progress through trajectory
      const timeAtStep = i / (numPoints - 1);
      const xShifted = x + timeAtStep * flowWidth;

      const svgX = xScale(xShifted);
      const svgY = yScale(y);

      if (i === 0) {
        path += `M ${svgX},${svgY}`;
      } else {
        path += ` L ${svgX},${svgY}`;
      }
    }

    return path;
  }

  /**
   * Initialize the visualization
   */
  function initializeVisualization() {
    if (!svg || !isDataValid || selectedTrajectoryIndices.length === 0) return;

    const d3Svg = d3.select(svg);

    // Clear existing content
    d3Svg.selectAll('*').remove();

    // Create scale
    createScales();

    // Create groups
    const sourceScatter = d3Svg.append('g').attr('class', 'source-scatter');
    const targetScatter = d3Svg.append('g').attr('class', 'target-scatter');
    const trajectoriesGroup = d3Svg.append('g').attr('class', 'trajectories');
    const labelsGroup = d3Svg.append('g').attr('class', 'labels');

    // Draw source distribution (fixed on the left)
    sourceScatter.selectAll('circle')
      .data(sourceDistributionSamples)
      .join('circle')
      .attr('cx', d => xScale(d[0]))
      .attr('cy', d => yScale(d[1]))
      .attr('r', pointRadius)
      .attr('fill', sourcePointColor)
      .attr('opacity', pointOpacity);

    // Draw target distribution (fixed on the right)
    targetScatter.selectAll('circle')
      .data(targetDistributionSamples)
      .join('circle')
      .attr('cx', d => xScale(d[0] + flowWidth))
      .attr('cy', d => yScale(d[1]))
      .attr('r', pointRadius)
      .attr('fill', targetPointColor)
      .attr('opacity', pointOpacity);

    // Initialize trajectories (full paths + progress paths + markers)
    for (let idx = 0; idx < selectedTrajectoryIndices.length; idx++) {
      // Full path (background)
      trajectoriesGroup.append('path')
        .attr('class', `trajectory-full-${idx}`)
        .attr('fill', 'none')
        .attr('stroke', trajectoryColor)
        .attr('stroke-width', trajectoryStrokeWidth)
        .attr('opacity', trajectoryFullOpacity);

      // Progress path (animated)
      trajectoriesGroup.append('path')
        .attr('class', `trajectory-progress-${idx}`)
        .attr('fill', 'none')
        .attr('stroke', trajectoryColor)
        .attr('stroke-width', trajectoryStrokeWidth)
        .attr('opacity', trajectoryProgressOpacity);

      // Circle marker
      trajectoriesGroup.append('circle')
        .attr('class', `trajectory-point-${idx}`)
        .attr('r', trajectoryPointRadius)
        .attr('fill', trajectoryColor)
        .attr('opacity', trajectoryProgressOpacity);
    }

    // Add rectified step label
    labelsGroup.append('text')
      .attr('class', 'rectified-step-label')
      .attr('x', width / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .attr('font-size', '18px')
      .attr('font-weight', 'bold')
      .attr('fill', '#333');

    // Add source distribution label (positioned relative to top of SVG)
    if (sourceDistributionSamples.length > 0) {
      const sourceX = d3.mean(sourceDistributionSamples, d => xScale(d[0]));

      // Get y position from top of data domain
      const yDomain = yScale.domain();
      const yTop = yDomain[0]; // Min value maps to top (since we flipped the y-axis)
      const labelY = yScale(yTop) + 0.5 * labelFontSize;

      labelsGroup.append('text')
        .attr('class', 'source-label')
        .attr('x', sourceX)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('font-size', `${labelFontSize}px`)
        .attr('fill', labelColor)
        .attr('stroke', '#ffffff')
        .attr('stroke-width', '4')
        .attr('paint-order', 'stroke')
        .text(sourceLabelText);
    }

    // Add target distribution label (positioned relative to top of SVG)
    if (targetDistributionSamples.length > 0) {
      const targetX = d3.mean(targetDistributionSamples, d => xScale(d[0] + flowWidth));

      // Get y position from top of data domain
      const yDomain = yScale.domain();
      const yTop = yDomain[0];
      const labelY = yScale(yTop) + 0.5 * labelFontSize;

      labelsGroup.append('text')
        .attr('class', 'target-label')
        .attr('x', targetX)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('font-size', `${labelFontSize}px`)
        .attr('fill', labelColor)
        .attr('stroke', '#ffffff')
        .attr('stroke-width', '4')
        .attr('paint-order', 'stroke')
        .text(targetLabelText);
    }

    // Initial update
    updateVisualization();
  }

  /**
   * Update visualization based on current state
   */
  function updateVisualization() {
    if (!svg || !isDataValid || selectedTrajectoryIndices.length === 0) return;

    const d3Svg = d3.select(svg);

    // Update trajectories
    for (let idx = 0; idx < selectedTrajectoryIndices.length; idx++) {
      // Full path
      const fullPath = generateTrajectoryPath(currentRectifiedStep, idx, 1.0);
      d3Svg.select(`.trajectory-full-${idx}`)
        .attr('d', fullPath);

      // Progress path
      const progressPath = generateTrajectoryPath(currentRectifiedStep, idx, time);
      d3Svg.select(`.trajectory-progress-${idx}`)
        .attr('d', progressPath);

      // Circle marker
      const trajectoryData = getTrajectoryData(currentRectifiedStep, selectedTrajectoryIndices[idx]);
      const numPoints = trajectoryData.length;
      const currentIndex = Math.floor(time * (numPoints - 1));
      if (currentIndex < numPoints) {
        const [x, y] = trajectoryData[currentIndex];
        const xShifted = x + time * flowWidth;
        d3Svg.select(`.trajectory-point-${idx}`)
          .attr('cx', xScale(xShifted))
          .attr('cy', yScale(y));
      }
    }

    // Update label
    d3Svg.select('.rectified-step-label')
      .text(`Rectified Step ${currentRectifiedStep + 1} / ${allRectifiedTrajectories.length}`);
  }

  /**
   * Animation loop
   */
  function animate(timestamp: number) {
    if (!isPlaying) {
      animationFrameId = null;
      return;
    }

    if (lastTimestamp === null) {
      lastTimestamp = timestamp;
    }

    const elapsed = timestamp - lastTimestamp;

    // Handle pause states
    if (isPaused && pauseStartTime !== null) {
      const pauseElapsed = timestamp - pauseStartTime;
      const currentPauseDuration = pauseDuration === 1 ? pauseBetweenSteps : pauseBeforeRestart;

      if (pauseElapsed >= currentPauseDuration) {
        // Pause complete
        isPaused = false;
        pauseStartTime = null;
        lastTimestamp = timestamp;

        if (pauseDuration === 2) {
          // Restart from beginning
          currentRectifiedStep = 0;
          time = 0;
        }
        pauseDuration = 0;
      }

      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    // Update time
    time += elapsed / animationDuration;

    if (time >= 1.0) {
      time = 1.0;
      updateVisualization();

      // Move to next step
      currentRectifiedStep++;

      if (currentRectifiedStep >= allRectifiedTrajectories.length) {
        // All steps complete - pause before restart
        currentRectifiedStep = allRectifiedTrajectories.length - 1;
        isPaused = true;
        pauseStartTime = timestamp;
        pauseDuration = 2; // Before restart
      } else {
        // Pause between steps
        isPaused = true;
        pauseStartTime = timestamp;
        pauseDuration = 1; // Between steps
      }

      time = 0;
    } else {
      updateVisualization();
    }

    lastTimestamp = timestamp;
    animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Start animation
   */
  function startAnimation() {
    if (animationFrameId !== null) return;
    lastTimestamp = null;
    animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Stop animation
   */
  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  // Reactive statements
  $: if (isDataValid && svg) {
    selectTrajectoryIndices();
    initializeVisualization();
    if (isPlaying) {
      startAnimation();
    }
  }

  $: if (isPlaying && !animationFrameId && svg && selectedTrajectoryIndices.length > 0) {
    startAnimation();
  }

  $: if (!isPlaying && animationFrameId) {
    stopAnimation();
  }

  onMount(() => {
    if (isDataValid) {
      selectTrajectoryIndices();
      initializeVisualization();
      startAnimation();
    }
  });

  onDestroy(() => {
    stopAnimation();
  });
</script>

<Figure {width} {height} {caption}>
  {#snippet children()}
    <PlayButton {isPlaying} onclick={toggleAnimation} />
    <svg bind:this={svg} viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; max-width: {width}px;">
    </svg>
  {/snippet}
</Figure>
