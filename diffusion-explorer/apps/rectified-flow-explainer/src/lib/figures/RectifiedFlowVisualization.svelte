<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import Figure from "$lib/components/Figure.svelte";
  import PlayButton from "$lib/components/PlayButton.svelte";

  // Data props
  export let allRectifiedTrajectories = []; // [step][timestep][sample][dim]
  export let targetDistribution = []; // The actual target distribution points

  // Data validation
  $: isDataValid =
    allRectifiedTrajectories &&
    allRectifiedTrajectories.length > 0 &&
    allRectifiedTrajectories[0] &&
    allRectifiedTrajectories[0].length > 0 &&
    targetDistribution &&
    targetDistribution.length > 0;

  // Derived source distribution from trajectory start
  $: sourceDistributionSamples = isDataValid
    ? allRectifiedTrajectories[0][0] // First timestep of first rectified step
    : [];
  // Use the passed-in target distribution
  $: targetDistributionSamples = targetDistribution;

  // Animation props
  export let animationDuration = 6000; // Duration per rectified step (ms)
  export let playingByDefault = true;
  export let pauseBetweenSteps = 1000; // Pause between rectified steps (ms)
  export let pauseBeforeRestart = 2000; // Pause before looping animation (ms)

  // Trajectory selection
  export let numTrajectoriesToShow = 10; // Number of trajectories to visualize

  // Styling props (colors)
  export let trajectoryColor = "#f17720"; // Orange
  export let sourcePointColor = "#3b82f6"; // Blue
  export let targetPointColor = "#3b82f6"; // Blue

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
  export let marginWidth = 20;
  export let marginHeight = 20;
  export let yShiftFactor = -0.5; // Vertical shift for distributions (positive shifts down)
  export let flowWidth = 11; // Horizontal gap between source and target in data units

  // Label props
  export let sourceLabelText = "Source Distribution";
  export let targetLabelText = "Target Distribution";
  export let labelFontSize = 22;
  export let labelColor = "#666";

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Callback when visualization is initialized
  export let onInitialized = undefined;

  // Animation state
  let initialized = false;
  let showingAfterRectification = false; // Toggle between before (false) and after (true)
  let currentRectifiedStep = 0; // Derived from showingAfterRectification
  let previousRectifiedStep = -1; // Track when rectified step changes
  let time = 0; // Normalized time (0-1) within current step
  let isPlaying = playingByDefault;
  let selectedTrajectoryIndices = [];
  let animationFrameId = null;
  let lastTimestamp = null;
  let isPaused = false;
  let pauseStartTime = null;

  // SVG elements
  let svg;
  let xScale;
  let yScale;

  // Cache for trajectory lengths and arc lengths
  // Map structure: Map<rectifiedStep, Map<trajectoryIdx, totalLength>>
  let trajectoryLengths = new Map();
  // Map structure: Map<rectifiedStep, Map<trajectoryIdx, arcLengths[]>>
  let trajectoryArcLengths = new Map();

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
    const indices = [];
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
  function getTrajectoryData(rectifiedStep, sampleIndex) {
    const stepData = allRectifiedTrajectories[rectifiedStep]; // [timestep][sample][dim]
    return stepData.map((timestep) => timestep[sampleIndex]); // [timestep][dim]
  }

  /**
   * Create D3 scales based on all data
   * Target points are shifted right by flowWidth to create the transformation effect
   */
  function createScales() {
    if (!isDataValid) return;

    let allX = [];
    let allY = [];

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
    xScale = d3
      .scaleLinear()
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

    yScale = d3
      .scaleLinear()
      .domain([
        yCenter - yRange / 2 - yCenterOffset,
        yCenter + yRange / 2 - yCenterOffset,
      ])
      .range([marginHeight, height - marginHeight]); // Flipped: smaller y values at top
  }

  /**
   * Generate SVG path for a trajectory up to endStep
   * Applies x-shift transformation to create source-to-target flow effect
   */
  function generateTrajectoryPath(rectifiedStep, trajectoryIndex, endStep = null) {
    const trajectoryData = getTrajectoryData(
      rectifiedStep,
      selectedTrajectoryIndices[trajectoryIndex]
    );
    const numPoints = trajectoryData.length;
    const maxStep = endStep !== null ? endStep : numPoints - 1;

    let path = "";
    for (let i = 0; i <= maxStep; i++) {
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
   * Initialize the visualization (lightweight: scatter plots + labels)
   */
  function initializeVisualization() {
    if (!svg || !isDataValid || selectedTrajectoryIndices.length === 0) return;

    const d3Svg = d3.select(svg);

    // Clear existing content
    d3Svg.selectAll("*").remove();

    // Create scale
    createScales();

    // Create groups
    d3Svg.append("g").attr("class", "source-scatter");
    d3Svg.append("g").attr("class", "target-scatter");
    d3Svg.append("g").attr("class", "trajectories");
    d3Svg.append("g").attr("class", "labels");

    const sourceScatter = d3Svg.select(".source-scatter");
    const targetScatter = d3Svg.select(".target-scatter");
    const labelsGroup = d3Svg.select(".labels");

    // Draw source distribution (fixed on the left)
    sourceScatter
      .selectAll("circle")
      .data(sourceDistributionSamples)
      .join("circle")
      .attr("cx", (d) => xScale(d[0]))
      .attr("cy", (d) => yScale(d[1]))
      .attr("r", pointRadius)
      .attr("fill", sourcePointColor)
      .attr("opacity", pointOpacity);

    // Draw target distribution (fixed on the right)
    targetScatter
      .selectAll("circle")
      .data(targetDistributionSamples)
      .join("circle")
      .attr("cx", (d) => xScale(d[0] + flowWidth))
      .attr("cy", (d) => yScale(d[1]))
      .attr("r", pointRadius)
      .attr("fill", targetPointColor)
      .attr("opacity", pointOpacity);

    // Add rectified step label
    labelsGroup
      .append("text")
      .attr("class", "rectified-step-label")
      .attr("x", width / 2)
      .attr("y", 30)
      .attr("text-anchor", "middle")
      .attr("font-size", `${labelFontSize}px`)
      .attr("fill", labelColor);

    // Add source distribution label (positioned relative to top of SVG)
    if (sourceDistributionSamples.length > 0) {
      const sourceX = d3.mean(sourceDistributionSamples, (d) => xScale(d[0]));

      // Get y position from top of data domain
      const yDomain = yScale.domain();
      const yTop = yDomain[0]; // Min value maps to top (since we flipped the y-axis)
      const labelY = yScale(yTop) + 0.5 * labelFontSize;

      labelsGroup
        .append("text")
        .attr("class", "source-label")
        .attr("x", sourceX)
        .attr("y", labelY)
        .attr("text-anchor", "middle")
        .attr("font-size", `${labelFontSize}px`)
        .attr("fill", labelColor)
        .attr("stroke", "#ffffff")
        .attr("stroke-width", "4")
        .attr("paint-order", "stroke")
        .text(sourceLabelText);
    }

    // Add target distribution label (positioned relative to top of SVG)
    if (targetDistributionSamples.length > 0) {
      const targetX = d3.mean(targetDistributionSamples, (d) =>
        xScale(d[0] + flowWidth)
      );

      // Get y position from top of data domain
      const yDomain = yScale.domain();
      const yTop = yDomain[0];
      const labelY = yScale(yTop) + 0.5 * labelFontSize;

      labelsGroup
        .append("text")
        .attr("class", "target-label")
        .attr("x", targetX)
        .attr("y", labelY)
        .attr("text-anchor", "middle")
        .attr("font-size", `${labelFontSize}px`)
        .attr("fill", labelColor)
        .attr("stroke", "#ffffff")
        .attr("stroke-width", "4")
        .attr("paint-order", "stroke")
        .text(targetLabelText);
    }
  }

  /**
   * Initialize trajectories (heavy: arc length computation + trajectory elements)
   */
  function initializeTrajectories() {
    if (!svg || !isDataValid || selectedTrajectoryIndices.length === 0) return;

    const d3Svg = d3.select(svg);
    const trajectoriesGroup = d3Svg.select(".trajectories");

    // Pre-compute arc lengths for all rectified steps and trajectories
    for (
      let rectStep = 0;
      rectStep < allRectifiedTrajectories.length;
      rectStep++
    ) {
      const lengthsForStep = new Map();
      const arcLengthsForStep = new Map();

      for (let idx = 0; idx < selectedTrajectoryIndices.length; idx++) {
        // Generate full path for this rectified step
        const fullPath = generateTrajectoryPath(rectStep, idx, null);

        // Create temporary path to measure total length
        const tempFullPath = trajectoriesGroup
          .append("path")
          .attr("d", fullPath);
        const totalLength = tempFullPath.node().getTotalLength();
        lengthsForStep.set(idx, totalLength);

        // Pre-compute arc lengths at each timestep
        const stepData = allRectifiedTrajectories[rectStep];
        const numTimeSteps = stepData.length;
        const arcLengths = new Array(numTimeSteps);

        for (let step = 0; step < numTimeSteps; step++) {
          const partialPath = generateTrajectoryPath(rectStep, idx, step);
          const tempPath = trajectoriesGroup
            .append("path")
            .attr("d", partialPath);
          arcLengths[step] = tempPath.node().getTotalLength();
          tempPath.remove();
        }

        arcLengthsForStep.set(idx, arcLengths);
        tempFullPath.remove();
      }

      trajectoryLengths.set(rectStep, lengthsForStep);
      trajectoryArcLengths.set(rectStep, arcLengthsForStep);
    }

    // Initialize trajectory SVG elements (full paths + progress paths + markers)
    for (let idx = 0; idx < selectedTrajectoryIndices.length; idx++) {
      // Full path (background)
      trajectoriesGroup
        .append("path")
        .attr("class", `trajectory-full-${idx}`)
        .attr("fill", "none")
        .attr("stroke", trajectoryColor)
        .attr("stroke-width", trajectoryStrokeWidth)
        .attr("opacity", trajectoryFullOpacity);

      // Progress path (animated) with stroke-dasharray
      trajectoriesGroup
        .append("path")
        .attr("class", `trajectory-progress-${idx}`)
        .attr("fill", "none")
        .attr("stroke", trajectoryColor)
        .attr("stroke-width", trajectoryStrokeWidth)
        .attr("opacity", trajectoryProgressOpacity);

      // Circle marker
      trajectoriesGroup
        .append("circle")
        .attr("class", `trajectory-point-${idx}`)
        .attr("r", trajectoryPointRadius)
        .attr("fill", trajectoryColor)
        .attr("opacity", trajectoryProgressOpacity);
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

    // Check if rectified step changed
    const stepChanged = currentRectifiedStep !== previousRectifiedStep;

    // Get cached lengths for current rectified step
    const lengthsForStep = trajectoryLengths.get(currentRectifiedStep);
    const arcLengthsForStep = trajectoryArcLengths.get(currentRectifiedStep);

    // Update trajectories
    for (let idx = 0; idx < selectedTrajectoryIndices.length; idx++) {
      const fullPathElement = d3Svg.select(`.trajectory-full-${idx}`);
      const progressPathElement = d3Svg.select(`.trajectory-progress-${idx}`);

      // Only regenerate paths when rectified step changes
      if (stepChanged) {
        const fullPath = generateTrajectoryPath(
          currentRectifiedStep,
          idx,
          null
        );
        fullPathElement.attr("d", fullPath);
        progressPathElement.attr("d", fullPath); // Same path as full

        // Get total length for this trajectory at current rectified step
        const totalLength = lengthsForStep?.get(idx) || 0;

        // Set up dasharray for this rectified step
        progressPathElement
          .attr("stroke-dasharray", totalLength)
          .attr("stroke-dashoffset", totalLength);
      }

      // Always update dashoffset based on current time
      const totalLength = lengthsForStep?.get(idx) || 0;
      const arcLengths = arcLengthsForStep?.get(idx);

      // Calculate current timestep and arc length
      const trajectoryData = getTrajectoryData(
        currentRectifiedStep,
        selectedTrajectoryIndices[idx]
      );
      const numPoints = trajectoryData.length;
      const currentStep = Math.floor(time * (numPoints - 1));

      if (arcLengths && currentStep < arcLengths.length) {
        const arcLengthAtStep = arcLengths[currentStep];
        progressPathElement.attr(
          "stroke-dashoffset",
          totalLength - arcLengthAtStep
        );
      }

      // Circle marker
      if (currentStep < numPoints) {
        const [x, y] = trajectoryData[currentStep];
        const xShifted = x + time * flowWidth;
        d3Svg
          .select(`.trajectory-point-${idx}`)
          .attr("cx", xScale(xShifted))
          .attr("cy", yScale(y));
      }
    }

    // Update label
    const labelText = currentRectifiedStep === 0 ? "Before Rectification" : "After Rectification";
    d3Svg
      .select(".rectified-step-label")
      .text(labelText);

    // Track previous step
    previousRectifiedStep = currentRectifiedStep;
  }

  /**
   * Animation loop
   */
  function animate(timestamp) {
    if (!isPlaying) {
      animationFrameId = null;
      return;
    }

    if (lastTimestamp === null) {
      lastTimestamp = timestamp;
    }

    const elapsed = timestamp - lastTimestamp;

    // Handle pause between steps
    if (isPaused && pauseStartTime !== null) {
      const pauseElapsed = timestamp - pauseStartTime;

      if (pauseElapsed >= pauseBetweenSteps) {
        // Pause complete - toggle to next state
        isPaused = false;
        pauseStartTime = null;
        lastTimestamp = null; // Reset timestamp so elapsed doesn't include pause time

        // Toggle between before and after
        showingAfterRectification = !showingAfterRectification;
        currentRectifiedStep = showingAfterRectification ? 1 : 0;
        previousRectifiedStep = -1; // Force path regeneration
        time = 0;

        updateVisualization(); // Update immediately after pause ends
      }

      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    // Update time
    time += elapsed / animationDuration;

    if (time >= 1.0) {
      time = 1.0;
      updateVisualization();

      // Start pause before toggling to next state
      isPaused = true;
      pauseStartTime = timestamp;
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

  // Reactive statements - only initialize and animate when fully ready
  $: if (
    isDataValid &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    svg
  ) {
    selectTrajectoryIndices();
    initializeVisualization(); // Lightweight: scatter plots + labels
    // TODO: fix this, this is super jank but makes the rendering order work
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        initializeTrajectories(); // Heavy: arc length computation
        requestAnimationFrame(() => {
          initialized = true;
          onInitialized?.(); // Yield control to other figures
        });
      });
    });
  }

  $: if (
    isPlaying &&
    !animationFrameId &&
    svg &&
    isDataValid &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    selectedTrajectoryIndices.length > 0 && 
    initialized
  ) {
    startAnimation();
  }

  $: if (!isPlaying && animationFrameId) {
    stopAnimation();
  }

  onMount(() => {
    // Animation will be started by the reactive statement once isReadyToAnimate becomes true
  });

  onDestroy(() => {
    stopAnimation();
  });
</script>

<Figure {caption}>
  {#snippet children()}
    <PlayButton {isPlaying} onclick={toggleAnimation} />
    <svg
      bind:this={svg}
      viewBox="0 0 {width} {height}"
      preserveAspectRatio="xMidYMid meet"
      style="width: 100%; height: auto; max-width: {width}px; aspect-ratio: {width} / {height};"
    >
    </svg>
  {/snippet}
</Figure>
