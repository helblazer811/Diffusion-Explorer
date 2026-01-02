<script>
  import { onDestroy } from "svelte";
  import { Figure, MultiStateToggleButton, drawScatterPlot, drawText, drawTrajectoriesWithPreview, createSourceTargetScales } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // Data props (from parent)
  // allTimeSamples contains the cached flow trajectories: [timestep][sample][dim]
  // Source points = allTimeSamples[0], Target points = allTimeSamples[lastTimestep]
  export let allTimeSamples = [];

  // Animation parameters
  export let numPoints = 50;
  export let numLinesToDraw = 50;
  export let numTrajectoriesToShow = 15;
  export let lineDrawDuration = 50; // ms per line
  export let trajectoryAnimationDuration = 4000;
  export let pauseBetweenPhases = 1000;
  export let pauseAfterNaiveCoupling = 1500; // Extra pause after naive coupling
  export let fadeOutDuration = 800; // Duration to fade out naive coupling
  export let pauseAfterTrajectories = 1500; // Pause after trajectories finish
  export let pauseAfterInducedCoupling = 2000; // Pause at end before restart

  // Layout props
  export let width = 750;
  export let height = 375;
  export let marginWidth = 50;
  export let marginTop = 20;

  // Toggle button labels
  const stateLabels = ["1. Independent Coupling", "2. Simulate the Flow", "3. Induced Coupling"];

  // Caption slot
  export let children = undefined;
  $: caption = children;

  // Styling
  const sourcePointColor = settings.stylingSettings.scatterPlot.color;
  const targetPointColor = '#f17720';
  const couplingLineColor = '#888';
  const couplingLineOpacity = 0.5;
  const couplingLineWidth = 2;

  // Canvas state
  let canvas;
  let ctx;
  let dpr = 1;

  // Animation phase state machine
  // Phases: 'distributions' -> 'naive_coupling' -> 'pause_after_naive' -> 'fade_out' -> 'trajectories' -> 'pause_after_trajectories' -> 'induced_coupling' -> 'pause_at_end' -> loop
  let currentPhase = 'distributions';
  let phaseProgress = 0;
  let linesDrawnCount = 0;
  let trajectoryTime = 0;
  let fadeOpacity = 1;
  let inducedCouplingProgress = 0;  // Progress of induced coupling animation (0 to 1)

  // Pre-computed data
  let scales = null;
  let sourcePixelCoords = [];
  let targetPixelCoords = [];
  let shuffledEndpointIndices = [];
  let transformedTrajectories = [];
  let combinedMeanX = 0;
  let numTimeSteps = 1;

  // Playback control
  let isPlaying = true;
  let animationFrameId = null;
  let lastTimestamp = null;

  // Visibility tracking
  let figureIsActive;
  let wasPlayingBeforeHidden = false;
  let initialized = false;

  // State index for toggle button (derived from current phase)
  $: stateIndex = (() => {
    switch (currentPhase) {
      case 'distributions':
      case 'naive_coupling':
      case 'pause_after_naive':
      case 'fade_out':
        return 0;
      case 'trajectories':
      case 'pause_after_trajectories':
        return 1;
      case 'induced_coupling':
      case 'pause_at_end':
        return 2;
      default:
        return 0;
    }
  })();

  // Jump to a specific state when toggle button is clicked
  function jumpToState(newStateIndex) {
    // Reset animation timing
    lastTimestamp = null;
    phaseProgress = 0;

    switch (newStateIndex) {
      case 0:
        // Independent Coupling - show all naive coupling lines
        currentPhase = 'pause_after_naive';
        linesDrawnCount = numLinesToDraw;
        fadeOpacity = 1;
        break;
      case 1:
        // Simulate the Flow - start trajectory animation
        currentPhase = 'trajectories';
        trajectoryTime = 0;
        fadeOpacity = 0;
        break;
      case 2:
        // Induced Coupling - show all induced coupling lines fully animated
        currentPhase = 'pause_at_end';
        inducedCouplingProgress = 1;
        break;
    }

    // Redraw immediately
    draw();

    // Restart animation if it was playing
    if (isPlaying && !animationFrameId) {
      startAnimation();
    }
  }

  // Shuffle array in place (Fisher-Yates)
  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function getPixelX(dataX, meanX, t) {
    const centerPixelX =
      scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - meanX) * scales.xScaleFactor;
  }

  function initializeCanvas() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
  }

  function initializeData() {
    if (!allTimeSamples || allTimeSamples.length === 0) return;

    numTimeSteps = allTimeSamples.length;

    // Use cached trajectories: source points from first timestep, target from last
    // This ensures source[i] -> target[i] is the actual flow-induced pairing
    const sourcePoints = allTimeSamples[0];
    const targetPoints = allTimeSamples[allTimeSamples.length - 1];

    // Create scales with adjusted height for margins
    const contentHeight = height - marginTop;
    scales = createSourceTargetScales(
      sourcePoints,
      targetPoints,
      {
        width,
        height: contentHeight,
        marginWidth,
        marginHeight: 0, // We handle margins ourselves
        sourceCenterX: settings.stylingSettings.layout.sourceCenterX,
        targetCenterX: settings.stylingSettings.layout.targetCenterX,
        yShiftFactor: settings.stylingSettings.scatterPlot.yShiftFactor,
      }
    );

    // Offset the yScale to account for top margin
    const originalYScale = scales.yScale;
    scales.yScale = (y) => originalYScale(y) + marginTop;

    // Calculate combined mean X for trajectory interpolation
    const allX = [
      ...sourcePoints.map((p) => p[0]),
      ...targetPoints.map((p) => p[0]),
    ];
    combinedMeanX = allX.reduce((a, b) => a + b, 0) / allX.length;

    // Pre-compute source pixel coordinates (limited to numPoints)
    // These come from allTimeSamples[0] so pairing with target is correct
    sourcePixelCoords = sourcePoints.slice(0, numPoints).map(point => {
      const pixelX = scales.sourceCenterPixelX +
        (point[0] - scales.sourceMeanX) * scales.xScaleFactor;
      const pixelY = scales.yScale(point[1]);
      return [pixelX, pixelY];
    });

    // Pre-compute target pixel coordinates (from allTimeSamples[lastTimestep])
    // target[i] is where source[i] ends up after flowing through the model
    targetPixelCoords = targetPoints.slice(0, numPoints).map(point => {
      const pixelX = scales.targetCenterPixelX +
        (point[0] - scales.targetMeanX) * scales.xScaleFactor;
      const pixelY = scales.yScale(point[1]);
      return [pixelX, pixelY];
    });

    // Create shuffled indices for naive coupling (random pairings)
    shuffledEndpointIndices = [...Array(numPoints).keys()];
    shuffleArray(shuffledEndpointIndices);

    // Pre-compute trajectories for animation (limited to numTrajectoriesToShow)
    // These are the actual cached flow trajectories
    const trajectoryIndices = [...Array(Math.min(numTrajectoriesToShow, numPoints)).keys()];
    transformedTrajectories = trajectoryIndices.map((sampleIdx) => {
      return allTimeSamples.map((timestep, tIdx) => {
        const point = timestep[sampleIdx];
        const t = tIdx / (allTimeSamples.length - 1);
        const pixelX = getPixelX(point[0], combinedMeanX, t);
        const pixelY = scales.yScale(point[1]);
        return [pixelX, pixelY];
      });
    });
  }

  function drawSourceDistribution() {
    drawScatterPlot(
      ctx,
      sourcePixelCoords,
      settings.stylingSettings.scatterPlot.radius,
      sourcePointColor,
      settings.stylingSettings.scatterPlot.opacity
    );
  }

  function drawTargetDistribution() {
    drawScatterPlot(
      ctx,
      targetPixelCoords,
      settings.stylingSettings.scatterPlot.radius,
      targetPointColor,
      settings.stylingSettings.scatterPlot.opacity
    );
  }

  function drawLabels() {
    const labelColor = settings.stylingSettings.label.color;
    const labelFontSize = settings.stylingSettings.label.fontSize;
    const labelFontWeight = settings.stylingSettings.label.fontWeight;
    const labelOpacity = settings.stylingSettings.label.opacity;
    const labelFont = `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`;
    const labelY = marginTop / 2 + 5;
    drawText(ctx, "Source Distribution", scales.sourceCenterPixelX, labelY, { color: labelColor, font: labelFont, opacity: labelOpacity });
    drawText(ctx, "Target Distribution", scales.targetCenterPixelX, labelY, { color: labelColor, font: labelFont, opacity: labelOpacity });
  }

  function drawNaiveCouplingLines(count, opacity = couplingLineOpacity) {
    ctx.strokeStyle = couplingLineColor;
    ctx.lineWidth = couplingLineWidth;
    ctx.globalAlpha = opacity;

    const linesToDraw = Math.min(count, numLinesToDraw, numPoints);
    for (let i = 0; i < linesToDraw; i++) {
      const sourceIdx = i;
      const targetIdx = shuffledEndpointIndices[i];

      const [sx, sy] = sourcePixelCoords[sourceIdx];
      const [tx, ty] = targetPixelCoords[targetIdx];

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  function drawAnimatedTrajectories(time) {
    const segmentIndex = Math.floor(time * (numTimeSteps - 1));

    drawTrajectoriesWithPreview(ctx, transformedTrajectories, segmentIndex, {
      strokeWidth: settings.stylingSettings.trajectory.strokeWidth,
      color: settings.stylingSettings.trajectory.color,
      progressOpacity: settings.stylingSettings.trajectory.progressOpacity,
      pointRadius: settings.stylingSettings.trajectory.endpointRadius,
      showPreview: false,
      previewOpacity: 0
    });
  }

  function drawInducedCouplingLines(progress = 1) {
    ctx.strokeStyle = couplingLineColor;
    ctx.lineWidth = couplingLineWidth;
    ctx.globalAlpha = couplingLineOpacity;

    const linesToDraw = Math.min(numLinesToDraw, numPoints);
    for (let i = 0; i < linesToDraw; i++) {
      // Direct pairing: source[i] -> target[i] (not shuffled)
      // Animate from target to source
      const [sx, sy] = sourcePixelCoords[i];
      const [tx, ty] = targetPixelCoords[i];

      // Calculate the current end position based on progress (0 = at target, 1 = at source)
      const currentX = tx + (sx - tx) * progress;
      const currentY = ty + (sy - ty) * progress;

      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(currentX, currentY);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  function draw() {
    if (!ctx || !initialized) return;

    ctx.clearRect(0, 0, width, height);

    // Always draw distributions
    drawSourceDistribution();
    drawTargetDistribution();
    drawLabels();

    // Phase-specific rendering
    switch (currentPhase) {
      case 'distributions':
        // Just distributions, nothing extra
        break;

      case 'naive_coupling':
        drawNaiveCouplingLines(linesDrawnCount);
        break;

      case 'pause_after_naive':
        // Show all naive coupling lines during pause
        drawNaiveCouplingLines(numLinesToDraw);
        break;

      case 'fade_out':
        // Fade out naive coupling lines
        drawNaiveCouplingLines(numLinesToDraw, fadeOpacity * couplingLineOpacity);
        break;

      case 'trajectories':
        // Draw animated trajectories (naive coupling already faded out)
        drawAnimatedTrajectories(trajectoryTime);
        break;

      case 'pause_after_trajectories':
        // Show completed trajectories at final position
        drawAnimatedTrajectories(1);
        break;

      case 'induced_coupling':
        drawInducedCouplingLines(inducedCouplingProgress);
        break;

      case 'pause_at_end':
        // Show all induced coupling lines fully drawn
        drawInducedCouplingLines(1);
        break;
    }
  }

  function advancePhase() {
    switch (currentPhase) {
      case 'distributions':
        currentPhase = 'naive_coupling';
        linesDrawnCount = 0;
        break;
      case 'naive_coupling':
        currentPhase = 'pause_after_naive';
        break;
      case 'pause_after_naive':
        currentPhase = 'fade_out';
        fadeOpacity = 1;
        break;
      case 'fade_out':
        currentPhase = 'trajectories';
        trajectoryTime = 0;
        break;
      case 'trajectories':
        currentPhase = 'pause_after_trajectories';
        break;
      case 'pause_after_trajectories':
        currentPhase = 'induced_coupling';
        inducedCouplingProgress = 0;
        break;
      case 'induced_coupling':
        currentPhase = 'pause_at_end';
        break;
      case 'pause_at_end':
        currentPhase = 'distributions';
        // Reshuffle for next loop
        shuffleArray(shuffledEndpointIndices);
        break;
    }
    phaseProgress = 0;
  }

  function animate(timestamp) {
    if (!isPlaying) {
      animationFrameId = null;
      return;
    }

    if (lastTimestamp === null) lastTimestamp = timestamp;
    const elapsed = timestamp - lastTimestamp;

    switch (currentPhase) {
      case 'distributions':
        phaseProgress += elapsed / pauseBetweenPhases;
        if (phaseProgress >= 1) advancePhase();
        break;

      case 'naive_coupling': {
        const totalLineDuration = numLinesToDraw * lineDrawDuration;
        phaseProgress += elapsed / totalLineDuration;
        linesDrawnCount = Math.min(Math.floor(phaseProgress * numLinesToDraw) + 1, numLinesToDraw);
        if (phaseProgress >= 1) advancePhase();
        break;
      }

      case 'induced_coupling': {
        // Animate all lines simultaneously from target to source
        const inducedCouplingDuration = 1500; // Duration for lines to animate
        phaseProgress += elapsed / inducedCouplingDuration;
        inducedCouplingProgress = Math.min(phaseProgress, 1);
        if (phaseProgress >= 1) advancePhase();
        break;
      }

      case 'pause_after_naive':
        phaseProgress += elapsed / pauseAfterNaiveCoupling;
        if (phaseProgress >= 1) advancePhase();
        break;

      case 'fade_out':
        phaseProgress += elapsed / fadeOutDuration;
        fadeOpacity = Math.max(0, 1 - phaseProgress);
        if (phaseProgress >= 1) advancePhase();
        break;

      case 'trajectories':
        phaseProgress += elapsed / trajectoryAnimationDuration;
        trajectoryTime = Math.min(phaseProgress, 1);
        if (phaseProgress >= 1) advancePhase();
        break;

      case 'pause_after_trajectories':
        phaseProgress += elapsed / pauseAfterTrajectories;
        if (phaseProgress >= 1) advancePhase();
        break;

      case 'pause_at_end':
        phaseProgress += elapsed / pauseAfterInducedCoupling;
        if (phaseProgress >= 1) advancePhase();
        break;
    }

    draw();
    lastTimestamp = timestamp;
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

  function handleVisibilityChange(isActive) {
    if (!isActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false;
    } else if (isActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true;
    }
  }

  // Initialize when canvas and data are ready
  $: if (
    canvas &&
    allTimeSamples &&
    allTimeSamples.length > 0 &&
    !initialized
  ) {
    initializeCanvas();
    initializeData();
    initialized = true;
    draw();
    if (isPlaying) startAnimation();
  }

  // Animation control
  $: if (isPlaying && initialized && !animationFrameId) startAnimation();
  $: if (!isPlaying && animationFrameId) stopAnimation();

  // Handle visibility changes
  $: if (figureIsActive !== undefined && initialized) {
    handleVisibilityChange($figureIsActive);
  }

  onDestroy(() => stopAnimation());
</script>

<Figure {caption} backgroundVisible={false} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display:flex;flex-direction:column;align-items:center;width:100%;">
      <canvas
        bind:this={canvas}
        style="width:100%;height:auto;max-width:{width}px;aspect-ratio:{width}/{height};"
      ></canvas>
      <div style="margin-top:15px;">
        <MultiStateToggleButton
          labels={stateLabels}
          value={stateIndex}
          fontSize={16}
          padding="8px 20px"
          onchange={jumpToState}
        />
      </div>
    </div>
  {/snippet}
</Figure>
