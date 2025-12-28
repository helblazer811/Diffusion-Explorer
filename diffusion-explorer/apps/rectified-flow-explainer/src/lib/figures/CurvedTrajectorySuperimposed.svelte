<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import Figure from "$lib/components/Figure.svelte";
  import PlayButton from "$lib/components/PlayButton.svelte";
  import { settings } from "$lib/settings";

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props
  export let trajectories = []; // [timestep][sample][dim] - allTimeSamples
  export let sourceDistribution = []; // source distribution points
  export let targetDistribution = []; // target distribution points

  // How many trajectories to display
  export let numTrajectoriesToShow = 25;

  // Data validation
  $: isDataValid =
    trajectories &&
    trajectories.length > 0 &&
    sourceDistribution &&
    sourceDistribution.length > 0 &&
    targetDistribution &&
    targetDistribution.length > 0;

  // Configuration props
  export let marginWidth = 20;
  export let marginHeight = 20;
  export let svgWidth = 350;
  export let svgHeight = 350;
  export let trajectoryColor = "#f17720"; // Orange
  export let sourceColor = "#3b82f6"; // Blue
  export let targetColor = "#3b82f6"; // Blue
  export let sourceOpacity = 0.35;
  export let targetOpacity = 0.35;
  export let distributionPointRadius = 5;

  // Trajectory styling
  export let trajectoryFullOpacity = 0.3;
  export let trajectoryProgressOpacity = 0.8;
  export let trajectoryStrokeWidth = 3;
  export let trajectoryPointRadius = 5;
  export let animationDuration = 5000;
  export let playingByDefault = true;
  export let pauseDuration = 1000;
  export let domainRange = { xMin: -1.7, xMax: 1.7, yMin: -1.7, yMax: 1.7 };

  // Background visibility
  export let backgroundVisible = true;

  // SVG reference
  let svgElement;

  // Scales
  let xScale;
  let yScale;

  // Animation state
  let currentTimeIndex = 0;
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let isInitialized = false;

  // Selected trajectory indices
  let selectedIndices = [];

  // Visibility-based animation control
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // Derived values
  $: numTimeSteps = isDataValid ? trajectories.length : 1;
  $: normalizedTime = numTimeSteps > 1 ? currentTimeIndex / (numTimeSteps - 1) : 0;

  // Pause animation when figure goes off-screen
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

  function selectTrajectoryIndices() {
    if (!isDataValid) return;

    const numAvailable = trajectories[0]?.length || 0;
    const numToSelect = Math.min(numTrajectoriesToShow, numAvailable);

    // Random selection without replacement
    const indices = [];
    const availableIndices = Array.from({ length: numAvailable }, (_, i) => i);

    for (let i = 0; i < numToSelect; i++) {
      const randomIndex = Math.floor(Math.random() * availableIndices.length);
      indices.push(availableIndices.splice(randomIndex, 1)[0]);
    }

    selectedIndices = indices;
  }

  function initializeScales() {
    if (!isDataValid) return;

    const { xMin, xMax, yMin, yMax } = domainRange;

    xScale = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .range([marginWidth, svgWidth - marginWidth]);

    yScale = d3
      .scaleLinear()
      .domain([yMin, yMax])
      .range([marginHeight, svgHeight - marginHeight]);
  }

  function initializeSvg() {
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
      .attr("r", distributionPointRadius)
      .attr("fill", targetColor)
      .attr("opacity", targetOpacity);

    // Add trajectory path group
    svg.append("g").attr("id", "trajectory-group");

    // Add current position markers for each selected trajectory
    const markersGroup = svg.append("g").attr("id", "markers-group");
    for (let i = 0; i < selectedIndices.length; i++) {
      markersGroup
        .append("circle")
        .attr("class", `current-position-${i}`)
        .attr("r", trajectoryPointRadius)
        .attr("fill", trajectoryColor)
        .attr("opacity", trajectoryProgressOpacity);
    }
  }

  function initializeVisualization() {
    if (!svgElement || !isDataValid) return;

    selectTrajectoryIndices();
    initializeScales();
    initializeSvg();
    updateVisualization(currentTimeIndex);
    isInitialized = true;
  }

  function updateVisualization(timeIndex) {
    if (!svgElement || !isDataValid || !xScale || !yScale) return;

    const svg = d3.select(svgElement);
    const numSteps = trajectories.length;

    const trajectoryTimeIndex = Math.floor(
      (timeIndex / (numSteps - 1)) * (numSteps - 1)
    );

    // Update trajectory paths
    const trajectoryGroup = svg.select("#trajectory-group");
    trajectoryGroup.selectAll("*").remove();

    // Draw selected trajectories
    for (let i = 0; i < selectedIndices.length; i++) {
      const trajIdx = selectedIndices[i];
      const trajectoryPoints = trajectories.map((timestep) => timestep[trajIdx]);

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

  function startAnimation() {
    if (!isDataValid) return;

    const numSteps = trajectories.length;
    const stepDuration = animationDuration / numSteps;

    function animate() {
      if (!isPlaying) {
        animationFrameId = null;
        return;
      }

      updateVisualization(currentTimeIndex);

      const isLastFrame = currentTimeIndex === numSteps - 1;
      const delay = isLastFrame ? stepDuration + pauseDuration : stepDuration;

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

  $: if (isDataValid && svgElement && !isInitialized) {
    initializeVisualization();
    if (isPlaying) startAnimation();
  }

  onMount(() => {
    // Initialization handled by reactive statement
  });

  onDestroy(() => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
  });
</script>

{#if isDataValid}
  <Figure {caption} {backgroundVisible} bind:isActive={figureIsActive} onContentClick={togglePlayPause}>
    {#snippet children()}
      <PlayButton {isPlaying} onclick={togglePlayPause} time={normalizedTime} />
      <svg
        bind:this={svgElement}
        viewBox="0 0 {svgWidth} {svgHeight}"
        preserveAspectRatio="xMidYMid meet"
        style="width: 100%; height: auto; max-width: {svgWidth}px;"
      >
      </svg>
    {/snippet}
  </Figure>
{:else}
  <div class="placeholder">
    <p>Loading curved trajectory visualization...</p>
  </div>
{/if}

<style>
  .placeholder {
    padding: 2rem;
    text-align: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    color: #666;
  }
</style>
