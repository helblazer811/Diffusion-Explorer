<!-- This figure shows a source distribution mapped to a target distribution. Also shows the trajectory of an individual sample. -->

<script>
  import { onMount } from "svelte";
  import * as d3 from "d3";
  import Figure from "$lib/components/Figure.svelte";
  import TimeSlider from "$lib/components/TimeSlider.svelte";
  import { settings } from "$lib/settings";
  import { createSourceTargetScales } from "$lib/d3_helpers";
  import { plotKatexInSVG } from "@diffusion-explorer/ui";

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props (from parent +page.svelte)
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];
  export let allTimeSamples;
  export let isTraining;

  // Props/Configuration
  export let width = 800;
  export let height = 320;

  // Styling props for visualization
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceLabelText = "Source Distribution";
  export let targetLabelText = "Target Distribution";
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;
  export let outlineColor = settings.stylingSettings.label.outlineColor;
  export let outlineOpacity = settings.stylingSettings.label.outlineOpacity;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX = settings.stylingSettings.layout.targetCenterX;
  export let yShiftFactor = -1.0;
  export let distributionScaleFactor = 0.6;

  // Animation settings
  export let animationDuration = 8000; // Duration in milliseconds
  export let playingByDefault = true;
  export let animationPauseTime = 1000; // Pause time between loops in milliseconds

  // Contour plot settings
  export let showContours = false;
  export let contourBandwidth = 0.3;
  export let contourLevels = 5;
  export let contourOpacity = 0.25;
  export let sourceContourColor = "#3b82f6"; // Blue
  export let targetContourColor = "#3b82f6"; // Blue
  export let intermediateContourColor = "#f17720"; // Orange
  export let intermediateContourOpacity = 0.2; // Higher opacity for intermediate contours
  export let intermediatePointOpacity = 0.7; // Higher opacity for intermediate scatter points
  export let trainingObjective = "Flow Matching";

  // Background visibility
  export let backgroundVisible = true;

  // Visibility controls for each visualization element
  export let showSourceScatter = true;
  export let showTargetScatter = true;
  export let showSourceContour = false;
  export let showTargetContour = false;
  export let showIntermediateScatter = true;
  export let showIntermediateContour = true;

  // Precomputed contours for performance
  let precomputedSourceContours = [];
  let precomputedTargetContours = [];
  let precomputedIntermediateContours = []; // Array of contours for each timestep

  let svgElement;
  let scales = null; // Full scales object from createSourceTargetScales
  let time = 0; // Animation time parameter (0 to 1)
  let animationFrameId = null;
  let animationStartTime = null; // Component-level for slider sync

  // Local animation control state
  let isPlaying = playingByDefault;
  let isPausedByFigure = false;

  // Visibility-based animation control
  let figureIsActive;
  let wasPlayingBeforeHidden = false;
  let isInitialized = false;

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

  /**
   * Compute pixel x position for a point at a given time
   * At t=0, centered at source; at t=1, centered at target
   */
  function getPixelX(dataX, dataMeanX, t) {
    if (!scales) return 0;
    const centerPixelX = scales.sourceCenterPixelX + t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - dataMeanX) * scales.xScaleFactor;
  }

  /**
   * Initialize persistent SVG layers (called once)
   */
  function initializeLayers() {
    const svg = d3.select(svgElement);

    // Create persistent layers in correct z-order (bottom to top)
    // Intermediate elements are on top for better visibility
    svg.append("g").attr("id", "sourceContour");
    svg.append("g").attr("id", "targetContour");
    svg.append("g").attr("id", "sourceScatter");
    svg.append("g").attr("id", "targetScatter");
    svg.append("g").attr("id", "intermediateContour");
    svg.append("g").attr("id", "intermediateScatter");
    svg.append("g").attr("id", "labels");
    svg.append("g").attr("id", "intermediateLabel");
  }

  /**
   * Initialize scatter plot (called once per distribution)
   */
  function initScatter(
    points,
    color,
    groupId,
    opacity = pointOpacity
  ) {
    if (!svgElement || !scales || points.length === 0) return;

    const svg = d3.select(svgElement);
    const group = svg.select(`#${groupId}`);

    group
      .selectAll("circle")
      .data(points)
      .enter()
      .append("circle")
      .attr("r", pointRadius)
      .attr("fill", color)
      .attr("opacity", opacity);
  }

  /**
   * Update scatter plot positions (called every frame)
   * @param points - data points
   * @param groupId - SVG group ID
   * @param t - time (0 = source position, 1 = target position)
   * @param meanX - mean x value for centering (typically 0 for normalized data)
   */
  function updateScatter(points, groupId, t, meanX = 0) {
    if (!svgElement || !scales || points.length === 0) return;

    const svg = d3.select(svgElement);
    const group = svg.select(`#${groupId}`);

    group
      .selectAll("circle")
      .data(points)
      .attr("cx", (d) => getPixelX(d[0], meanX, t))
      .attr("cy", (d) => scales.yScale(d[1]));
  }

  /**
   * Compute contour density (pure computation, returns GeoJSON)
   */
  function computeContours(points, t, meanX = 0) {
    if (!scales || points.length === 0) return [];

    // Transform points to pixel coordinates
    const transformedPoints = points.map((p) => [
      getPixelX(p[0], meanX, t),
      scales.yScale(p[1]),
    ]);

    return d3
      .contourDensity()
      .x((d) => d[0])
      .y((d) => d[1])
      .size([width, height])
      .bandwidth((contourBandwidth * width) / 10)
      .thresholds(contourLevels)(transformedPoints);
  }

  /**
   * Precompute all contours for all timesteps
   */
  function precomputeAllContours() {
    if (!scales) return;
    if (
      sourceDistributionSamples.length === 0 ||
      targetDistributionSamples.length === 0
    )
      return;

    console.log("Precomputing contours...");

    // Precompute source and target contours (static)
    precomputedSourceContours = computeContours(sourceDistributionSamples, 0, scales.sourceMeanX);
    precomputedTargetContours = computeContours(targetDistributionSamples, 1, scales.targetMeanX);

    // Precompute intermediate contours for all timesteps
    const allSamples = $allTimeSamples;
    precomputedIntermediateContours = [];

    for (let i = 0; i < allSamples.length; i++) {
      const samples = allSamples[i];
      const timeValue = i / (allSamples.length - 1); // 0 to 1
      // For intermediate samples, compute their mean x for centering
      const sampleMeanX = samples.reduce((sum, p) => sum + p[0], 0) / samples.length;
      const contours = computeContours(samples, timeValue, sampleMeanX);
      precomputedIntermediateContours.push(contours);
    }

    console.log("Precomputed contours:", {
      source: precomputedSourceContours.length,
      target: precomputedTargetContours.length,
      intermediate: precomputedIntermediateContours.length,
    });
  }

  /**
   * Update contour paths (DOM update only, called every frame)
   */
  function updateContour(
    groupId,
    contours,
    color,
    opacity = contourOpacity
  ) {
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    const group = svg.select(`#${groupId}`);

    group
      .selectAll("path")
      .data(contours)
      .join("path") // ✅ Efficiently handles enter/update/exit
      .attr("d", d3.geoPath())
      .attr("fill", color)
      .attr("stroke", "none")
      .attr("fill-opacity", opacity);
  }

  /**
   * Plot distribution labels above source and target using KaTeX
   */
  function plotKatexLabels() {
    if (!svgElement || !scales) return;
    if (
      sourceDistributionSamples.length === 0 ||
      targetDistributionSamples.length === 0
    )
      return;

    const svg = d3.select(svgElement);
    const labelsGroup = svg.select("#labels");

    // Clear existing labels
    labelsGroup.selectAll("*").remove();

    // Compute y positions
    const yDomain = scales.yScale.domain();
    const yTop = yDomain[0];
    const textLabelY = scales.yScale(yTop) + 0.5 * labelFontSize;
    const mathLabelY = textLabelY + labelFontSize - 10;

    // Text labels (Source/Target Distribution)
    labelsGroup.append("text")
      .attr("x", scales.sourceCenterPixelX)
      .attr("y", textLabelY)
      .attr("text-anchor", "middle")
      .attr("font-size", `${labelFontSize}px`)
      .attr("fill", labelColor)
      .text(sourceLabelText);

    labelsGroup.append("text")
      .attr("x", scales.targetCenterPixelX)
      .attr("y", textLabelY)
      .attr("text-anchor", "middle")
      .attr("font-size", `${labelFontSize}px`)
      .attr("fill", labelColor)
      .text(targetLabelText);

    // Math labels (p_0, p_1) below - offset to center (plotKatexInSVG positions from left edge)
    const katexCenterOffset = 15;
    plotKatexInSVG(labelsGroup, 'p_0', scales.sourceCenterPixelX - katexCenterOffset, mathLabelY, {
      fontSize: labelFontSize,
      bg: false,
      color: labelColor
    });

    plotKatexInSVG(labelsGroup, 'p_1', scales.targetCenterPixelX - katexCenterOffset, mathLabelY, {
      fontSize: labelFontSize,
      bg: false,
      color: labelColor
    });
  }

  /**
   * Update the moving p_t label position (called every frame)
   */
  function updateIntermediateLabel() {
    if (!svgElement || !scales) return;

    const svg = d3.select(svgElement);
    const group = svg.select("#intermediateLabel");

    // Hide p_t when too close to endpoints
    if (time < 0.1 || time > 0.9) {
      group.selectAll("*").remove();
      return;
    }

    // Compute x position (interpolate between source and target centers)
    const centerPixelX = scales.sourceCenterPixelX + time * (scales.targetCenterPixelX - scales.sourceCenterPixelX);

    // Compute y position (same as p_0 and p_1)
    const yDomain = scales.yScale.domain();
    const yTop = yDomain[0];
    const textLabelY = scales.yScale(yTop) + 0.5 * labelFontSize;
    const mathLabelY = textLabelY + labelFontSize - 10;

    // Clear and re-render - offset to center (plotKatexInSVG positions from left edge)
    const katexCenterOffset = 15;
    group.selectAll("*").remove();
    plotKatexInSVG(group, 'p_t', centerPixelX - katexCenterOffset, mathLabelY, {
      fontSize: labelFontSize,
      bg: false,
      color: labelColor
    });
  }

  /**
   * Central drawing function - updates all visualizations (called every frame)
   */
  function draw() {
    if (!svgElement || !scales) return;
    if (
      sourceDistributionSamples.length === 0 ||
      targetDistributionSamples.length === 0
    )
      return;

    // Update static distributions scatter plots
    if (showSourceScatter) {
      updateScatter(sourceDistributionSamples, "sourceScatter", 0, scales.sourceMeanX);
    }
    if (showTargetScatter) {
      updateScatter(targetDistributionSamples, "targetScatter", 1, scales.targetMeanX);
    }

    // Update source and target contours (use precomputed)
    if (
      showSourceContour &&
      showContours &&
      precomputedSourceContours.length > 0
    ) {
      updateContour(
        "sourceContour",
        precomputedSourceContours,
        sourceContourColor
      );
    }

    if (
      showTargetContour &&
      showContours &&
      precomputedTargetContours.length > 0
    ) {
      updateContour(
        "targetContour",
        precomputedTargetContours,
        targetContourColor
      );
    }

    // Update animated intermediate samples
    const allSamples = $allTimeSamples;
    if (allSamples.length > 0) {
      const numSteps = allSamples.length;
      const currentStep = Math.round(time * (numSteps - 1));
      const intermediateSamples = allSamples[currentStep];

      if (intermediateSamples && intermediateSamples.length > 0) {
        if (showIntermediateScatter) {
          // Compute mean for current intermediate samples
          const sampleMeanX = intermediateSamples.reduce((sum, p) => sum + p[0], 0) / intermediateSamples.length;
          updateScatter(intermediateSamples, "intermediateScatter", time, sampleMeanX);
        }

        // Use precomputed intermediate contours
        if (
          showIntermediateContour &&
          showContours &&
          precomputedIntermediateContours.length > 0
        ) {
          const intermediateContours =
            precomputedIntermediateContours[currentStep];
          if (intermediateContours) {
            updateContour(
              "intermediateContour",
              intermediateContours,
              intermediateContourColor,
              intermediateContourOpacity
            );
          }
        }
      }
    }

    // Update the moving p_t label
    updateIntermediateLabel();
  }

  /**
   * Initialize visualization (lightweight: scatter plots + labels)
   */
  function initializeVisualization() {
    if (!svgElement) return;
    if (
      sourceDistributionSamples.length === 0 ||
      targetDistributionSamples.length === 0
    )
      return;

    // 1. Initialize layers
    initializeLayers();

    // 2. Create scales once
    scales = createSourceTargetScales(sourceDistributionSamples, targetDistributionSamples, {
      width, height, marginWidth, marginHeight, sourceCenterX, targetCenterX, yShiftFactor, distributionScaleFactor
    });

    // 3. Initialize scatter plots (creates DOM nodes)
    if (showSourceScatter) {
      initScatter(sourceDistributionSamples, sourcePointColor, "sourceScatter");
    }
    if (showTargetScatter) {
      initScatter(targetDistributionSamples, targetPointColor, "targetScatter");
    }

    const allSamples = $allTimeSamples;
    if (allSamples.length > 0 && allSamples[0] && showIntermediateScatter) {
      initScatter(
        allSamples[0],
        intermediateContourColor,
        "intermediateScatter",
        intermediatePointOpacity
      );
    }

    // 4. Plot labels
    plotKatexLabels();
  }

  /**
   * Initialize contours (heavy: precompute all contours)
   */
  function initializeContours() {
    // Only precompute contours if they are enabled
    if (showContours) {
      precomputeAllContours();
    }

    // Initial draw
    draw();
  }

  /**
   * Start the animation loop
   */
  function startAnimation() {
    let isPaused = false;
    let pauseStartTime = null;
    let pausedElapsedTime = 0; // Track time when paused by figure button

    function animate(currentTime) {
      // Check if paused by figure button
      if (isPausedByFigure) {
        // Store the elapsed time when paused
        if (animationStartTime !== null && pausedElapsedTime === 0) {
          pausedElapsedTime = currentTime - animationStartTime;
        }
        // Keep requesting frames but don't update time
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      // Resume from pause: adjust startTime to account for paused duration
      if (pausedElapsedTime > 0) {
        animationStartTime = currentTime - pausedElapsedTime;
        pausedElapsedTime = 0;
      }

      if (animationStartTime === null) {
        animationStartTime = currentTime;
      }

      const elapsed = currentTime - animationStartTime;

      // Check if we're in pause period (between animation loops)
      if (elapsed >= animationDuration) {
        if (!isPaused) {
          isPaused = true;
          pauseStartTime = currentTime;
          time = 1; // Ensure we end at 1
          draw(); // ✅ Only updates attributes, no DOM creation
        }

        if (
          pauseStartTime &&
          currentTime - pauseStartTime >= animationPauseTime
        ) {
          // Reset for next loop
          animationStartTime = currentTime;
          isPaused = false;
          pauseStartTime = null;
          time = 0;
        }
      } else {
        // Update time during animation
        time = Math.min(elapsed / animationDuration, 1);
        draw(); // ✅ Only updates attributes, no DOM creation
      }

      animationFrameId = requestAnimationFrame(animate);
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Stop the animation loop
   */
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
  $: if (
    !isInitialized &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    $allTimeSamples.length > 0 &&
    svgElement
  ) {
    initializeVisualization(); // Lightweight: scatter + labels
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        initializeContours(); // Heavy: precompute contours
        isInitialized = true;
        startAnimation();
      });
    });
  }

  // Cleanup on component destroy
  onMount(() => {
    return () => {
      stopAnimation();
    };
  });
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <svg
        bind:this={svgElement}
        viewBox={`0 0 ${width} ${height}`}
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
        color="#f17720"
      />
    </div>
  {/snippet}
</Figure>
