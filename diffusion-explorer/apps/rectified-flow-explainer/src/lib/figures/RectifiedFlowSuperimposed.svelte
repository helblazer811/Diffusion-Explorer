<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import DoubleFigure from "$lib/components/DoubleFigure.svelte";
  import PlayButton from "$lib/components/PlayButton.svelte";

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props
  export let allRectifiedTrajectories = []; // [rectifiedStep][timestep][sample][dim]
  export let targetDistribution = []; // The actual target distribution points

  // Data validation
  $: isDataValid =
    allRectifiedTrajectories &&
    allRectifiedTrajectories.length >= 2 &&
    allRectifiedTrajectories[0] &&
    allRectifiedTrajectories[0].length > 0 &&
    allRectifiedTrajectories[1] &&
    allRectifiedTrajectories[1].length > 0 &&
    targetDistribution &&
    targetDistribution.length > 0;

  // Configuration props
  export let margin = 40;
  export let svgWidth = 300;
  export let svgHeight = 300;
  export let trajectoryColor = "#f17720"; // Orange
  export let targetColor = "#3b82f6"; // Blue
  export let targetOpacity = 0.35;
  export let targetPointRadius = 5;
  export let numTrajectoriesToShow = 10;

  // Trajectory styling (matching RectifiedFlowVisualization)
  export let trajectoryFullOpacity = 0.3; // Background paths
  export let trajectoryProgressOpacity = 0.8; // Animated paths
  export let trajectoryStrokeWidth = 3;
  export let trajectoryPointRadius = 5;
  export let animationDuration = 5000; // ms per full loop
  export let playingByDefault = true;
  export let pauseDuration = 1000; // ms pause at end of animation
  export let leftLabel = "Before Rectification";
  export let rightLabel = "After Rectification";
  export let labelFontSize = 22;
  export let labelColor = "#666";
  export let gap = 50;
  export let domainRange = { xMin: -1.7, xMax: 1.7, yMin: -1.7, yMax: 1.7 };

  // Callback when visualization is initialized
  export let onInitialized = undefined;

  // SVG references
  let leftSvgElement;
  let rightSvgElement;

  // Scales
  let xScale;
  let yScale;

  // Animation state
  let currentTimeIndex = 0;
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let isInitialized = false;
  let selectedTrajectoryIndices = [];

  /**
   * Select random trajectory indices (same for both panels)
   */
  function selectTrajectoryIndices() {
    if (!isDataValid) return;

    const numAvailable = allRectifiedTrajectories[0]?.[0]?.length || 0;
    const numToSelect = Math.min(numTrajectoriesToShow, numAvailable);

    const indices = [];
    const availableIndices = Array.from({ length: numAvailable }, (_, i) => i);

    for (let i = 0; i < numToSelect; i++) {
      const randomIndex = Math.floor(Math.random() * availableIndices.length);
      indices.push(availableIndices.splice(randomIndex, 1)[0]);
    }

    selectedTrajectoryIndices = indices;
  }

  function initializeScales() {
    if (!isDataValid) return;

    const { xMin, xMax, yMin, yMax } = domainRange;

    // Create scales with no translation
    xScale = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .range([margin, svgWidth - margin]);

    yScale = d3
      .scaleLinear()
      .domain([yMin, yMax])
      .range([margin, svgHeight - margin]);
  }

  function initializeSvg(svgElement, targetDistribution, label) {
    if (!svgElement || !xScale || !yScale) return;

    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();

    // Add target distribution scatter
    const targetGroup = svg.append("g").attr("id", "target-scatter");

    targetGroup
      .selectAll("circle")
      .data(targetDistribution)
      .enter()
      .append("circle")
      .attr("cx", d => xScale(d[0]))
      .attr("cy", d => yScale(d[1]))
      .attr("r", targetPointRadius)
      .attr("fill", targetColor)
      .attr("opacity", targetOpacity);

    // Add trajectory path group
    svg.append("g").attr("id", "trajectory-group");

    // Add current position markers for each trajectory
    const markersGroup = svg.append("g").attr("id", "markers-group");
    for (let i = 0; i < selectedTrajectoryIndices.length; i++) {
      markersGroup
        .append("circle")
        .attr("class", `current-position-${i}`)
        .attr("r", trajectoryPointRadius)
        .attr("fill", trajectoryColor)
        .attr("opacity", trajectoryProgressOpacity);
    }

    // Add label at top center with background rectangle
    const labelGroup = svg.append("g").attr("class", "label-group");
    const labelX = svgWidth / 2;
    const labelY = margin / 2 + labelFontSize / 2;
    const labelPaddingX = 10;
    const labelPaddingY = 4;

    // Add text first to measure it
    const textElement = labelGroup
      .append("text")
      .attr("class", "panel-label")
      .attr("x", labelX)
      .attr("y", labelY)
      .attr("text-anchor", "middle")
      .attr("font-size", `${labelFontSize}px`)
      .attr("fill", labelColor)
      .text(label);

    // Get text bounding box and add background rect
    const bbox = textElement.node().getBBox();
    labelGroup
      .insert("rect", "text")
      .attr("x", bbox.x - labelPaddingX)
      .attr("y", bbox.y - labelPaddingY)
      .attr("width", bbox.width + 2 * labelPaddingX)
      .attr("height", bbox.height + 2 * labelPaddingY)
      .attr("fill", "#f9f9f9")
      .attr("opacity", 0.9);
  }

  function initializeVisualization() {
    if (!leftSvgElement || !rightSvgElement || !isDataValid) return;

    initializeScales();
    selectTrajectoryIndices();
    initializeSvg(leftSvgElement, targetDistribution, leftLabel);
    initializeSvg(rightSvgElement, targetDistribution, rightLabel);
    updateVisualization(currentTimeIndex);
    isInitialized = true;
    onInitialized?.();
  }

  function updatePanel(svgElement, rectifiedStep, timeIndex) {
    if (!svgElement || !isDataValid || !xScale || !yScale) return;

    const svg = d3.select(svgElement);
    const stepData = allRectifiedTrajectories[rectifiedStep];
    const numTimeSteps = stepData.length;

    // Map timeIndex to trajectory timestep
    const trajectoryTimeIndex = Math.floor(
      (timeIndex / (numTimeSteps - 1)) * (numTimeSteps - 1)
    );

    // Update trajectory paths
    const trajectoryGroup = svg.select("#trajectory-group");
    trajectoryGroup.selectAll("*").remove();

    // Draw all selected trajectories
    for (let i = 0; i < selectedTrajectoryIndices.length; i++) {
      const sampleIdx = selectedTrajectoryIndices[i];
      const trajectoryPoints = stepData.map((timestep) => timestep[sampleIdx]);

      // Draw full trajectory path (lighter)
      const fullPath = trajectoryPoints
        .map((point, j) => {
          const [x, y] = point;
          return `${j === 0 ? "M" : "L"} ${xScale(x)},${yScale(y)}`;
        })
        .join(" ");

      trajectoryGroup
        .append("path")
        .attr("d", fullPath)
        .attr("fill", "none")
        .attr("stroke", trajectoryColor)
        .attr("stroke-width", trajectoryStrokeWidth)
        .attr("opacity", trajectoryFullOpacity);

      // Draw animated trajectory path (up to current time)
      const animatedPath = trajectoryPoints
        .slice(0, trajectoryTimeIndex + 1)
        .map((point, j) => {
          const [x, y] = point;
          return `${j === 0 ? "M" : "L"} ${xScale(x)},${yScale(y)}`;
        })
        .join(" ");

      if (animatedPath) {
        trajectoryGroup
          .append("path")
          .attr("d", animatedPath)
          .attr("fill", "none")
          .attr("stroke", trajectoryColor)
          .attr("stroke-width", trajectoryStrokeWidth)
          .attr("opacity", trajectoryProgressOpacity);
      }

      // Update current position marker
      if (trajectoryTimeIndex < trajectoryPoints.length) {
        const [currentX, currentY] = trajectoryPoints[trajectoryTimeIndex];
        svg
          .select(`.current-position-${i}`)
          .attr("cx", xScale(currentX))
          .attr("cy", yScale(currentY));
      }
    }
  }

  function updateVisualization(timeIndex) {
    if (!isDataValid) return;

    const numTimeSteps = allRectifiedTrajectories[0].length;
    const clampedTimeIndex = Math.min(timeIndex, numTimeSteps - 1);

    updatePanel(leftSvgElement, 0, clampedTimeIndex);
    updatePanel(rightSvgElement, 1, clampedTimeIndex);
  }

  function startAnimation() {
    if (!isDataValid) return;

    const numSteps = allRectifiedTrajectories[0].length;
    const stepDuration = animationDuration / numSteps;

    function animate() {
      if (!isPlaying) {
        animationFrameId = null;
        return;
      }

      updateVisualization(currentTimeIndex);

      const isLastFrame = currentTimeIndex === numSteps - 1;
      const delay = isLastFrame ? stepDuration + pauseDuration : stepDuration;

      // Move to next frame
      const nextTimeIndex = (currentTimeIndex + 1) % numSteps;
      currentTimeIndex = nextTimeIndex;

      setTimeout(() => {
        // When animation completes (after pause), pick new random trajectories
        // and reinitialize SVG with new markers
        if (isLastFrame) {
          selectTrajectoryIndices();
          initializeSvg(leftSvgElement, targetDistribution, leftLabel);
          initializeSvg(rightSvgElement, targetDistribution, rightLabel);
        }
        animationFrameId = requestAnimationFrame(animate);
      }, delay);
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  function togglePlayPause() {
    isPlaying = !isPlaying;
    if (isPlaying) {
      startAnimation();
    } else if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  $: if (isDataValid && leftSvgElement && rightSvgElement && !isInitialized) {
    initializeVisualization();
    if (isPlaying) startAnimation();
  }

  onMount(() => {
    if (isDataValid) {
      initializeScales();
      if (isPlaying) startAnimation();
    }
  });

  onDestroy(() => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
  });
</script>

{#if isDataValid}
  <DoubleFigure {gap} {caption}>
    {#snippet left()}
      <PlayButton {isPlaying} onclick={togglePlayPause} />
      <svg
        bind:this={leftSvgElement}
        viewBox="0 0 {svgWidth} {svgHeight}"
        preserveAspectRatio="xMidYMid meet"
        style="width: 100%; height: auto; max-width: {svgWidth}px;"
      >
      </svg>
    {/snippet}

    {#snippet right()}
      <svg
        bind:this={rightSvgElement}
        viewBox="0 0 {svgWidth} {svgHeight}"
        preserveAspectRatio="xMidYMid meet"
        style="width: 100%; height: auto; max-width: {svgWidth}px;"
      >
      </svg>
    {/snippet}
  </DoubleFigure>
{:else}
  <div class="placeholder">
    <p>
      Rectified flow superimposed visualization requires rectified flow data
      with at least 2 steps.
    </p>
  </div>
{/if}

<style>
  .caption {
    font-size: 1.1rem;
    line-height: 1.5;
    color: #555;
  }

  .figure-number {
    font-weight: 600;
  }

  .placeholder {
    padding: 2rem;
    text-align: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    color: #666;
  }
</style>
