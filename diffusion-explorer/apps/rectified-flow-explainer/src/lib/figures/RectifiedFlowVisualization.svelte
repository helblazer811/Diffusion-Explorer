<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import Figure from "$lib/components/Figure.svelte";
  import PlayButton from "$lib/components/PlayButton.svelte";
  import TextToggleButton from "$lib/components/TextToggleButton.svelte";
  import { settings } from "$lib/settings";
  import { plotSourceTargetScatter, plotSourceTargetLabels, createSourceTargetScales } from "$lib/d3_helpers";

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
  export let numTrajectoriesToShow = 15; // Number of trajectories to visualize

  // Styling props (colors)
  export let trajectoryColor = "#f17720"; // Orange
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;

  // Styling props (opacity)
  export let trajectoryFullOpacity = 0.3; // Background paths
  export let trajectoryProgressOpacity = 0.8; // Animated paths
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;

  // Styling props (dimensions)
  export let trajectoryStrokeWidth = 2;
  export let trajectoryPointRadius = 4;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;

  // Layout
  export let width = 800;
  export let height = 325;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;
  export let sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX = settings.stylingSettings.layout.targetCenterX;

  // Label props
  export let sourceLabelText = "Source Distribution";
  export let targetLabelText = "Target Distribution";
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;
  export let outlineColor = settings.stylingSettings.label.outlineColor;
  export let outlineOpacity = settings.stylingSettings.label.outlineOpacity;

  // Toggle button props
  export let beforeLabel = "Before Rectification";
  export let afterLabel = "After Rectification";
  export let toggleBorderRadius = 20;

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Callback when visualization is initialized
  export let onInitialized = undefined;

  // Background visibility
  export let backgroundVisible = true;

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

  // Visibility-based animation control
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // Pause animation when figure goes off-screen, resume when back
  $: if (figureIsActive && initialized) {
    if (!$figureIsActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false;
    } else if ($figureIsActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true;
    }
  }

  // SVG elements
  let svg;
  let scales;

  // Cache for trajectory lengths
  // Map structure: Map<rectifiedStep, Map<trajectoryIdx, totalLength>>
  let trajectoryLengths = new Map();

  /**
   * Toggle animation play/pause
   */
  function toggleAnimation() {
    isPlaying = !isPlaying;
  }

  /**
   * Handle toggle button change
   */
  function handleToggleChange(newValue) {
    if (newValue !== showingAfterRectification) {
      showingAfterRectification = newValue;
      currentRectifiedStep = newValue ? 1 : 0;
      previousRectifiedStep = -1; // Force path regeneration
      time = 0;
      updateVisualization();
    }
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
   * Compute pixel x position for a data point at a given time.
   * At t=0, positions are centered at sourceCenterPixelX.
   * At t=1, positions are centered at targetCenterPixelX.
   */
  function getPixelX(dataX, dataMeanX, t) {
    if (!scales) return 0;
    const centerPixelX = scales.sourceCenterPixelX + t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - dataMeanX) * scales.xScaleFactor;
  }

  /**
   * Generate SVG path for a trajectory up to endStep
   * Applies position interpolation to create source-to-target flow effect
   */
  function generateTrajectoryPath(rectifiedStep, trajectoryIndex, endStep = null) {
    if (!scales) return "";

    const trajectoryData = getTrajectoryData(
      rectifiedStep,
      selectedTrajectoryIndices[trajectoryIndex]
    );
    const numPoints = trajectoryData.length;
    const maxStep = endStep !== null ? endStep : numPoints - 1;

    // Compute combined mean for positioning
    const allSourceX = sourceDistributionSamples.map(p => p[0]);
    const allTargetX = targetDistributionSamples.map(p => p[0]);
    const combinedMeanX = [...allSourceX, ...allTargetX].reduce((a, b) => a + b, 0) / (allSourceX.length + allTargetX.length);

    let path = "";
    for (let i = 0; i <= maxStep; i++) {
      const [x, y] = trajectoryData[i];

      // Compute time at this step for interpolation
      const timeAtStep = i / (numPoints - 1);

      const svgX = getPixelX(x, combinedMeanX, timeAtStep);
      const svgY = scales.yScale(y);

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

    // Create scales using proportional positioning
    scales = createSourceTargetScales(sourceDistributionSamples, targetDistributionSamples, {
      width, height, marginWidth, marginHeight, sourceCenterX, targetCenterX, yShiftFactor
    });

    // Create groups
    d3Svg.append("g").attr("id", "sourceScatter");
    d3Svg.append("g").attr("id", "targetScatter");
    d3Svg.append("g").attr("class", "trajectories");
    d3Svg.append("g").attr("id", "labels");

    // Draw source and target distributions
    plotSourceTargetScatter(d3Svg, sourceDistributionSamples, targetDistributionSamples, scales, {
      sourcePointColor,
      targetPointColor,
      pointRadius,
      pointOpacity
    });

    // Add source and target distribution labels
    if (sourceDistributionSamples.length > 0 && targetDistributionSamples.length > 0) {
      plotSourceTargetLabels(d3Svg, scales, {
        sourceLabelText,
        targetLabelText,
        labelFontSize,
        labelColor,
        outlineColor,
        outlineOpacity
      });
    }
  }

  /**
   * Initialize trajectories (trajectory elements + total path length)
   */
  function initializeTrajectories() {
    if (!svg || !isDataValid || selectedTrajectoryIndices.length === 0) return;

    const d3Svg = d3.select(svg);
    const trajectoriesGroup = d3Svg.select(".trajectories");

    // Pre-compute total path lengths for all rectified steps and trajectories
    for (
      let rectStep = 0;
      rectStep < allRectifiedTrajectories.length;
      rectStep++
    ) {
      const lengthsForStep = new Map();

      for (let idx = 0; idx < selectedTrajectoryIndices.length; idx++) {
        // Generate full path for this rectified step
        const fullPath = generateTrajectoryPath(rectStep, idx, null);

        // Create temporary path to measure total length
        const tempFullPath = trajectoriesGroup
          .append("path")
          .attr("d", fullPath);
        const totalLength = tempFullPath.node().getTotalLength();
        lengthsForStep.set(idx, totalLength);
        tempFullPath.remove();
      }

      trajectoryLengths.set(rectStep, lengthsForStep);
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

      // Always update dashoffset based on current time using linear interpolation
      const totalLength = lengthsForStep?.get(idx) || 0;
      const visibleLength = totalLength * time;

      // Reveal path proportional to time
      progressPathElement.attr("stroke-dashoffset", totalLength - visibleLength);

      // Update circle marker at the end of the visible path
      const pathNode = progressPathElement.node();
      if (pathNode && totalLength > 0) {
        const point = pathNode.getPointAtLength(visibleLength);
        d3Svg
          .select(`.trajectory-point-${idx}`)
          .attr("cx", point.x)
          .attr("cy", point.y);
      }
    }

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

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <div style="position: relative; width: 100%; display: flex; justify-content: center;">
        <PlayButton {isPlaying} onclick={toggleAnimation} />
        <svg
          bind:this={svg}
          viewBox="0 0 {width} {height}"
          preserveAspectRatio="xMidYMid meet"
          style="width: 100%; height: auto; max-width: {width}px; aspect-ratio: {width} / {height};"
        >
        </svg>
      </div>
      <div>
        <TextToggleButton
          leftLabel={beforeLabel}
          rightLabel={afterLabel}
          value={showingAfterRectification}
          borderRadius={toggleBorderRadius}
          onchange={handleToggleChange}
        />
      </div>
    </div>
  {/snippet}
</Figure>
