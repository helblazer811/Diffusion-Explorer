<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import DoubleFigure from "$lib/components/DoubleFigure.svelte";
  import PlayButton from "$lib/components/PlayButton.svelte";
  import { settings } from "$lib/settings";

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props - separate trajectories for left and right panels
  export let leftTrajectories = []; // [timestep][sample][dim] - flow matching grid
  export let rightTrajectories = []; // [timestep][sample][dim] - rectified flow grid
  export let targetDistribution = []; // The actual target distribution points

  // Data validation
  $: isDataValid =
    leftTrajectories &&
    leftTrajectories.length > 0 &&
    rightTrajectories &&
    rightTrajectories.length > 0 &&
    targetDistribution &&
    targetDistribution.length > 0;

  // Configuration props
  export let marginWidth = 20;
  export let marginHeight = 20;
  export let svgWidth = 300;
  export let svgHeight = 300;
  export let trajectoryColor = "#f17720"; // Orange
  export let targetColor = "#3b82f6"; // Blue
  export let targetOpacity = 0.35;
  export let targetPointRadius = 5;

  // Trajectory styling (matching RectifiedFlowVisualization)
  export let showTrajectoryPreview = false; // Show full trajectory path preview
  export let trajectoryFullOpacity = 0.3; // Background paths
  export let trajectoryProgressOpacity = 0.8; // Animated paths
  export let trajectoryStrokeWidth = 3;
  export let trajectoryPointRadius = 5;
  export let animationDuration = 5000; // ms per full loop
  export let playingByDefault = true;
  export let pauseDuration = 1000; // ms pause at end of animation
  export let leftLabel = "Flow Matching";
  export let rightLabel = "Rectified Flow";
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;
  export let gap = 50;
  export let domainRange = { xMin: -1.7, xMax: 1.7, yMin: -1.7, yMax: 1.7 };

  // Callback when visualization is initialized
  export let onInitialized = undefined;

  // Background visibility
  export let backgroundVisible = true;

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

  // Total number of trajectories (derived from data)
  $: numTrajectories = isDataValid ? (leftTrajectories[0]?.length || 0) : 0;

  // Normalized time for timing circle (0-1)
  $: numTimeSteps = isDataValid ? leftTrajectories.length : 1;
  $: normalizedTime = numTimeSteps > 1 ? currentTimeIndex / (numTimeSteps - 1) : 0;

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
      startAnimation();
    }
  }

  function initializeScales() {
    if (!isDataValid) return;

    const { xMin, xMax, yMin, yMax } = domainRange;

    // Create scales with no translation
    xScale = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .range([marginWidth, svgWidth - marginWidth]);

    yScale = d3
      .scaleLinear()
      .domain([yMin, yMax])
      .range([marginHeight, svgHeight - marginHeight]);
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
    for (let i = 0; i < numTrajectories; i++) {
      markersGroup
        .append("circle")
        .attr("class", `current-position-${i}`)
        .attr("r", trajectoryPointRadius)
        .attr("fill", trajectoryColor)
        .attr("opacity", trajectoryProgressOpacity);
    }

    // Add label at top center
    const labelGroup = svg.append("g").attr("class", "label-group");
    const labelX = svgWidth / 2;
    const labelY = marginHeight / 2 + labelFontSize / 2;

    labelGroup
      .append("text")
      .attr("class", "panel-label")
      .attr("x", labelX)
      .attr("y", labelY)
      .attr("text-anchor", "middle")
      .attr("font-size", `${labelFontSize}px`)
      .attr("fill", labelColor)
      .text(label);
  }

  function initializeVisualization() {
    if (!leftSvgElement || !rightSvgElement || !isDataValid) return;

    initializeScales();
    initializeSvg(leftSvgElement, targetDistribution, leftLabel);
    initializeSvg(rightSvgElement, targetDistribution, rightLabel);
    updateVisualization(currentTimeIndex);
    isInitialized = true;
    onInitialized?.();
  }

  function updatePanel(svgElement, trajectories, timeIndex) {
    if (!svgElement || !isDataValid || !xScale || !yScale) return;

    const svg = d3.select(svgElement);
    const numTimeSteps = trajectories.length;

    // Map timeIndex to trajectory timestep
    const trajectoryTimeIndex = Math.floor(
      (timeIndex / (numTimeSteps - 1)) * (numTimeSteps - 1)
    );

    // Update trajectory paths
    const trajectoryGroup = svg.select("#trajectory-group");
    trajectoryGroup.selectAll("*").remove();

    // Draw all trajectories from the grid
    for (let i = 0; i < numTrajectories; i++) {
      const trajectoryPoints = trajectories.map((timestep) => timestep[i]);

      // Draw full trajectory path preview (lighter) - only if enabled
      if (showTrajectoryPreview) {
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
      }

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

    const numTimeSteps = leftTrajectories.length;
    const clampedTimeIndex = Math.min(timeIndex, numTimeSteps - 1);

    updatePanel(leftSvgElement, leftTrajectories, clampedTimeIndex);
    updatePanel(rightSvgElement, rightTrajectories, clampedTimeIndex);
  }

  function startAnimation() {
    if (!isDataValid) return;

    const numSteps = leftTrajectories.length;
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
    // Scales and animation are handled by the reactive statement
  });

  onDestroy(() => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
  });
</script>

{#if isDataValid}
  <DoubleFigure {gap} {caption} {backgroundVisible} bind:isActive={figureIsActive} onContentClick={togglePlayPause}>
    {#snippet left()}
      <PlayButton {isPlaying} onclick={togglePlayPause} time={normalizedTime} />
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
