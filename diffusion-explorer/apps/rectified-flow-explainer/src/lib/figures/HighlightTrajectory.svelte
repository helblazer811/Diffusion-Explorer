<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import Figure from "$lib/components/Figure.svelte";
  import PlayButton from "$lib/components/PlayButton.svelte";
  import { plotKatexInSVG } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";
  import {
    createSourceTargetScales,
    plotScatterAtCenter,
  } from "$lib/d3_helpers";

  // Data props (from parent +page.svelte)
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];
  export let allTimeSamples; // [timestep][sample][dim]
  export let isTraining;

  // Data validation
  $: isDataValid =
    allTimeSamples &&
    allTimeSamples.length > 0 &&
    allTimeSamples[0] &&
    allTimeSamples[0].length > 0 &&
    sourceDistributionSamples &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples &&
    targetDistributionSamples.length > 0;

  // Animation props
  export let animationDuration = 6000; // Duration of animation (ms)
  export let playingByDefault = true;
  export let pauseBeforeRestart = 1000; // Pause before looping animation (ms)

  // Trajectory selection
  export let numTrajectoriesToShow = 15; // Number of trajectories to visualize

  // Styling props (colors)
  export let trajectoryColor = "#f17720"; // Orange
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;

  // Styling props (opacity)
  export let trajectoryFullOpacity = 0.15; // Background paths (preview)
  export let trajectoryProgressOpacity = 0.8; // Animated paths
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;

  // Styling props (dimensions)
  export let trajectoryStrokeWidth = 2;
  export let trajectoryPointRadius = 4;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;

  // Layout
  export let width = 750;
  export let height = 275;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;
  export let sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX = settings.stylingSettings.layout.targetCenterX;

  // KaTeX label props
  export let figureLatexColor = settings.stylingSettings.figureLatex.color;
  export let pointLabelFontSize = settings.stylingSettings.figureLatex.fontSize;
  export let labelAbovePointOffset = 0;
  export let katexOutline = settings.stylingSettings.figureLatex.outline;
  export let katexOutlineColor =
    settings.stylingSettings.figureLatex.outlineColor;
  export let katexOutlineWidth =
    settings.stylingSettings.figureLatex.outlineWidth;
  export let katexOutlineOpacity =
    settings.stylingSettings.figureLatex.outlineOpacity;

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Callback when visualization is initialized
  export let onInitialized = undefined;

  // Background visibility
  export let backgroundVisible = false;

  // Animation state
  let initialized = false;
  let pathsInitialized = false; // Track if paths have been set up
  let time = 0; // Normalized time (0-1)
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
  // Map structure: Map<trajectoryIdx, totalLength>
  let trajectoryLengths = new Map();

  /**
   * Toggle animation play/pause
   */
  function toggleAnimation() {
    isPlaying = !isPlaying;
  }

  /**
   * Select a single trajectory index, filtering by clipping radius
   */
  function selectTrajectoryIndices() {
    if (!isDataValid) return;

    const clippingRadius = settings.stylingSettings.scatterPlot.clippingRadius;
    const startingPoints = allTimeSamples[0];

    // Filter to indices within clipping radius
    const validIndices = [];
    for (let i = 0; i < startingPoints.length; i++) {
      const [x, y] = startingPoints[i];
      const distance = Math.sqrt(x * x + y * y);
      if (distance <= clippingRadius) {
        validIndices.push(i);
      }
    }

    // Select just 1 trajectory
    if (validIndices.length > 0) {
      selectedTrajectoryIndices = [validIndices[0]];
    }
  }

  /**
   * Get trajectory data for a specific sample index
   */
  function getTrajectoryData(sampleIndex) {
    return allTimeSamples.map((timestep) => timestep[sampleIndex]); // [timestep][dim]
  }

  /**
   * Compute pixel x position for a data point at a given time.
   * At t=0, positions are centered at sourceCenterPixelX.
   * At t=1, positions are centered at targetCenterPixelX.
   */
  function getPixelX(dataX, dataMeanX, t) {
    if (!scales) return 0;
    const centerPixelX =
      scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - dataMeanX) * scales.xScaleFactor;
  }

  /**
   * Generate SVG path for a trajectory
   * Applies position interpolation to create source-to-target flow effect
   */
  function generateTrajectoryPath(trajectoryIndex) {
    if (!scales) return "";

    const trajectoryData = getTrajectoryData(
      selectedTrajectoryIndices[trajectoryIndex]
    );
    const numPoints = trajectoryData.length;

    // Compute combined mean for positioning
    const allSourceX = sourceDistributionSamples.map((p) => p[0]);
    const allTargetX = targetDistributionSamples.map((p) => p[0]);
    const combinedMeanX =
      [...allSourceX, ...allTargetX].reduce((a, b) => a + b, 0) /
      (allSourceX.length + allTargetX.length);

    let path = "";
    for (let i = 0; i < numPoints; i++) {
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
   * Initialize the visualization (lightweight setup)
   */
  function initializeVisualization() {
    if (!svg || !isDataValid || selectedTrajectoryIndices.length === 0) return;

    const d3Svg = d3.select(svg);

    // Clear existing content
    d3Svg.selectAll("*").remove();

    // Add defs section for clipPaths
    d3Svg.append("defs");

    // Create scales using proportional positioning
    scales = createSourceTargetScales(
      sourceDistributionSamples,
      targetDistributionSamples,
      {
        width,
        height,
        marginWidth,
        marginHeight,
        sourceCenterX,
        targetCenterX,
        yShiftFactor,
      }
    );

    // Create groups (order matters for layering)
    d3Svg.append("g").attr("id", "sourceScatter");
    d3Svg.append("g").attr("id", "targetScatter");
    d3Svg.append("g").attr("class", "trajectories");
    d3Svg.append("g").attr("id", "katexLabels");

    // Plot scatter plots
    plotScatterAtCenter(
      d3Svg,
      sourceDistributionSamples,
      scales.yScale,
      "sourceScatter",
      {
        centerPixelX: scales.sourceCenterPixelX,
        meanX: scales.sourceMeanX,
        xScaleFactor: scales.xScaleFactor,
        pointRadius,
        pointOpacity,
        pointColor: sourcePointColor,
      }
    );

    plotScatterAtCenter(
      d3Svg,
      targetDistributionSamples,
      scales.yScale,
      "targetScatter",
      {
        centerPixelX: scales.targetCenterPixelX,
        meanX: scales.targetMeanX,
        xScaleFactor: scales.xScaleFactor,
        pointRadius,
        pointOpacity,
        pointColor: targetPointColor,
      }
    );
  }

  /**
   * Initialize trajectories (trajectory elements + total path length)
   */
  function initializeTrajectories() {
    if (!svg || !isDataValid || selectedTrajectoryIndices.length === 0) return;

    const d3Svg = d3.select(svg);
    const trajectoriesGroup = d3Svg.select(".trajectories");
    const katexLabelsGroup = d3Svg.select("#katexLabels");

    // Compute combined mean for positioning (needed for start point)
    const allSourceX = sourceDistributionSamples.map((p) => p[0]);
    const allTargetX = targetDistributionSamples.map((p) => p[0]);
    const combinedMeanX =
      [...allSourceX, ...allTargetX].reduce((a, b) => a + b, 0) /
      (allSourceX.length + allTargetX.length);

    // Pre-compute total path lengths for all trajectories
    for (let idx = 0; idx < selectedTrajectoryIndices.length; idx++) {
      const fullPath = generateTrajectoryPath(idx);

      // Create temporary path to measure total length
      const tempFullPath = trajectoriesGroup.append("path").attr("d", fullPath);
      const totalLength = tempFullPath.node().getTotalLength();
      trajectoryLengths.set(idx, totalLength);
      tempFullPath.remove();
    }

    // Initialize trajectory SVG elements (geometry paths + clipPaths + progress paths + markers)
    const defs = d3Svg.select("defs");

    for (let idx = 0; idx < selectedTrajectoryIndices.length; idx++) {
      const fullPath = generateTrajectoryPath(idx);
      const totalLength = trajectoryLengths.get(idx) || 0;

      // Geometry path (hidden, never dashed, used only for getPointAtLength)
      const geometryPath = trajectoriesGroup
        .append("path")
        .attr("class", `trajectory-geometry-${idx}`)
        .attr("d", fullPath)
        .attr("fill", "none")
        .attr("stroke", "none");

      // ClipPath with rectangle for progress reveal (no dasharray!)
      const clipPath = defs
        .append("clipPath")
        .attr("id", `trajectory-clip-${idx}`);

      // Rectangle that grows horizontally to reveal the path
      clipPath
        .append("rect")
        .attr("class", `trajectory-clip-rect-${idx}`)
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", 0)
        .attr("height", height);

      // Full path (background/preview) - shows complete trajectory at lower opacity
      trajectoriesGroup
        .append("path")
        .attr("class", `trajectory-full-${idx}`)
        .attr("d", fullPath)
        .attr("fill", "none")
        .attr("stroke", trajectoryColor)
        .attr("stroke-width", trajectoryStrokeWidth)
        .attr("opacity", trajectoryFullOpacity);

      // Progress path (animated) - solid stroke, clipped by growing rectangle
      trajectoriesGroup
        .append("path")
        .attr("class", `trajectory-progress-${idx}`)
        .attr("d", fullPath)
        .attr("fill", "none")
        .attr("stroke", trajectoryColor)
        .attr("stroke-width", trajectoryStrokeWidth)
        .attr("opacity", trajectoryProgressOpacity)
        .attr("clip-path", `url(#trajectory-clip-${idx})`);

      // Circle marker (moving dot)
      trajectoriesGroup
        .append("circle")
        .attr("class", `trajectory-point-${idx}`)
        .attr("r", trajectoryPointRadius)
        .attr("fill", trajectoryColor)
        .attr("opacity", trajectoryProgressOpacity);

      // Start point dot (fixed at t=0 position)
      const trajectoryData = getTrajectoryData(selectedTrajectoryIndices[idx]);
      const startPoint = trajectoryData[0];
      const startX = getPixelX(startPoint[0], combinedMeanX, 0);
      const startY = scales.yScale(startPoint[1]);

      trajectoriesGroup
        .append("circle")
        .attr("class", "start-point")
        .attr("cx", startX)
        .attr("cy", startY)
        .attr("r", trajectoryPointRadius)
        .attr("fill", trajectoryColor);

      // KaTeX label "x" above start point
      plotKatexInSVG(katexLabelsGroup, "x", startX, startY, {
        fontSize: pointLabelFontSize,
        bg: false,
        color: figureLatexColor,
        anchor: "bottom-center",
        offsetY: labelAbovePointOffset,
        outline: katexOutline,
        outlineColor: katexOutlineColor,
        outlineWidth: katexOutlineWidth,
        outlineOpacity: katexOutlineOpacity,
      });

      // KaTeX label "ψ_t(x)" above trajectory midpoint
      const midLength = totalLength / 2;
      const geometryPathNode = geometryPath.node();
      if (geometryPathNode) {
        const midPoint = geometryPathNode.getPointAtLength(midLength);
        plotKatexInSVG(katexLabelsGroup, "\\psi_t(x)", midPoint.x, midPoint.y, {
          fontSize: pointLabelFontSize,
          bg: false,
          color: figureLatexColor,
          anchor: "bottom-center",
          offsetX: 20,
          offsetY: labelAbovePointOffset,
          outline: katexOutline,
          outlineColor: katexOutlineColor,
          outlineWidth: katexOutlineWidth,
          outlineOpacity: katexOutlineOpacity,
        });
      }
    }

    pathsInitialized = true;

    // Initial update
    updateVisualization();
  }

  /**
   * Update visualization based on current state
   */
  function updateVisualization() {
    if (
      !svg ||
      !isDataValid ||
      selectedTrajectoryIndices.length === 0 ||
      !pathsInitialized
    )
      return;

    const d3Svg = d3.select(svg);

    // Update trajectories
    for (let idx = 0; idx < selectedTrajectoryIndices.length; idx++) {
      const geometryPath = d3Svg.select(`.trajectory-geometry-${idx}`).node();
      const clipRect = d3Svg.select(`.trajectory-clip-rect-${idx}`);

      const totalLength = trajectoryLengths.get(idx) || 0;
      const visibleLength = totalLength * time;

      // Use the hidden geometry path for getPointAtLength (cross-browser fix)
      if (geometryPath && totalLength > 0) {
        const point = geometryPath.getPointAtLength(visibleLength);

        // Sync clip rectangle width with marker's X position
        clipRect.attr("width", point.x + trajectoryStrokeWidth);

        // Update marker position
        d3Svg
          .select(`.trajectory-point-${idx}`)
          .attr("cx", point.x)
          .attr("cy", point.y);
      }
    }
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

    // Handle pause before restart
    if (isPaused && pauseStartTime !== null) {
      const pauseElapsed = timestamp - pauseStartTime;

      if (pauseElapsed >= pauseBeforeRestart) {
        // Pause complete - restart animation
        isPaused = false;
        pauseStartTime = null;
        lastTimestamp = null;
        time = 0;
        updateVisualization();
      }

      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    // Update time
    time += elapsed / animationDuration;

    if (time >= 1.0) {
      time = 1.0;
      updateVisualization();

      // Start pause before restarting
      isPaused = true;
      pauseStartTime = timestamp;
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

<Figure
  {caption}
  {backgroundVisible}
  bind:isActive={figureIsActive}
  onContentClick={toggleAnimation}
>
  {#snippet children()}
    <div
      style="display: flex; flex-direction: column; align-items: center; width: 100%;"
    >
      <div
        style="position: relative; width: 100%; display: flex; justify-content: center;"
      >
        <PlayButton {isPlaying} onclick={toggleAnimation} {time} />
        <svg
          bind:this={svg}
          viewBox="0 0 {width} {height}"
          preserveAspectRatio="xMidYMid meet"
          style="width: 100%; height: auto; max-width: {width}px; aspect-ratio: {width} / {height};"
        >
        </svg>
      </div>
    </div>
  {/snippet}
</Figure>
