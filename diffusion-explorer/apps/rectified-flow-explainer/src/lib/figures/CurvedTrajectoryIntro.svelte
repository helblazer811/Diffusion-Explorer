<script>
  import { onDestroy } from "svelte";
  import * as d3 from "d3";
  import Figure from "$lib/components/Figure.svelte";
  import TimeSlider from "$lib/components/TimeSlider.svelte";
  import { settings } from "$lib/settings";
  import {
    createSourceTargetScales,
    plotScatterAtCenter,
    plotSourceTargetLabels,
  } from "$lib/d3_helpers";

  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];
  export let allTimeSamples; // [timestep][sample][dim]
  export let animationDuration = 6000;
  export let playingByDefault = true;
  export let pauseBeforeRestart = 1000;
  export let width = 750;
  export let height = 275;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let numTrajectoriesToShow = 10;

  let svg;
  let scales;
  let time = 0;
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let lastTimestamp = null;
  let isPaused = false;
  let pauseStartTime = null;
  let initialized = false;

  let selectedTrajectoryIndices = [];
  let trajectoryLengths = new Map();
  let pathsInitialized = false;
  let figureIsActive = true;
  let wasPlayingBeforeHidden = false;


  // Pick trajectories (simplest: first N samples)
  function selectTrajectoryIndices() {
    if (!allTimeSamples || allTimeSamples.length === 0) return;
    selectedTrajectoryIndices = [...Array(numTrajectoriesToShow).keys()].filter(
      (i) => i < allTimeSamples[0].length
    );
  }

  function getTrajectoryData(sampleIndex) {
    return allTimeSamples.map((t) => t[sampleIndex]);
  }

  function getPixelX(dataX, meanX, t) {
    const centerPixelX =
      scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - meanX) * scales.xScaleFactor;
  }

  function generateTrajectoryPath(idx) {
    const trajData = getTrajectoryData(selectedTrajectoryIndices[idx]);
    const allX = [
      ...sourceDistributionSamples.map((p) => p[0]),
      ...targetDistributionSamples.map((p) => p[0]),
    ];
    const combinedMeanX = allX.reduce((a, b) => a + b, 0) / allX.length;
    let path = "";
    trajData.forEach(([x, y], i) => {
      const tStep = i / (trajData.length - 1);
      const svgX = getPixelX(x, combinedMeanX, tStep);
      const svgY = scales.yScale(y);
      path += i === 0 ? `M ${svgX},${svgY}` : ` L ${svgX},${svgY}`;
    });
    return path;
  }

  function initializeVisualization() {
    if (!svg) return;
    const d3Svg = d3.select(svg);
    d3Svg.selectAll("*").remove();
    d3Svg.append("defs");

    scales = createSourceTargetScales(
      sourceDistributionSamples,
      targetDistributionSamples,
      {
        width,
        height,
        marginWidth,
        marginHeight,
        sourceCenterX: settings.stylingSettings.layout.sourceCenterX,
        targetCenterX: settings.stylingSettings.layout.targetCenterX,
        yShiftFactor: settings.stylingSettings.scatterPlot.yShiftFactor,
      }
    );

    d3Svg.append("g").attr("id", "sourceScatter");
    d3Svg.append("g").attr("id", "targetScatter");
    d3Svg.append("g").attr("class", "trajectories");
    d3Svg.append("g").attr("id", "labels");

    plotScatterAtCenter(
      d3Svg,
      sourceDistributionSamples,
      scales.yScale,
      "sourceScatter",
      {
        centerPixelX: scales.sourceCenterPixelX,
        meanX: scales.sourceMeanX,
        xScaleFactor: scales.xScaleFactor,
        pointRadius: settings.stylingSettings.scatterPlot.radius,
        pointOpacity: settings.stylingSettings.scatterPlot.opacity,
        pointColor: settings.stylingSettings.scatterPlot.color,
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
        pointRadius: settings.stylingSettings.scatterPlot.radius,
        pointOpacity: settings.stylingSettings.scatterPlot.opacity,
        pointColor: settings.stylingSettings.scatterPlot.color,
      }
    );
  }

  function initializeTrajectories() {
    if (!svg) return;
    const d3Svg = d3.select(svg);
    const trajGroup = d3Svg.select(".trajectories");
    const defs = d3Svg.select("defs");

    selectedTrajectoryIndices.forEach((_, idx) => {
      const fullPath = generateTrajectoryPath(idx);

      // Measure total length
      const tempPath = trajGroup.append("path").attr("d", fullPath);
      const totalLength = tempPath.node().getTotalLength();
      trajectoryLengths.set(idx, totalLength);
      tempPath.remove();

      const trajData = getTrajectoryData(selectedTrajectoryIndices[idx]);
      const allX = [
        ...sourceDistributionSamples.map((p) => p[0]),
        ...targetDistributionSamples.map((p) => p[0]),
      ];
      const combinedMeanX = allX.reduce((a, b) => a + b, 0) / allX.length;
      const startX = getPixelX(trajData[0][0], combinedMeanX, 0);

      // Clip path for progress animation
      defs
        .append("clipPath")
        .attr("id", `trajectory-mask-${idx}`)
        .attr("clipPathUnits", "userSpaceOnUse")
        .append("rect")
        .attr("x", startX)
        .attr("y", 0)
        .attr("width", 0)
        .attr("height", height)
        .attr("fill", "white");

      // Full trajectory path
      trajGroup
        .append("path")
        .attr("class", `trajectory-full-${idx}`)
        .attr("d", fullPath)
        .attr("fill", "none")
        .attr("stroke", settings.stylingSettings.trajectory.color)
        .attr("stroke-width", settings.stylingSettings.trajectory.strokeWidth)
        .attr("opacity", settings.stylingSettings.trajectory.fullOpacity);

      // Progress path (clipped)
      trajGroup
        .append("path")
        .attr("class", `trajectory-progress-${idx}`)
        .attr("d", fullPath)
        .attr("fill", "none")
        .attr("stroke", settings.stylingSettings.trajectory.color)
        .attr("stroke-width", settings.stylingSettings.trajectory.strokeWidth)
        .attr("opacity", settings.stylingSettings.trajectory.progressOpacity)
        .attr("clip-path", `url(#trajectory-mask-${idx})`);

      // Moving marker
      trajGroup
        .append("circle")
        .attr("class", `trajectory-point-${idx}`)
        .attr("r", settings.stylingSettings.trajectory.pointRadius)
        .attr("fill", settings.stylingSettings.trajectory.color)
        .attr("opacity", settings.stylingSettings.trajectory.progressOpacity);
    });

    // Add source and target distribution labels
    plotSourceTargetLabels(d3Svg, scales, {
      sourceLabelText: "Source Distribution",
      targetLabelText: "Target Distribution",
      labelFontSize: settings.stylingSettings.label.fontSize,
      labelColor: settings.stylingSettings.label.color,
      outlineColor: settings.stylingSettings.label.outlineColor,
      outlineOpacity: settings.stylingSettings.label.outlineOpacity,
    });

    pathsInitialized = true;
    updateVisualization();
  }

  function updateVisualization() {
    if (!svg || !pathsInitialized) return;
    const d3Svg = d3.select(svg);

    selectedTrajectoryIndices.forEach((_, idx) => {
      const trajData = getTrajectoryData(selectedTrajectoryIndices[idx]);
      const allX = [
        ...sourceDistributionSamples.map((p) => p[0]),
        ...targetDistributionSamples.map((p) => p[0]),
      ];
      const combinedMeanX = allX.reduce((a, b) => a + b, 0) / allX.length;
      const startX = getPixelX(trajData[0][0], combinedMeanX, 0);
      const endX = getPixelX(
        trajData[trajData.length - 1][0],
        combinedMeanX,
        1
      );
      const maskWidth = startX + (endX - startX) * time - startX;

      d3Svg.select(`#trajectory-mask-${idx} rect`).attr("width", maskWidth);

      // Marker position
      const pathNode = d3Svg.select(`.trajectory-progress-${idx}`).node();
      const totalLength = trajectoryLengths.get(idx);
      const point = pathNode.getPointAtLength(totalLength * time);
      d3Svg
        .select(`.trajectory-point-${idx}`)
        .attr("cx", point.x)
        .attr("cy", point.y);
    });
  }

  function animate(ts) {
    if (!isPlaying) {
      animationFrameId = null;
      return;
    }
    if (lastTimestamp === null) lastTimestamp = ts;
    const elapsed = ts - lastTimestamp;

    if (isPaused && pauseStartTime !== null) {
      if (ts - pauseStartTime >= pauseBeforeRestart) {
        isPaused = false;
        pauseStartTime = null;
        lastTimestamp = null;
        time = 0;
        updateVisualization();
      }
      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    time += elapsed / animationDuration;
    if (time >= 1) {
      time = 1;
      updateVisualization();
      isPaused = true;
      pauseStartTime = ts;
    } else updateVisualization();
    lastTimestamp = ts;
    animationFrameId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (animationFrameId !== null) return;
    lastTimestamp = null;
    animationFrameId = requestAnimationFrame(animate);
  }
  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }
  function toggleAnimation() {
    isPlaying = !isPlaying;
    if (!isPlaying) {
      stopAnimation();
    }
  }

  $: if (initialized && figureIsActive !== undefined) {
    if (!figureIsActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false; // pause when offscreen
    } else if (figureIsActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true; // resume when back
    }
  }

  $: if (svg && allTimeSamples && allTimeSamples.length > 0) {
    selectTrajectoryIndices();
    initializeVisualization();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        initializeTrajectories();
        requestAnimationFrame(() => {
          initialized = true;
        });
      });
    });
  }

  $: if (isPlaying && initialized && !animationFrameId) startAnimation();
  $: if (!isPlaying && animationFrameId) stopAnimation();
  // Update visualization when time changes (e.g., when slider is dragged while paused)
  $: if (pathsInitialized && time !== undefined) updateVisualization();

  onDestroy(() => stopAnimation());
</script>

<Figure bind:isActive={figureIsActive} backgroundVisible={false}>
  <div
    style="display:flex;flex-direction:column;align-items:center;width:100%;"
  >
    <svg
      bind:this={svg}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      style="width:100%;height:auto;max-width:${width}px;aspect-ratio:${width}/${height};"
    ></svg>
    <TimeSlider
      bind:value={time}
      bind:isPlaying
      min={0}
      max={1}
      onTogglePlay={toggleAnimation}
      color="#f17720"
    />
  </div>
</Figure>
