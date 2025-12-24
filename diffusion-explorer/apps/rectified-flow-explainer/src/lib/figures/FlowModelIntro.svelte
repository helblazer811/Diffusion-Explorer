<!-- This figure shows a source distribution mapped to a target distribution. Also shows the trajectory of an individual sample. -->

<script>
  import { onMount } from "svelte";
  import * as d3 from "d3";
  import Figure from "$lib/components/Figure.svelte";
  import PlayButton from "$lib/components/PlayButton.svelte";
  import { settings } from "$lib/settings";

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
  export let height = 300;

  // Styling props for visualization
  export let sourcePointColor = "#3b82f6"; // Blue
  export let targetPointColor = "#3b82f6"; // Blue
  export let marginWidth = 20;
  export let marginHeight = 20;
  export let sourceLabelText = "Source Distribution";
  export let targetLabelText = "Target Distribution";
  export let labelFontSize = settings.labelStyling.fontSize;
  export let labelColor = settings.labelStyling.color;
  export let pointRadius = 5;
  export let pointOpacity = 0.25;
  export let flowWidth = 10; // Gap between source and target in data units
  export let yShiftFactor = -0.5; // Vertical shift for distributions (positive shifts down)

  // Animation settings
  export let animationDuration = 8000; // Duration in milliseconds
  export let playingByDefault = true;
  export let animationPauseTime = 1000; // Pause time between loops in milliseconds

  // Contour plot settings
  export let showContours = true;
  export let contourBandwidth = 0.3;
  export let contourLevels = 5;
  export let contourOpacity = 0.25;
  export let sourceContourColor = "#3b82f6"; // Blue
  export let targetContourColor = "#3b82f6"; // Blue
  export let intermediateContourColor = "#f17720"; // Orange
  export let intermediateContourOpacity = 0.2; // Higher opacity for intermediate contours
  export let intermediatePointOpacity = 0.7; // Higher opacity for intermediate scatter points
  export let trainingObjective = "Flow Matching";

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
  let xScale = null;
  let yScale = null;
  let time = 0; // Animation time parameter (0 to 1)
  let animationFrameId = null;

  // Local animation control state
  let isPlaying = playingByDefault;
  let isPausedByFigure = false;

  // Update isPausedByFigure when isPlaying changes
  $: isPausedByFigure = !isPlaying;

  function toggleAnimation() {
    isPlaying = !isPlaying;
  }

  /**
   * Create D3 scales for plotting
   */
  function createScales(sourcePoints, targetPoints) {
    const drawableWidth = width - 2 * marginWidth;
    const drawableHeight = height - 2 * marginHeight;
    const aspectRatio = drawableHeight / drawableWidth;

    // Shift target points by flowWidth for extent calculation
    const shiftedTargetPoints = targetPoints.map((p) => [
      p[0] + flowWidth,
      p[1],
    ]);

    // Combine both point sets to get overall extent
    const allPoints = [...sourcePoints, ...shiftedTargetPoints];

    const xExtent = d3.extent(allPoints, (d) => d[0]);
    const yExtent = d3.extent(allPoints, (d) => d[1]);

    const xRange = xExtent[1] - xExtent[0];
    const yRange = yExtent[1] - yExtent[0];

    const xCenter = (xExtent[0] + xExtent[1]) / 2;
    const yCenter = (yExtent[0] + yExtent[1]) / 2;

    // Adjust ranges to match aspect ratio
    let adjustedXRange = xRange;
    let adjustedYRange = yRange;

    if (yRange / xRange > aspectRatio) {
      adjustedXRange = yRange / aspectRatio;
    } else {
      adjustedYRange = xRange * aspectRatio;
    }

    // Shift y center down to accommodate labels at the top and apply yShiftFactor
    const yCenterOffset = -adjustedYRange * 0.07 - yShiftFactor;

    xScale = d3
      .scaleLinear()
      .domain([xCenter - adjustedXRange / 2, xCenter + adjustedXRange / 2])
      .range([marginWidth, width - marginWidth]);

    yScale = d3
      .scaleLinear()
      .domain([
        yCenter - adjustedYRange / 2 - yCenterOffset,
        yCenter + adjustedYRange / 2 - yCenterOffset,
      ])
      .range([marginHeight, height - marginHeight]);
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
    if (!svgElement || !xScale || !yScale || points.length === 0) return;

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
   */
  function updateScatter(points, groupId, time) {
    if (!svgElement || !xScale || !yScale || points.length === 0) return;

    const xShift = time * flowWidth;
    const svg = d3.select(svgElement);
    const group = svg.select(`#${groupId}`);

    group
      .selectAll("circle")
      .data(points)
      .attr("cx", (d) => xScale(d[0] + xShift))
      .attr("cy", (d) => yScale(d[1]));
  }

  /**
   * Compute contour density (pure computation, returns GeoJSON)
   */
  function computeContours(points, time) {
    if (!xScale || !yScale || points.length === 0) return [];

    const xShift = time * flowWidth;
    const shiftedPoints = points.map((p) => [p[0] + xShift, p[1]]);
    const transformedPoints = shiftedPoints.map((p) => [
      xScale(p[0]),
      yScale(p[1]),
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
    if (!xScale || !yScale) return;
    if (
      sourceDistributionSamples.length === 0 ||
      targetDistributionSamples.length === 0
    )
      return;

    console.log("Precomputing contours...");

    // Precompute source and target contours (static)
    precomputedSourceContours = computeContours(sourceDistributionSamples, 0);
    precomputedTargetContours = computeContours(targetDistributionSamples, 1);

    // Precompute intermediate contours for all timesteps
    const allSamples = $allTimeSamples;
    precomputedIntermediateContours = [];

    for (let i = 0; i < allSamples.length; i++) {
      const samples = allSamples[i];
      const timeValue = i / (allSamples.length - 1); // 0 to 1
      const contours = computeContours(samples, timeValue);
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
   * Plot distribution labels above source and target
   */
  function plotLabels() {
    if (!svgElement || !xScale || !yScale) return;
    if (
      sourceDistributionSamples.length === 0 ||
      targetDistributionSamples.length === 0
    )
      return;

    const svg = d3.select(svgElement);
    const labelsGroup = svg.select("#labels");

    // Clear existing labels
    labelsGroup.selectAll("*").remove();

    // Calculate positions for labels
    // Source label: above source distribution (centered at x=0 in data space)
    const sourceLabelX = xScale(0);

    // Target label: above target distribution (centered at x=flowWidth in data space)
    const targetLabelX = xScale(flowWidth);

    // Get the y position from the top of the data domain
    const yDomain = yScale.domain();
    const yTop = yDomain[0]; // Min value maps to top of screen with this scale
    const labelY = yScale(yTop) + 0.5 * labelFontSize; // Position above the top (subtract to move up in SVG)

    // Add source distribution label with white outline
    labelsGroup
      .append("text")
      .attr("x", sourceLabelX)
      .attr("y", labelY)
      .attr("text-anchor", "middle")
      .attr("font-size", `${labelFontSize}px`)
      .attr("fill", labelColor)
      .attr("stroke", "#ffffff")
      .attr("stroke-width", "4")
      .attr("paint-order", "stroke")
      .text(sourceLabelText);

    // Add target distribution label with white outline
    labelsGroup
      .append("text")
      .attr("x", targetLabelX)
      .attr("y", labelY)
      .attr("text-anchor", "middle")
      .attr("font-size", `${labelFontSize}px`)
      .attr("fill", labelColor)
      .attr("stroke", "#ffffff")
      .attr("stroke-width", "4")
      .attr("paint-order", "stroke")
      .text(targetLabelText);
  }

  /**
   * Central drawing function - updates all visualizations (called every frame)
   */
  function draw() {
    if (!svgElement || !xScale || !yScale) return;
    if (
      sourceDistributionSamples.length === 0 ||
      targetDistributionSamples.length === 0
    )
      return;

    // Update static distributions scatter plots
    if (showSourceScatter) {
      updateScatter(sourceDistributionSamples, "sourceScatter", 0);
    }
    if (showTargetScatter) {
      updateScatter(targetDistributionSamples, "targetScatter", 1);
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
          updateScatter(intermediateSamples, "intermediateScatter", time);
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
    createScales(sourceDistributionSamples, targetDistributionSamples);

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
    plotLabels();
  }

  /**
   * Initialize contours (heavy: precompute all contours)
   */
  function initializeContours() {
    // Precompute all contours for performance
    precomputeAllContours();

    // Initial draw
    draw();
  }

  /**
   * Start the animation loop
   */
  function startAnimation() {
    let startTime = null;
    let isPaused = false;
    let pauseStartTime = null;
    let pausedElapsedTime = 0; // Track time when paused by figure button

    function animate(currentTime) {
      // Check if paused by figure button
      if (isPausedByFigure) {
        // Store the elapsed time when paused
        if (startTime !== null && pausedElapsedTime === 0) {
          pausedElapsedTime = currentTime - startTime;
        }
        // Keep requesting frames but don't update time
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      // Resume from pause: adjust startTime to account for paused duration
      if (pausedElapsedTime > 0) {
        startTime = currentTime - pausedElapsedTime;
        pausedElapsedTime = 0;
      }

      if (startTime === null) {
        startTime = currentTime;
      }

      const elapsed = currentTime - startTime;

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
          startTime = currentTime;
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

  // Reactive initialization flag
  let isInitialized = false;

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

<Figure {caption}>
  {#snippet children()}
    <PlayButton {isPlaying} onclick={toggleAnimation} />
    <svg
      bind:this={svgElement}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      style="width: 100%; height: auto; max-width: {width}px;"
    >
    </svg>
  {/snippet}
</Figure>
