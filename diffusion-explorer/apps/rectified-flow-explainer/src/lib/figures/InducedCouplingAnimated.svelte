<script>
  import { onDestroy } from "svelte";
  import { Figure, MultiStateToggleButton, drawScatterPlot, drawText, drawTrajectoriesWithPreview, createSourceTargetScales, Clock, useCanvas2D } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // Ground truth target distribution (displayed on right side along with generated endpoints)
  export let targetDistribution = null;

  // Flow matching client for trajectory generation
  export let flowMatchingClient = null;
  export let numSteps = 200;

  // Animation parameters
  export let numPoints = 50;  // Number of source points to flow
  export let numLinesToDraw = 50;
  export let numTrajectoriesToShow = 15;
  export let lineDrawDuration = 50; // ms per line
  export let trajectoryAnimationDuration = 4000;
  export let pauseBetweenPhases = 1000;
  export let pauseAfterNaiveCoupling = 1500;
  export let fadeOutDuration = 800;
  export let pauseAfterTrajectories = 1500;
  export let pauseAfterInducedCoupling = 2000;

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
  const generatedPointColor = '#f17720';  // Same as target for consistency
  const couplingLineColor = '#888';
  const couplingLineOpacity = 0.5;
  const couplingLineWidth = 2;

  // Canvas state - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;

  // Animation phase state machine
  let currentPhase = 'distributions';
  let phaseProgress = 0;
  let linesDrawnCount = 0;
  let trajectoryTime = 0;
  let fadeOpacity = 1;
  let inducedCouplingProgress = 0;

  // Pre-computed data
  let scales = null;
  let sourcePixelCoords = [];
  let targetPixelCoords = [];  // Combined: ground truth + generated endpoints
  let generatedEndpointPixelCoords = [];  // Just the generated endpoints (for induced coupling)
  let shuffledTargetIndices = [];  // For naive coupling (random pairings into full target pool)
  let transformedTrajectories = [];
  let combinedMeanX = 0;
  let numTimeSteps = 1;

  // Generated trajectories from forward flow
  let generatedTrajectories = null;
  let isGeneratingTrajectories = false;

  // Playback control
  let isPlaying = true;
  let clock = null;

  // Visibility tracking
  let figureIsActive;
  let wasPlayingBeforeHidden = false;
  let initialized = false;

  // State index for toggle button
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

  function jumpToState(newStateIndex) {
    phaseProgress = 0;

    switch (newStateIndex) {
      case 0:
        currentPhase = 'pause_after_naive';
        linesDrawnCount = numLinesToDraw;
        fadeOpacity = 1;
        break;
      case 1:
        currentPhase = 'trajectories';
        trajectoryTime = 0;
        fadeOpacity = 0;
        break;
      case 2:
        currentPhase = 'pause_at_end';
        inducedCouplingProgress = 1;
        break;
    }

    draw();

    if (isPlaying && clock && !clock.isRunning) {
      startAnimation();
    }
  }

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

  async function generateForwardTrajectories() {
    if (!flowMatchingClient) return;
    if (isGeneratingTrajectories) return;

    isGeneratingTrajectories = true;

    try {
      // Sample forward from source distribution (Gaussian)
      const { promise } = flowMatchingClient.sample(
        numPoints,
        numSteps
      );
      const trajectories = await promise;

      generatedTrajectories = trajectories;

      // Re-initialize data with new trajectories and redraw
      if (canvas && ctx) {
        initializeData();
        draw();
      }
    } catch (error) {
      console.error('[InducedCouplingAnimated] Error generating trajectories:', error);
    } finally {
      isGeneratingTrajectories = false;
    }
  }

  function initializeData() {
    if (!generatedTrajectories || generatedTrajectories.length === 0) return;

    numTimeSteps = generatedTrajectories.length;

    // Source points = first timestep (Gaussian samples)
    const sourcePoints = generatedTrajectories[0];

    // Generated endpoints = last timestep
    const generatedEndpoints = generatedTrajectories[generatedTrajectories.length - 1];

    // Target points = ground truth + generated endpoints
    const groundTruthSamples = targetDistribution ? targetDistribution.slice(0, numPoints) : [];
    const combinedTargetPoints = [...groundTruthSamples, ...generatedEndpoints];

    // Create scales
    const contentHeight = height - marginTop;
    scales = createSourceTargetScales(
      sourcePoints,
      combinedTargetPoints,
      {
        width,
        height: contentHeight,
        marginWidth,
        marginHeight: 0,
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
      ...combinedTargetPoints.map((p) => p[0]),
    ];
    combinedMeanX = allX.reduce((a, b) => a + b, 0) / allX.length;

    // Pre-compute source pixel coordinates
    sourcePixelCoords = sourcePoints.map(point => {
      const pixelX = scales.sourceCenterPixelX +
        (point[0] - scales.sourceMeanX) * scales.xScaleFactor;
      const pixelY = scales.yScale(point[1]);
      return [pixelX, pixelY];
    });

    // Pre-compute combined target pixel coordinates (ground truth + generated)
    targetPixelCoords = combinedTargetPoints.map(point => {
      const pixelX = scales.targetCenterPixelX +
        (point[0] - scales.targetMeanX) * scales.xScaleFactor;
      const pixelY = scales.yScale(point[1]);
      return [pixelX, pixelY];
    });

    // Pre-compute just the generated endpoint pixel coordinates (for induced coupling lines)
    // These are at indices [groundTruthSamples.length ... end] in targetPixelCoords
    const generatedStartIdx = groundTruthSamples.length;
    generatedEndpointPixelCoords = targetPixelCoords.slice(generatedStartIdx);

    // Create shuffled indices for naive coupling (random pairings to any target)
    shuffledTargetIndices = [...Array(combinedTargetPoints.length).keys()];
    shuffleArray(shuffledTargetIndices);

    // Pre-compute trajectories for animation
    const numTrajToShow = Math.min(numTrajectoriesToShow, numPoints);
    const trajectoryIndices = [...Array(numTrajToShow).keys()];
    transformedTrajectories = trajectoryIndices.map((sampleIdx) => {
      return generatedTrajectories.map((timestep, tIdx) => {
        const point = timestep[sampleIdx];
        const t = tIdx / (generatedTrajectories.length - 1);
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
    // Draw all target points (ground truth + generated endpoints)
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
      const [sx, sy] = sourcePixelCoords[i];
      // Connect to random target from full target pool
      const targetIdx = shuffledTargetIndices[i % shuffledTargetIndices.length];
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

    const linesToDraw = Math.min(numLinesToDraw, numPoints, generatedEndpointPixelCoords.length);
    for (let i = 0; i < linesToDraw; i++) {
      // Direct pairing: source[i] -> generated endpoint[i]
      const [sx, sy] = sourcePixelCoords[i];
      const [tx, ty] = generatedEndpointPixelCoords[i];

      // Animate from source to target (showing the flow created this pairing)
      const endX = sx + (tx - sx) * progress;
      const endY = sy + (ty - sy) * progress;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  function draw() {
    if (!ctx || !initialized) return;

    ctx.clearRect(0, 0, width, height);

    drawSourceDistribution();
    drawTargetDistribution();
    drawLabels();

    switch (currentPhase) {
      case 'distributions':
        break;
      case 'naive_coupling':
        drawNaiveCouplingLines(linesDrawnCount);
        break;
      case 'pause_after_naive':
        drawNaiveCouplingLines(numLinesToDraw);
        break;
      case 'fade_out':
        drawNaiveCouplingLines(numLinesToDraw, fadeOpacity * couplingLineOpacity);
        break;
      case 'trajectories':
        drawAnimatedTrajectories(trajectoryTime);
        break;
      case 'pause_after_trajectories':
        drawAnimatedTrajectories(1);
        break;
      case 'induced_coupling':
        drawInducedCouplingLines(inducedCouplingProgress);
        break;
      case 'pause_at_end':
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
        shuffleArray(shuffledTargetIndices);
        break;
    }
    phaseProgress = 0;
  }

  function updateAnimation(elapsed) {
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
        const inducedCouplingDuration = 1500;
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
  }

  function startAnimation() {
    if (!clock) {
      clock = new Clock();
    }
    if (clock.isRunning) return;

    clock.start((dt) => {
      const elapsed = dt * 1000;
      updateAnimation(elapsed);
    });
  }

  function stopAnimation() {
    if (clock) clock.stop();
  }

  function handleVisibilityChange(isActive) {
    if (!isActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false;
      stopAnimation();
    } else if (isActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true;
      startAnimation();
    }
  }

  // Generate trajectories when flowMatchingClient is available
  $: if (
    canvas &&
    flowMatchingClient &&
    !generatedTrajectories &&
    !isGeneratingTrajectories
  ) {
    generateForwardTrajectories();
  }

  // Initialize display when trajectories are ready
  $: if (
    canvas &&
    generatedTrajectories &&
    generatedTrajectories.length > 0 &&
    !initialized
  ) {
    initializeData();
    initialized = true;
    draw();
    if (isPlaying) startAnimation();
  }

  // Animation control
  $: if (isPlaying && initialized && clock && !clock.isRunning) startAnimation();
  $: if (!isPlaying && clock && clock.isRunning) stopAnimation();

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
        use:canvas2d.bindCanvas
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
