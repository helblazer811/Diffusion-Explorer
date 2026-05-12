<!--
  Eulerian vs Lagrangian Visualization

  Contrasts the Eulerian (velocity field) and Lagrangian (sample trajectories)
  perspectives on a flow transporting a Gaussian to a smiley-face distribution.
  Both panels are driven by a single shared timeline.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    DoubleFigure,
    Katex,
    Timeline,
    TimeSlider,
    useVisibilityHandler,
    drawScatterPlot,
    drawTrajectories,
    drawVectorField,
    sampleVelocityGridAt,
    buildUniformGrid,
    type Clip,
    type TrajectoryStyleOptions,
    type VectorFieldStyleOptions,
    type VelocityGridMetadata,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  let {
    // Layout
    canvasWidth = 390,
    canvasHeight = 390,
    gap = 20,
    margin = 15,

    // Animation
    animationDurationMs = 10000,
    playingByDefault = true,

    // Quiver (Eulerian panel)
    displayGridSize = 5,
    arrowScale = 50,
    arrowStrokeWidth = 3,
    arrowHeadRadius = 6,
    arrowOpacity = 0.85,
    quiverInsetFraction = 0.08,

    // Trajectories (Lagrangian panel)
    trajectoryStrokeWidth = 3,
    trajectoryPointRadius = 5,
    trajectoryOpacity = 0.95,
    trajectoryPreviewOpacity = 0.18,

    // Target distribution (background scatter on both panels)
    targetPointRadius = 4,
    targetOpacity = 0.22,

    // Render domain (narrower than the underlying velocity-grid metadata domain
    // so the smiley fills more of the canvas)
    displayDomain = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },

    // Equations rendered under each subtitle (set to "" to hide)
    eulerianEquation = "v_t(x) : \\mathbb{R}^d \\times [0,1] \\to \\mathbb{R}^d",
    lagrangianEquation = "\\tfrac{d}{dt}\\phi_t(x_0) = v_t\\!\\left(\\phi_t(x_0)\\right)",
    equationFontSize = "1.45em",

    // Rendering
    dpiScale = 3,
    seed = 12345,

    // Colors — every color in the visualization derives from these props
    velocityColor = "#3b82f6",
    trajectoryColor = "#f97316",
    targetColor = "#888888",
    // Titles default to their respective perspective color
    eulerianTitleColor = "",
    lagrangianTitleColor = "",
    subtitleColor = "#777777",
    // Equations match the title color
    eulerianEquationColor = "",
    lagrangianEquationColor = "",
    // Time slider is intentionally neutral so it doesn't claim either perspective
    timeSliderColor = "#999999",
  } = $props();

  // Resolve title/slider colors from defaults so the caller can swap a single
  // velocityColor/trajectoryColor and have every dependent surface follow.
  const resolvedEulerianTitleColor = eulerianTitleColor || velocityColor;
  const resolvedLagrangianTitleColor = lagrangianTitleColor || trajectoryColor;
  const resolvedEulerianEquationColor = eulerianEquationColor || resolvedEulerianTitleColor;
  const resolvedLagrangianEquationColor = lagrangianEquationColor || resolvedLagrangianTitleColor;
  const resolvedTimeSliderColor = timeSliderColor || trajectoryColor;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  type AnimationState = {
    time: number;
    timeIndex: number;
    segmentIndex: number;
  };

  const physicalWidth = canvasWidth * dpiScale;
  const physicalHeight = canvasHeight * dpiScale;

  let canvasLeft: HTMLCanvasElement | null = $state(null);
  let canvasRight: HTMLCanvasElement | null = $state(null);
  let ctxLeft: CanvasRenderingContext2D | null = $state(null);
  let ctxRight: CanvasRenderingContext2D | null = $state(null);

  let timeline: Timeline<AnimationState> | null = $state(null);
  let isInitialized = $state(false);
  let loadError: string | null = $state(null);

  let velocityGrids: Float32Array | null = $state(null);
  let gridMetadata: VelocityGridMetadata | null = $state(null);

  let trajectories: number[][][] | null = $state(null);
  let scaledTrajectories: number[][][] | null = $state(null);
  let targetDistribution: number[][] | null = $state(null);
  let scaledTargetDistribution: number[][] | null = $state(null);

  let displayGridPositionsDomain: number[][] = $state([]);
  let displayGridPositionsPixel: number[][] = $state([]);

  let numSteps = 100;
  let numTimesteps = 100;

  // Visibility
  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    canvas.width = physicalWidth;
    canvas.height = physicalHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpiScale, dpiScale);
    }
    return ctx;
  }

  function toPixel(point: number[]): number[] {
    const gridWidth = canvasWidth - 2 * margin;
    const gridHeight = canvasHeight - 2 * margin;
    return [
      margin + ((point[0] - displayDomain.xMin) / (displayDomain.xMax - displayDomain.xMin)) * gridWidth,
      margin + ((point[1] - displayDomain.yMin) / (displayDomain.yMax - displayDomain.yMin)) * gridHeight,
    ];
  }

  function scaleTrajectories(trajs: number[][][]): number[][][] {
    return trajs.map((traj) => traj.map((point) => toPixel(point)));
  }

  function scaleTargetDistribution(points: number[][]): number[][] {
    return points.map((point) => toPixel(point));
  }


  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  async function runInitialComputation() {
    console.log("[EulerianVsLagrangian] Running initial computation...");

    try {
      console.log("[EulerianVsLagrangian] Loading velocity grids...");
      const [metaResponse, binResponse] = await Promise.all([
        fetch("/eulerian_vs_lagrangian/velocity_grids_meta.json"),
        fetch("/eulerian_vs_lagrangian/velocity_grids.bin"),
      ]);

      if (!metaResponse.ok || !binResponse.ok) {
        throw new Error("Failed to load velocity grid files. Run the preparation scripts first.");
      }

      gridMetadata = await metaResponse.json();
      const binData = await binResponse.arrayBuffer();
      velocityGrids = new Float32Array(binData);
      console.log(`[EulerianVsLagrangian] Loaded velocity grids: ${velocityGrids.length} floats`);
    } catch (err) {
      console.error("[EulerianVsLagrangian] Failed to load velocity grids:", err);
      loadError = "Failed to load velocity grids";
      return;
    }

    // Load pre-computed trajectories (seeded on a uniform grid) and target distribution
    try {
      const trajResponse = await fetch("/eulerian_vs_lagrangian/trajectories.json");
      if (!trajResponse.ok) {
        throw new Error("Failed to load trajectories. Run sample:eulerian-vs-lagrangian first.");
      }
      const trajData = await trajResponse.json();

      // Transpose from [step][sample][dim] to [sample][step][dim]
      const rawTrajectories = trajData.trajectories as number[][][];
      const numStepsLoaded = rawTrajectories.length;
      const numSamples = rawTrajectories[0].length;
      trajectories = [];
      for (let s = 0; s < numSamples; s++) {
        const traj: number[][] = [];
        for (let t = 0; t < numStepsLoaded; t++) {
          traj.push(rawTrajectories[t][s]);
        }
        trajectories.push(traj);
      }

      targetDistribution = trajData.targetDistribution;
      numSteps = numStepsLoaded;
    } catch (err) {
      console.error("[EulerianVsLagrangian] Failed to load trajectories:", err);
      loadError = "Failed to load trajectories";
      return;
    }

    if (!gridMetadata) return;
    numTimesteps = gridMetadata.numTimesteps;

    // Build the display grid (same grid used by both the quiver and the trajectory seeds)
    displayGridPositionsDomain = buildUniformGrid(displayGridSize, displayDomain, quiverInsetFraction);
    displayGridPositionsPixel = displayGridPositionsDomain.map((p) => toPixel(p));

    scaledTrajectories = scaleTrajectories(trajectories);
    scaledTargetDistribution = scaleTargetDistribution(targetDistribution!);
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  const syncClip: Clip<AnimationState> = {
    name: "sync",
    reduce: (t) => ({
      time: t,
      timeIndex: Math.min(Math.floor(t * numTimesteps), numTimesteps - 1),
      segmentIndex: Math.min(Math.floor(t * numSteps), numSteps - 1),
    }),
  };

  function setupTimeline() {
    console.log("[EulerianVsLagrangian] Setting up timeline...");

    const initialState: AnimationState = {
      time: 0,
      timeIndex: 0,
      segmentIndex: 0,
    };

    timeline = new Timeline<AnimationState>();
    timeline.initialState = initialState;
    timeline.duration = animationDurationMs / 1000;
    timeline.looping = true;

    timeline.add(syncClip, { start: 0, end: 1 });

    timeline.onTick((_, state) => {
      draw(state);
    });

    console.log("[EulerianVsLagrangian] Timeline setup complete");
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  const vectorFieldStyle: VectorFieldStyleOptions = {
    arrowScale,
    strokeWidth: arrowStrokeWidth,
    color: velocityColor,
    opacity: arrowOpacity,
    headRadius: arrowHeadRadius,
    normalizeVectors: false,
    centerQuiver: false,
  };

  const trajectoryStyle: TrajectoryStyleOptions = {
    strokeWidth: trajectoryStrokeWidth,
    color: trajectoryColor,
    opacity: trajectoryOpacity,
    pointRadius: trajectoryPointRadius,
    showPreview: true,
    previewOpacity: trajectoryPreviewOpacity,
  };

  function draw(state: AnimationState) {
    const { timeIndex, segmentIndex } = state;

    // --- Left Panel: Eulerian (velocity field) ---
    if (ctxLeft && velocityGrids && gridMetadata && displayGridPositionsPixel.length > 0) {
      ctxLeft.clearRect(0, 0, canvasWidth, canvasHeight);
      ctxLeft.fillStyle = "#ffffff";
      ctxLeft.fillRect(0, 0, canvasWidth, canvasHeight);

      // Static background: faint target distribution
      if (scaledTargetDistribution) {
        drawScatterPlot(ctxLeft, scaledTargetDistribution, targetPointRadius, targetColor, targetOpacity);
      }

      // Dynamic foreground: velocity field at current timestep
      const velocities = sampleVelocityGridAt(
        velocityGrids,
        timeIndex,
        displayGridPositionsDomain,
        gridMetadata
      );
      drawVectorField(ctxLeft, displayGridPositionsPixel, velocities, vectorFieldStyle);
    } else if (ctxLeft && loadError) {
      ctxLeft.fillStyle = "#1a1a1a";
      ctxLeft.fillRect(0, 0, canvasWidth, canvasHeight);
      ctxLeft.fillStyle = "#ffffff";
      ctxLeft.font = "14px sans-serif";
      ctxLeft.textAlign = "center";
      ctxLeft.fillText(loadError, canvasWidth / 2, canvasHeight / 2);
    }

    // --- Right Panel: Lagrangian (trajectories) ---
    if (ctxRight) {
      ctxRight.clearRect(0, 0, canvasWidth, canvasHeight);
      ctxRight.fillStyle = "#ffffff";
      ctxRight.fillRect(0, 0, canvasWidth, canvasHeight);

      // Static background: faint target distribution
      if (scaledTargetDistribution) {
        drawScatterPlot(ctxRight, scaledTargetDistribution, targetPointRadius, targetColor, targetOpacity);
      }

      // Dynamic foreground: animated trajectories
      if (scaledTrajectories) {
        drawTrajectories(ctxRight, scaledTrajectories, segmentIndex, trajectoryStyle);
      }
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) {
      timeline.dispose();
    }
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $effect(() => {
    if (canvasLeft && !ctxLeft) {
      ctxLeft = setupCanvas(canvasLeft);
    }
  });

  $effect(() => {
    if (canvasRight && !ctxRight) {
      ctxRight = setupCanvas(canvasRight);
    }
  });

  $effect(() => {
    if (!isInitialized && ctxLeft && ctxRight) {
      runInitialComputation().then(() => {
        setupTimeline();
        isInitialized = true;

        if (playingByDefault && timeline) {
          draw(timeline.initialState);
          timeline.play();
        }
      });
    }
  });

  $effect(() => {
    if (figureIsActive !== undefined && isInitialized && $figureIsActive !== undefined) {
      handleVisibilityChange($figureIsActive);
    }
  });
</script>

<DoubleFigure {gap} bind:isActive={figureIsActive} backgroundVisible={false}>
  {#snippet left()}
    <div class="canvas-container">
      <h3 class="canvas-title" style="color: {resolvedEulerianTitleColor};">Eulerian</h3>
      <p class="canvas-subtitle" style="color: {subtitleColor};">Velocity at different points</p>
      {#if eulerianEquation}
        <div class="canvas-equation" style="color: {resolvedEulerianEquationColor};">
          <Katex math={eulerianEquation} displayMode displayFontSize={equationFontSize} color={resolvedEulerianEquationColor} />
        </div>
      {/if}
      <canvas
        bind:this={canvasLeft}
        width={physicalWidth}
        height={physicalHeight}
        style="width: 100%; max-width: {canvasWidth}px; height: auto; aspect-ratio: {canvasWidth} / {canvasHeight};"
      ></canvas>
    </div>
  {/snippet}

  {#snippet right()}
    <div class="canvas-container">
      <h3 class="canvas-title" style="color: {resolvedLagrangianTitleColor};">Lagrangian</h3>
      <p class="canvas-subtitle" style="color: {subtitleColor};">Trajectories of samples</p>
      {#if lagrangianEquation}
        <div class="canvas-equation" style="color: {resolvedLagrangianEquationColor};">
          <Katex math={lagrangianEquation} displayMode displayFontSize={equationFontSize} color={resolvedLagrangianEquationColor} />
        </div>
      {/if}
      <canvas
        bind:this={canvasRight}
        width={physicalWidth}
        height={physicalHeight}
        style="width: 100%; max-width: {canvasWidth}px; height: auto; aspect-ratio: {canvasWidth} / {canvasHeight};"
      ></canvas>
    </div>
  {/snippet}

  {#snippet footer()}
    <TimeSlider
      timeline={timeline as any}
      color={resolvedTimeSliderColor}
      showPlayButton
      maxWidth="644px"
      labelSize="1.15em"
    />
  {/snippet}

  {#snippet caption()}
    <strong>Eulerian vs Lagrangian perspectives on a flow from a Gaussian to a smiley face.</strong>
    <em>Left:</em> velocity field arrows at each grid point — the Eulerian view, focused on how velocity varies across space and time.
    <em>Right:</em> trajectories of individual samples — the Lagrangian view, following particles as they move with the flow.
  {/snippet}
</DoubleFigure>

<style>
  .canvas-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  .canvas-title {
    font-size: 2.2rem;
    font-weight: 600;
    text-align: center;
    margin: 0 0 0.35rem 0;
    max-width: 390px;
    width: 95%;
    line-height: 1.15;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .canvas-subtitle {
    font-size: 1.55rem;
    font-weight: 400;
    text-align: center;
    margin: 0 0 0.5rem 0;
    max-width: 390px;
    width: 95%;
    font-style: italic;
    line-height: 1.2;
  }

  .canvas-equation {
    text-align: center;
    margin: 0 0 1rem 0;
    max-width: 390px;
    width: 100%;
    line-height: 1.3;
  }

  /* DoubleFigure's .figure-content has padding-top/bottom: 0.5rem;
     zero out the bottom one so the time slider sits flush under the canvas. */
  :global(.left-figure),
  :global(.right-figure) {
    padding-bottom: 0 !important;
  }

</style>
