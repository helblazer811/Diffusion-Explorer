<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import Figure from "$lib/components/Figure.svelte";
  import TimeSlider from "$lib/components/TimeSlider.svelte";
  import { plotKatexInSVG } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";
  import {
    createSourceTargetScales,
    plotScatterAtCenter,
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
  export let numTrajectoriesToShow = 1;

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
  let psiLabelInitialPositions = new Map(); // Store initial x/y for Safari-compatible animation



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
    d3Svg.append("g").attr("id", "katexLabels");

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
    const katexLabelsGroup = d3Svg.select("#katexLabels");

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

      // Mask
      const mask = defs
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

      // KaTeX label above start
      const startY = scales.yScale(trajData[0][1]);
      plotKatexInSVG(katexLabelsGroup, "x", startX, startY, {
        fontSize: settings.stylingSettings.figureLatex.fontSize,
        color: settings.stylingSettings.figureLatex.color,
        anchor: "bottom-center",
        bgOpacity: 0.0,
        outline: settings.stylingSettings.figureLatex.outline,
        outlineColor: settings.stylingSettings.figureLatex.outlineColor,
        outlineWidth: settings.stylingSettings.figureLatex.outlineWidth,
        outlineOpacity: settings.stylingSettings.figureLatex.outlineOpacity,
      });

      // psi_t label group
      const psiLabelGroup = katexLabelsGroup
        .append("g")
        .attr("class", `psi-label-${idx}`)
        .style("opacity", 0);

      plotKatexInSVG(psiLabelGroup, "\\psi_t(x)", startX, startY, {
        fontSize: settings.stylingSettings.figureLatex.fontSize,
        color: settings.stylingSettings.figureLatex.color,
        anchor: "bottom-center",
        bgOpacity: 0.0,
        outline: settings.stylingSettings.figureLatex.outline,
        outlineColor: settings.stylingSettings.figureLatex.outlineColor,
        outlineWidth: settings.stylingSettings.figureLatex.outlineWidth,
        outlineOpacity: settings.stylingSettings.figureLatex.outlineOpacity,
      });

      // Store initial positions for Safari-compatible animation
      const fo = psiLabelGroup.select("foreignObject");
      const rect = psiLabelGroup.select("rect");
      psiLabelInitialPositions.set(idx, {
        foX: parseFloat(fo.attr("x")),
        foY: parseFloat(fo.attr("y")),
        rectX: rect.empty() ? 0 : parseFloat(rect.attr("x")),
        rectY: rect.empty() ? 0 : parseFloat(rect.attr("y")),
        hasRect: !rect.empty()
      });
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

      // psi_t label - use direct x/y manipulation for Safari compatibility (transforms on groups with foreignObject don't work)
      const psiLabel = d3Svg.select(`.psi-label-${idx}`);
      const initialPos = psiLabelInitialPositions.get(idx);
      if (time >= 0.05 && initialPos) {
        const dx = point.x - getPixelX(trajData[0][0], combinedMeanX, 0);
        const dy = point.y - scales.yScale(trajData[0][1]);

        // Update foreignObject position directly
        psiLabel.select("foreignObject")
          .attr("x", initialPos.foX + dx)
          .attr("y", initialPos.foY + dy);

        // Update rect position if it exists
        if (initialPos.hasRect) {
          psiLabel.select("rect")
            .attr("x", initialPos.rectX + dx)
            .attr("y", initialPos.rectY + dy);
        }

        psiLabel.style("opacity", 1);
      } else {
        psiLabel.style("opacity", 0);
      }
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
