<script lang="ts">
  import { onDestroy } from "svelte";
  import { Figure, MultiStateToggleButton, drawScatterPlot, drawText, drawTrajectories, createSourceTargetScales, Timeline, useCanvas2D } from "@diffusion-explorer/ui";
  import { clipTrajectoriesToStartingRadius } from "@diffusion-explorer/diffusion";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

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

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  // Styling
  const sourcePointColor = settings.stylingSettings.scatterPlot.color;
  const targetPointColor = '#f17720';
  const couplingLineColor = '#888';
  const couplingLineOpacity = 0.5;
  const couplingLineWidth = 2;

  // Source distribution filtering - exclude outliers beyond this radius
  const SOURCE_RADIUS_THRESHOLD = 2.5;

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;

  // Animation state - computed by Timeline clips
  type AnimationState = {
    stateIndex: number;              // 0, 1, or 2 for toggle button
    linesDrawnCount: number;         // For naive coupling (0 to numLinesToDraw)
    naiveCouplingOpacity: number;    // 1 → 0 during fade
    segmentIndex: number;            // For trajectory animation
    inducedCouplingProgress: number; // 0 → 1 for induced coupling lines
  };

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
  let timeline: Timeline<AnimationState> | null = null;
  let currentState: AnimationState = {
    stateIndex: 0,
    linesDrawnCount: 0,
    naiveCouplingOpacity: 1,
    segmentIndex: 0,
    inducedCouplingProgress: 0
  };

  // Visibility tracking
  let figureIsActive;
  let wasPlayingBeforeHidden = false;
  let initialized = false;

  // State index for toggle button (derived from animation state)
  $: stateIndex = currentState.stateIndex;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

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
        runInitialComputation();
        draw(currentState);
      }
    } catch (error) {
      console.error('[InducedCouplingAnimated] Error generating trajectories:', error);
    } finally {
      isGeneratingTrajectories = false;
    }
  }


  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!generatedTrajectories || generatedTrajectories.length === 0) return;

    // Filter trajectories to exclude outliers based on starting point radius
    const filteredTrajectories = clipTrajectoriesToStartingRadius(generatedTrajectories, SOURCE_RADIUS_THRESHOLD);
    numTimeSteps = filteredTrajectories.length;

    // Source points = first timestep (filtered Gaussian samples)
    const sourcePoints = filteredTrajectories[0];

    // Generated endpoints = last timestep
    const generatedEndpoints = filteredTrajectories[filteredTrajectories.length - 1];

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

    // Pre-compute source pixel coordinates (filtered points only)
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
    const numTrajToShow = Math.min(numTrajectoriesToShow, sourcePoints.length);
    transformedTrajectories = [];
    for (let sampleIdx = 0; sampleIdx < numTrajToShow; sampleIdx++) {
      const trajectory = filteredTrajectories.map((timestep, tIdx) => {
        const point = timestep[sampleIdx];
        const t = tIdx / (filteredTrajectories.length - 1);
        const pixelX = getPixelX(point[0], combinedMeanX, t);
        const pixelY = scales.yScale(point[1]);
        return [pixelX, pixelY];
      });
      transformedTrajectories.push(trajectory);
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Durations for each clip (in ms)
  const inducedCouplingDuration = 1500;

  // Cached values for clip closures
  let cachedNumSegments = 0;
  let cachedNumLinesToDraw = 0;

  // Clip start times (normalized 0-1, computed in setupTimeline)
  let clip1Start = 0;
  let clip2Start = 0;
  let clip3Start = 0;

  function setupTimeline() {
    // Cache values for closures
    cachedNumSegments = numTimeSteps - 1;
    cachedNumLinesToDraw = numLinesToDraw;

    // Calculate durations for each clip
    const clip1Duration = pauseBetweenPhases + (lineDrawDuration * numLinesToDraw) + pauseAfterNaiveCoupling + fadeOutDuration;
    const clip2Duration = trajectoryAnimationDuration + pauseAfterTrajectories;
    const clip3Duration = inducedCouplingDuration + pauseAfterInducedCoupling;
    const totalDuration = clip1Duration + clip2Duration + clip3Duration;

    // Compute normalized clip durations and start times
    const clip1Norm = clip1Duration / totalDuration;
    const clip2Norm = clip2Duration / totalDuration;
    const clip3Norm = clip3Duration / totalDuration;

    clip1Start = 0;
    clip2Start = clip1Norm;
    clip3Start = clip1Norm + clip2Norm;

    // Sub-phase boundaries within Clip 1 (normalized within clip)
    const c1_distributions = pauseBetweenPhases / clip1Duration;
    const c1_linesDraw = (lineDrawDuration * numLinesToDraw) / clip1Duration;
    const c1_pauseAfterNaive = pauseAfterNaiveCoupling / clip1Duration;
    // fadeOut is the remainder

    // Sub-phase boundary within Clip 2
    const c2_trajectories = trajectoryAnimationDuration / clip2Duration;

    // Sub-phase boundary within Clip 3
    const c3_inducedCoupling = inducedCouplingDuration / clip3Duration;

    timeline = new Timeline<AnimationState>();
    timeline.initialState = {
      stateIndex: 0,
      linesDrawnCount: 0,
      naiveCouplingOpacity: 1,
      segmentIndex: 0,
      inducedCouplingProgress: 0
    };

    // Clip 1: Independent Coupling (stateIndex = 0)
    timeline.add({
      name: "IndependentCoupling",
      duration: clip1Norm,
      reduce(t: number) {
        const distribEnd = c1_distributions;
        const linesEnd = distribEnd + c1_linesDraw;
        const pauseEnd = linesEnd + c1_pauseAfterNaive;
        // fadeEnd = 1.0

        if (t < distribEnd) {
          // Just distributions
          return { stateIndex: 0, linesDrawnCount: 0, naiveCouplingOpacity: 1, segmentIndex: 0, inducedCouplingProgress: 0 };
        } else if (t < linesEnd) {
          // Drawing lines progressively
          const lineProgress = (t - distribEnd) / c1_linesDraw;
          const count = Math.min(Math.floor(lineProgress * cachedNumLinesToDraw) + 1, cachedNumLinesToDraw);
          return { stateIndex: 0, linesDrawnCount: count, naiveCouplingOpacity: 1, segmentIndex: 0, inducedCouplingProgress: 0 };
        } else if (t < pauseEnd) {
          // Pause with all lines
          return { stateIndex: 0, linesDrawnCount: cachedNumLinesToDraw, naiveCouplingOpacity: 1, segmentIndex: 0, inducedCouplingProgress: 0 };
        } else {
          // Fade out
          const fadeProgress = (t - pauseEnd) / (1 - pauseEnd);
          const opacity = Math.max(0, 1 - fadeProgress);
          return { stateIndex: 0, linesDrawnCount: cachedNumLinesToDraw, naiveCouplingOpacity: opacity, segmentIndex: 0, inducedCouplingProgress: 0 };
        }
      }
    }, clip1Start);

    // Clip 2: Simulate Flow (stateIndex = 1)
    timeline.add({
      name: "SimulateFlow",
      duration: clip2Norm,
      reduce(t: number) {
        if (t < c2_trajectories) {
          // Animating trajectories
          const trajProgress = t / c2_trajectories;
          const segIdx = Math.floor(trajProgress * cachedNumSegments);
          return { stateIndex: 1, linesDrawnCount: 0, naiveCouplingOpacity: 0, segmentIndex: segIdx, inducedCouplingProgress: 0 };
        } else {
          // Pause at end
          return { stateIndex: 1, linesDrawnCount: 0, naiveCouplingOpacity: 0, segmentIndex: cachedNumSegments, inducedCouplingProgress: 0 };
        }
      }
    }, clip2Start);

    // Clip 3: Induced Coupling (stateIndex = 2)
    timeline.add({
      name: "InducedCoupling",
      duration: clip3Norm,
      reduce(t: number) {
        if (t < c3_inducedCoupling) {
          // Drawing induced coupling lines
          const progress = t / c3_inducedCoupling;
          return { stateIndex: 2, linesDrawnCount: 0, naiveCouplingOpacity: 0, segmentIndex: cachedNumSegments, inducedCouplingProgress: progress };
        } else {
          // Pause at end
          return { stateIndex: 2, linesDrawnCount: 0, naiveCouplingOpacity: 0, segmentIndex: cachedNumSegments, inducedCouplingProgress: 1 };
        }
      }
    }, clip3Start);

    // Set timeline duration and looping
    timeline.duration = totalDuration / 1000; // Convert to seconds
    timeline.looping = true;

    // Register tick callback
    timeline.onTick((_, state) => {
      currentState = state;
      draw(state);
    });
  }

  function startAnimation() {
    if (!timeline) return;
    timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

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

  function drawNaiveCouplingLines(count: number, opacity = couplingLineOpacity) {
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

  function drawAnimatedTrajectories(segmentIndex: number) {
    drawTrajectories(ctx, transformedTrajectories, segmentIndex, {
      strokeWidth: settings.stylingSettings.trajectory.strokeWidth,
      color: settings.stylingSettings.trajectory.color,
      progressOpacity: settings.stylingSettings.trajectory.progressOpacity,
      pointRadius: settings.stylingSettings.trajectory.endpointRadius,
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

  function draw(state: AnimationState) {
    if (!ctx || !initialized) return;

    ctx.clearRect(0, 0, width, height);

    // --- Static Background ---
    drawSourceDistribution();
    drawTargetDistribution();
    drawLabels();

    // --- Dynamic Foreground ---
    const { stateIndex, linesDrawnCount, naiveCouplingOpacity, segmentIndex, inducedCouplingProgress } = state;

    if (stateIndex === 0 && linesDrawnCount > 0) {
      // State 0: Draw naive coupling lines (with fade)
      drawNaiveCouplingLines(linesDrawnCount, naiveCouplingOpacity * couplingLineOpacity);
    } else if (stateIndex === 1) {
      // State 1: Draw animated trajectories
      drawAnimatedTrajectories(segmentIndex);
    } else if (stateIndex === 2 && inducedCouplingProgress > 0) {
      // State 2: Draw induced coupling lines
      drawInducedCouplingLines(inducedCouplingProgress);
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function jumpToState(newStateIndex: number) {
    if (!timeline) return;

    // Seek to the start of the appropriate clip
    let seekTime = 0;
    switch (newStateIndex) {
      case 0:
        seekTime = clip1Start;
        break;
      case 1:
        seekTime = clip2Start;
        break;
      case 2:
        seekTime = clip3Start;
        break;
    }

    const wasPlaying = timeline.isPlaying;
    // seek() triggers onTick callbacks which updates currentState and calls draw()
    timeline.seek(seekTime);

    // Resume playing if it was playing before
    if (wasPlaying) {
      startAnimation();
    }
  }

  function handleVisibilityChange(isActive: boolean) {
    if (!timeline) return;
    if (!isActive && timeline.isPlaying) {
      wasPlayingBeforeHidden = true;
      stopAnimation();
    } else if (isActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      startAnimation();
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => stopAnimation());

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

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
    runInitialComputation();
    initialized = true;
    setupTimeline();
    draw(timeline!.initialState);
    startAnimation();
  }

  // Handle visibility changes
  $: if (figureIsActive !== undefined && initialized) {
    handleVisibilityChange($figureIsActive);
  }
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
