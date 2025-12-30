<script>
  import { onDestroy } from "svelte";
  import Figure from "$lib/components/Figure.svelte";
  import TimeSlider from "$lib/components/TimeSlider.svelte";
  import { settings } from "$lib/settings";
  import { createSourceTargetScales } from "$lib/d3_helpers";
  import { drawScatterPlot } from "$lib/plotting/plotting";
  import { latexToSvgElement, placeMathjaxSVG } from "$lib/plotting/mathjax";

  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];
  export let allTimeSamples; // [timestep][sample][dim]
  export let animationDuration = 6000;
  export let playingByDefault = true;
  export let pauseBeforeRestart = 1000;
  export let width = 750;
  export let height = 350;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let numTrajectoriesToShow = 1;

  // LaTeX label styling
  export let latexLabelOffsetY = settings.stylingSettings.figureLatex.latexLabelOffsetY;
  export let latexSizeMultiplier = settings.stylingSettings.figureLatex.sizeMultiplier;

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Canvas state
  let canvas;
  let ctx;
  let dpr = 1;

  // Animation state
  let time = 0;
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let lastTimestamp = null;
  let isPaused = false;
  let pauseStartTime = null;
  let initialized = false;

  // Pre-computed data
  let scales = null;
  let selectedTrajectoryIndices = [];
  let transformedTrajectories = []; // [trajectory][timestep][x,y in pixels]
  let trajectoryLengths = []; // Total path length for each trajectory
  let sourcePixelCoords = [];
  let targetPixelCoords = [];
  let combinedMeanX = 0;

  // Pre-rendered MathJax SVG labels
  let xLabelSvg = null;
  let psiLabelSvg = null;
  let svgOverlay = null;

  // Visibility tracking
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // Pick trajectories (first N samples)
  function selectTrajectoryIndices() {
    if (!allTimeSamples || allTimeSamples.length === 0) return;
    selectedTrajectoryIndices = [...Array(numTrajectoriesToShow).keys()].filter(
      (i) => i < allTimeSamples[0].length
    );
  }

  function getPixelX(dataX, meanX, t) {
    const centerPixelX =
      scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - meanX) * scales.xScaleFactor;
  }

  // Pre-compute trajectory pixel coordinates
  function precomputeTrajectories() {
    if (!allTimeSamples || allTimeSamples.length === 0 || !scales) return;

    const allX = [
      ...sourceDistributionSamples.map((p) => p[0]),
      ...targetDistributionSamples.map((p) => p[0]),
    ];
    combinedMeanX = allX.reduce((a, b) => a + b, 0) / allX.length;

    transformedTrajectories = selectedTrajectoryIndices.map((sampleIdx) => {
      return allTimeSamples.map((timestep, tIdx) => {
        const point = timestep[sampleIdx];
        const t = tIdx / (allTimeSamples.length - 1);
        const pixelX = getPixelX(point[0], combinedMeanX, t);
        const pixelY = scales.yScale(point[1]);
        return [pixelX, pixelY];
      });
    });

    // Calculate path lengths for each trajectory
    trajectoryLengths = transformedTrajectories.map((traj) => {
      let length = 0;
      for (let i = 1; i < traj.length; i++) {
        const dx = traj[i][0] - traj[i - 1][0];
        const dy = traj[i][1] - traj[i - 1][1];
        length += Math.sqrt(dx * dx + dy * dy);
      }
      return length;
    });
  }

  // Pre-compute scatter coordinates
  function precomputeScatterCoords() {
    if (!scales) return;

    sourcePixelCoords = sourceDistributionSamples.map((point) => {
      const pixelX =
        scales.sourceCenterPixelX +
        (point[0] - scales.sourceMeanX) * scales.xScaleFactor;
      const pixelY = scales.yScale(point[1]);
      return [pixelX, pixelY];
    });

    targetPixelCoords = targetDistributionSamples.map((point) => {
      const pixelX =
        scales.targetCenterPixelX +
        (point[0] - scales.targetMeanX) * scales.xScaleFactor;
      const pixelY = scales.yScale(point[1]);
      return [pixelX, pixelY];
    });
  }

  // Initialize canvas
  function initializeCanvas() {
    if (!canvas) return;

    dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
  }

  // Initialize scales and pre-compute data
  function initializeData() {
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

    selectTrajectoryIndices();
    precomputeScatterCoords();
    precomputeTrajectories();
  }

  // Get point at a specific progress (0-1) along a trajectory
  function getPointAtProgress(trajectoryIndex, progress) {
    const traj = transformedTrajectories[trajectoryIndex];
    const totalLength = trajectoryLengths[trajectoryIndex];
    const targetLength = progress * totalLength;

    let accumulatedLength = 0;
    for (let i = 1; i < traj.length; i++) {
      const dx = traj[i][0] - traj[i - 1][0];
      const dy = traj[i][1] - traj[i - 1][1];
      const segmentLength = Math.sqrt(dx * dx + dy * dy);

      if (accumulatedLength + segmentLength >= targetLength) {
        const t = (targetLength - accumulatedLength) / segmentLength;
        return [traj[i - 1][0] + t * dx, traj[i - 1][1] + t * dy];
      }
      accumulatedLength += segmentLength;
    }
    return traj[traj.length - 1];
  }

  // Draw a trajectory with partial progress
  function drawTrajectory(trajectoryIndex, progress) {
    const traj = transformedTrajectories[trajectoryIndex];
    const totalLength = trajectoryLengths[trajectoryIndex];
    const targetLength = progress * totalLength;

    // Draw full trajectory (faded)
    ctx.beginPath();
    ctx.moveTo(traj[0][0], traj[0][1]);
    for (let i = 1; i < traj.length; i++) {
      ctx.lineTo(traj[i][0], traj[i][1]);
    }
    ctx.strokeStyle = settings.stylingSettings.trajectory.color;
    ctx.lineWidth = settings.stylingSettings.trajectory.strokeWidth;
    ctx.globalAlpha = settings.stylingSettings.trajectory.fullOpacity;
    ctx.stroke();

    // Draw progress portion (solid)
    ctx.beginPath();
    ctx.moveTo(traj[0][0], traj[0][1]);
    let accumulatedLength = 0;
    for (let i = 1; i < traj.length; i++) {
      const dx = traj[i][0] - traj[i - 1][0];
      const dy = traj[i][1] - traj[i - 1][1];
      const segmentLength = Math.sqrt(dx * dx + dy * dy);

      if (accumulatedLength + segmentLength >= targetLength) {
        const t = (targetLength - accumulatedLength) / segmentLength;
        const endX = traj[i - 1][0] + t * dx;
        const endY = traj[i - 1][1] + t * dy;
        ctx.lineTo(endX, endY);
        break;
      }
      ctx.lineTo(traj[i][0], traj[i][1]);
      accumulatedLength += segmentLength;
    }
    ctx.globalAlpha = settings.stylingSettings.trajectory.progressOpacity;
    ctx.stroke();

    // Reset alpha
    ctx.globalAlpha = 1;
  }

  // Pre-render MathJax SVG labels
  async function preRenderLabels() {
    const latexColor = settings.stylingSettings.figureLatex.color;
    try {
      [xLabelSvg, psiLabelSvg] = await Promise.all([
        latexToSvgElement("x", { color: latexColor }),
        latexToSvgElement("\\psi_t(x)", { color: latexColor }),
      ]);
    } catch (e) {
      console.warn("Failed to pre-render MathJax labels:", e);
    }
  }

  // Update SVG overlay with label positions
  function updateLabelPositions() {
    if (!svgOverlay) return;

    svgOverlay.innerHTML = "";

    for (let idx = 0; idx < transformedTrajectories.length; idx++) {
      const traj = transformedTrajectories[idx];
      const startPoint = traj[0];
      const currentPoint = getPointAtProgress(idx, time);

      if (xLabelSvg) {
        placeMathjaxSVG(
          xLabelSvg.cloneNode(true),
          svgOverlay,
          startPoint[0],
          startPoint[1],
          0,
          latexLabelOffsetY,
          50,
          latexSizeMultiplier
        );
      }

      if (time >= 0.05 && psiLabelSvg) {
        placeMathjaxSVG(
          psiLabelSvg.cloneNode(true),
          svgOverlay,
          currentPoint[0],
          currentPoint[1],
          0,
          latexLabelOffsetY,
          50,
          latexSizeMultiplier
        );
      }
    }
  }

  // Main draw function
  function draw() {
    if (!ctx || !initialized) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw scatter plots
    drawScatterPlot(
      ctx,
      sourcePixelCoords,
      settings.stylingSettings.scatterPlot.radius,
      settings.stylingSettings.scatterPlot.color,
      settings.stylingSettings.scatterPlot.opacity
    );

    drawScatterPlot(
      ctx,
      targetPixelCoords,
      settings.stylingSettings.scatterPlot.radius,
      settings.stylingSettings.scatterPlot.color,
      settings.stylingSettings.scatterPlot.opacity
    );

    // Draw trajectories and markers
    for (let idx = 0; idx < transformedTrajectories.length; idx++) {
      // Draw trajectory path
      drawTrajectory(idx, time);

      // Get current marker position
      const currentPoint = getPointAtProgress(idx, time);

      // Draw marker
      ctx.beginPath();
      ctx.arc(
        currentPoint[0],
        currentPoint[1],
        settings.stylingSettings.trajectory.pointRadius,
        0,
        2 * Math.PI
      );
      ctx.fillStyle = settings.stylingSettings.trajectory.color;
      ctx.globalAlpha = settings.stylingSettings.trajectory.progressOpacity;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Update SVG overlay labels
    updateLabelPositions();
  }

  // Animation functions
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
        draw();
      }
      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    time += elapsed / animationDuration;
    if (time >= 1) {
      time = 1;
      draw();
      isPaused = true;
      pauseStartTime = ts;
    } else {
      draw();
    }
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

  // Initialize when canvas and data are ready
  $: if (
    canvas &&
    allTimeSamples &&
    allTimeSamples.length > 0 &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    !initialized
  ) {
    initializeCanvas();
    initializeData();
    initialized = true;
    // Pre-render KaTeX labels, then draw and start animation
    preRenderLabels().then(() => {
      draw();
      if (playingByDefault) startAnimation();
    });
  }

  // Handle visibility changes (separate from initialization)
  $: if (figureIsActive !== undefined && initialized) {
    handleVisibilityChange($figureIsActive);
  }

  function handleVisibilityChange(isActive) {
    if (!isActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false;
    } else if (isActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true;
    }
  }

  // Animation control
  $: if (isPlaying && initialized && !animationFrameId) startAnimation();
  $: if (!isPlaying && animationFrameId) stopAnimation();

  // Redraw when time changes (e.g., slider drag)
  $: if (initialized && time !== undefined) draw();

  onDestroy(() => stopAnimation());
</script>

<Figure {caption} bind:isActive={figureIsActive} backgroundVisible={false}>
  {#snippet children()}
    <div
      style="display:flex;flex-direction:column;align-items:center;width:100%;"
    >
      <div style="position:relative;width:100%;max-width:{width}px;">
        <canvas
          bind:this={canvas}
          style="width:100%;height:auto;aspect-ratio:{width}/{height};"
        ></canvas>
        <svg
          bind:this={svgOverlay}
          style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"
          viewBox="0 0 {width} {height}"
        ></svg>
      </div>
      <TimeSlider
        bind:value={time}
        bind:isPlaying
        min={0}
        max={1}
        onTogglePlay={toggleAnimation}
        color="#f17720"
      />
    </div>
  {/snippet}
</Figure>
