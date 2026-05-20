<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import type { FlowModelClient } from "@diffusion-explorer/diffusion";
  import { Player, Figure, MultiStateToggleButton, drawScatterPlot, drawText, createSourceTargetScales, Timeline, useCanvas2D, useVisibilityHandler, PathlineAnimation, type PathlineAnimationState } from "@diffusion-explorer/ui";
  import { clipTrajectoriesToStartingRadius } from "@diffusion-explorer/diffusion";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Ground truth target distribution (displayed on right side along with generated endpoints)
  export let targetDistribution: number[][] | null = null;

  // Flow matching client for trajectory generation
  export let flowMatchingClient: FlowModelClient | null = null;
  export let numSteps: number = 200;

  // Animation parameters
  export let numPoints: number = 80;  // Number of source points to flow
  export let numLinesToDraw: number = 80;
  export let numTrajectoriesToShow: number = 20;

  // Animation timing (normalized 0-1, scaled by animationDuration)
  export let animationDuration: number = 12000; // Total animation duration in ms
  export let timing: {
    phase1Start: number;
    phase1CouplingLinesEnd: number;
    phase1FadeStart: number;
    phase1FadeEnd: number;
    phase1End: number;
    phase2Start: number;
    phase2TrajectoryEnd: number;
    phase2End: number;
    phase3Start: number;
    phase3CouplingEnd: number;
    phase3End: number;
  } = {
    // Phase 1: Independent Coupling
    phase1Start: 0,
    phase1CouplingLinesEnd: 0.12,    // Lines animate from 0 to here
    phase1FadeStart: 0.18,           // Hold, then start fading
    phase1FadeEnd: 0.22,             // Fade completes here
    phase1End: 0.27,                 // Pause until phase ends

    // Phase 2: Simulate Flow
    phase2Start: 0.27,
    phase2TrajectoryEnd: 0.60,       // Trajectories animate until here
    phase2End: 0.70,                 // Pause after trajectories

    // Phase 3: Induced Coupling
    phase3Start: 0.70,
    phase3CouplingEnd: 0.85,         // Induced coupling lines animate (same duration as phase 1)
    phase3End: 1.0                   // Final pause
  };

  // Layout props
  export let width: number = 750;
  export let height: number = 375;
  export let marginWidth: number = 50;
  export let marginTop: number = 20;

  // Label props
  export let labelFontSize: number = settings.stylingSettings.label.fontSize;
  export let labelFontFamily: string = "Helvetica, Arial, sans-serif";
  export let toggleFontSize: number = 16;

  // Toggle button labels
  const stateLabels = ["1. Independent Coupling", "2. Simulate the Flow", "3. Induced Coupling"];

  // Caption slot
  export let children: Snippet | undefined = undefined;

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
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;

  // Animation state - extends PathlineAnimationState with additional fields
  type AnimationState = PathlineAnimationState & {
    stateIndex: number;              // 0, 1, or 2 for toggle button
    naiveCouplingProgress: number;   // 0 → 1 for naive coupling lines (left to right)
    naiveCouplingOpacity: number;    // 1 → 0 during fade
    inducedCouplingProgress: number; // 0 → 1 for induced coupling lines
  };

  // Pre-computed data
  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];  // Combined: ground truth + generated endpoints
  let generatedEndpointPixelCoords: number[][] = [];  // Just the generated endpoints (for induced coupling)
  let shuffledTargetIndices: number[] = [];  // For naive coupling (random pairings into full target pool)
  let transformedTrajectories: number[][][] = [];
  let combinedMeanX: number = 0;
  let numTimeSteps: number = 1;

  // Generated trajectories from forward flow
  let generatedTrajectories: number[][][] | null = null;
  let isGeneratingTrajectories: boolean = false;

  // Playback control
  let player: Player<AnimationState> | null = null;
  let pathlineAnimation: PathlineAnimation<AnimationState> | null = null;
  let currentState: AnimationState = {
    segmentIndex: 0,
    stateIndex: 0,
    naiveCouplingProgress: 0,
    naiveCouplingOpacity: 1,
    inducedCouplingProgress: 0
  };

  // Visibility tracking
  let figureIsActive: Writable<boolean> | undefined;
  const { handleVisibilityChange } = useVisibilityHandler(() => player);
  let initialized: boolean = false;

  // State index for toggle button (derived from animation state)
  $: stateIndex = currentState.stateIndex;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function getPixelX(dataX: number, meanX: number, t: number): number {
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

  function runInitialComputation(): boolean {
    if (!generatedTrajectories || generatedTrajectories.length === 0) return false;

    // Filter trajectories to exclude outliers based on starting point radius
    const filteredTrajectories = clipTrajectoriesToStartingRadius(generatedTrajectories, SOURCE_RADIUS_THRESHOLD);

    // Validate filtered trajectories have samples
    if (!filteredTrajectories ||
        filteredTrajectories.length === 0 ||
        !filteredTrajectories[0] ||
        filteredTrajectories[0].length === 0) {
      console.warn('[InducedCouplingAnimated] No valid trajectories after filtering');
      return false;
    }

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

    return true;
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Cached values for clip closures
  let cachedNumSegments: number = 0;

  async function setupTimeline() {
    // Create PathlineAnimation for trajectory phase
    pathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(
      transformedTrajectories,
      {
        style: {
          color: settings.stylingSettings.trajectory.color,
          strokeWidth: settings.stylingSettings.trajectory.strokeWidth,
          pointRadius: settings.stylingSettings.trajectory.endpointRadius,
          opacity: settings.stylingSettings.trajectory.opacity,
        }
      }
    );

    // Initialize with canvas
    await pathlineAnimation.init(canvas);

    // Cache values for closures
    cachedNumSegments = pathlineAnimation.data.numSegments;

    // Pre-compute normalized sub-phase boundaries within each clip
    const phase1Duration = timing.phase1End - timing.phase1Start;
    const c1_couplingEnd = (timing.phase1CouplingLinesEnd - timing.phase1Start) / phase1Duration;
    const c1_fadeStart = (timing.phase1FadeStart - timing.phase1Start) / phase1Duration;
    const c1_fadeEnd = (timing.phase1FadeEnd - timing.phase1Start) / phase1Duration;

    const phase2Duration = timing.phase2End - timing.phase2Start;
    const c2_trajectoryEnd = (timing.phase2TrajectoryEnd - timing.phase2Start) / phase2Duration;

    const phase3Duration = timing.phase3End - timing.phase3Start;
    const c3_couplingEnd = (timing.phase3CouplingEnd - timing.phase3Start) / phase3Duration;

    const tl = Timeline.from<AnimationState>({
      duration: 1,
      initialState: {},
      clips: [
        { clip: {
        name: "IndependentCoupling",
        reduce(t: number) {
          if (t < c1_couplingEnd) {
            // Animating lines from left to right
            const progress = t / c1_couplingEnd;
            return { stateIndex: 0, naiveCouplingProgress: progress, naiveCouplingOpacity: 1, segmentIndex: 0, inducedCouplingProgress: 0 };
          } else if (t < c1_fadeStart) {
            // Lines fully drawn, holding
            return { stateIndex: 0, naiveCouplingProgress: 1, naiveCouplingOpacity: 1, segmentIndex: 0, inducedCouplingProgress: 0 };
          } else if (t < c1_fadeEnd) {
            // Fade out
            const fadeProgress = (t - c1_fadeStart) / (c1_fadeEnd - c1_fadeStart);
            const opacity = Math.max(0, 1 - fadeProgress);
            return { stateIndex: 0, naiveCouplingProgress: 1, naiveCouplingOpacity: opacity, segmentIndex: 0, inducedCouplingProgress: 0 };
          } else {
            // Pause after fade (hold at opacity 0)
            return { stateIndex: 0, naiveCouplingProgress: 1, naiveCouplingOpacity: 0, segmentIndex: 0, inducedCouplingProgress: 0 };
          }
        }
      }, ...{ start: timing.phase1Start, end: timing.phase1End } },
        { clip: {
        name: "SimulateFlow",
        reduce(t: number) {
          if (t < c2_trajectoryEnd) {
            // Animating trajectories
            const segIdx = Math.floor((t / c2_trajectoryEnd) * cachedNumSegments);
            return { stateIndex: 1, naiveCouplingProgress: 0, naiveCouplingOpacity: 0, segmentIndex: segIdx, inducedCouplingProgress: 0 };
          } else {
            // Pause at end
            return { stateIndex: 1, naiveCouplingProgress: 0, naiveCouplingOpacity: 0, segmentIndex: cachedNumSegments, inducedCouplingProgress: 0 };
          }
        }
      }, ...{ start: timing.phase2Start, end: timing.phase2End } },
        { clip: {
        name: "InducedCoupling",
        reduce(t: number) {
          if (t < c3_couplingEnd) {
            // Drawing induced coupling lines
            const progress = t / c3_couplingEnd;
            return { stateIndex: 2, naiveCouplingProgress: 0, naiveCouplingOpacity: 0, segmentIndex: cachedNumSegments, inducedCouplingProgress: progress };
          } else {
            // Pause at end
            return { stateIndex: 2, naiveCouplingProgress: 0, naiveCouplingOpacity: 0, segmentIndex: cachedNumSegments, inducedCouplingProgress: 1 };
          }
        }
      }, ...{ start: timing.phase3Start, end: timing.phase3End } },
      ],
    });
    player = new Player(tl, { looping: true });
    player.onTick((_, state) => {
      currentState = state;
      draw(state);
    });
  }

  function startAnimation() {
    if (!player) return;
    player.play();
  }

  function stopAnimation() {
    if (player) player.pause();
  }

  export function restart() {
    if (!player) return;
    player.reset();
    player.play();
  }

  export function pause() {
    if (player) player.pause();
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
    const labelFontWeight = settings.stylingSettings.label.fontWeight;
    const labelOpacity = settings.stylingSettings.label.opacity;
    const labelFont = `${labelFontWeight} ${labelFontSize}px ${labelFontFamily}`;
    const labelY = marginTop / 2 + 5;
    drawText(ctx, "Source Distribution", scales.sourceCenterPixelX, labelY, { color: labelColor, font: labelFont, opacity: labelOpacity });
    drawText(ctx, "Target Distribution", scales.targetCenterPixelX, labelY, { color: labelColor, font: labelFont, opacity: labelOpacity });
  }

  function drawNaiveCouplingLines(progress: number = 1, opacity: number = couplingLineOpacity): void {
    // Guard against empty arrays
    if (!sourcePixelCoords.length || !targetPixelCoords.length || !shuffledTargetIndices.length) {
      return;
    }

    ctx.strokeStyle = couplingLineColor;
    ctx.lineWidth = couplingLineWidth;
    ctx.globalAlpha = opacity;

    const linesToDraw = Math.min(numLinesToDraw, sourcePixelCoords.length);
    for (let i = 0; i < linesToDraw; i++) {
      const [sx, sy] = sourcePixelCoords[i];
      // Connect to random target from full target pool
      const targetIdx = shuffledTargetIndices[i % shuffledTargetIndices.length];
      const [tx, ty] = targetPixelCoords[targetIdx];

      // Animate from source to target
      const endX = sx + (tx - sx) * progress;
      const endY = sy + (ty - sy) * progress;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  function drawAnimatedTrajectories(state: AnimationState) {
    if (!pathlineAnimation) return;
    pathlineAnimation.draw(state);
  }

  function drawInducedCouplingLines(progress: number = 1): void {
    // Guard against empty arrays
    if (!sourcePixelCoords.length || !generatedEndpointPixelCoords.length) {
      return;
    }

    ctx.strokeStyle = couplingLineColor;
    ctx.lineWidth = couplingLineWidth;
    ctx.globalAlpha = couplingLineOpacity;

    const linesToDraw = Math.min(numLinesToDraw, sourcePixelCoords.length, generatedEndpointPixelCoords.length);
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
    const { stateIndex, naiveCouplingProgress, naiveCouplingOpacity, segmentIndex, inducedCouplingProgress } = state;

    if (stateIndex === 0 && naiveCouplingProgress > 0) {
      // State 0: Draw naive coupling lines (animated left to right, with fade)
      drawNaiveCouplingLines(naiveCouplingProgress, naiveCouplingOpacity * couplingLineOpacity);
    } else if (stateIndex === 1) {
      // State 1: Draw animated trajectories
      drawAnimatedTrajectories(state);
    } else if (stateIndex === 2 && inducedCouplingProgress > 0) {
      // State 2: Draw induced coupling lines
      drawInducedCouplingLines(inducedCouplingProgress);
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function jumpToState(newStateIndex: number) {
    if (!player) return;

    // Seek to the start of the appropriate phase using timing object
    const seekTime = [timing.phase1Start, timing.phase2Start, timing.phase3Start][newStateIndex] ?? 0;

    const wasPlaying = player.isPlaying;
    // seek() triggers onTick callbacks which updates currentState and calls draw()
    player.seek(seekTime);

    // Resume playing if it was playing before
    if (wasPlaying) {
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
    const success = runInitialComputation();
    if (success) {
      setupTimeline().then(() => {
        initialized = true;
        draw(player!.initialState);
        startAnimation();
      });
    }
  }

  // Handle visibility changes — reset on slide exit so next visit starts from stage 1
  $: if (figureIsActive !== undefined && initialized) {
    if (!$figureIsActive) {
      player?.pause();
      player?.reset();
    } else {
      player?.play();
    }
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
          fontSize={toggleFontSize}
          padding="8px 20px"
          onchange={jumpToState}
        />
      </div>
    </div>
  {/snippet}
</Figure>
