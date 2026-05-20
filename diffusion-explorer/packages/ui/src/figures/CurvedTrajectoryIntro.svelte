<script lang="ts" context="module">
  export interface CurvedTrajectoryIntroSettings {
    interactiveSettings: { maxUserTrajectories: number };
    stylingSettings: {
      scatterPlot: {
        clippingRadius: number;
        yShiftFactor: number;
        radius: number;
        color: string;
        opacity: number;
      };
      layout: { sourceCenterX: number; targetCenterX: number };
      trajectory: {
        color: string;
        strokeWidth: number;
        endpointRadius: number;
        opacity: number;
      };
      label: {
        color: string;
        fontSize: number;
        fontWeight: number | string;
        opacity: number;
      };
    };
    flowModelWorkerUrl: string | null;
    flowMatchingModelPath: string | null;
  }

  // Minimal duck-typed interface — accepts any FlowModelClient-like object.
  // Avoids coupling @diffusion-explorer/ui to @diffusion-explorer/diffusion.
  export interface FlowModelClientLike {
    stopRequest(id: string): void;
    sampleFromInitialPoints(
      initialPoints: number[][],
      numSteps: number,
      options: object,
      onStep?: (step: number, x_t: number[][]) => void
    ): { requestId: string; promise: Promise<unknown> };
  }
</script>

<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import Figure from "../components/Figure.svelte";
  import TimeSlider from "../components/TimeSlider.svelte";
  import { drawScatterPlot, drawText } from "../plotting/plotting";
  import { createSourceTargetScales } from "../d3_utils";
  import { useCanvas2D } from "../plotting/canvas";
  import { PathlineAnimation, type PathlineAnimationState } from "../animation/animations/pathline-animation";
  import { Timeline, Player, useVisibilityHandler } from "tempus";
  import type { Writable } from "svelte/store";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // App-specific settings (styling, layout, model paths)
  export let settings: CurvedTrajectoryIntroSettings;

  // FlowModelClient instance (passed from parent, created with correct base path)
  export let flowMatchingClient: FlowModelClientLike | null = null;

  // Data props
  export let sourceDistributionSamples: number[][] = [];
  export let targetDistributionSamples: number[][] = [];
  export let allTimeSamples: number[][][]; // [timestep][sample][dim]

  // Animation settings
  export let animationDuration: number = 6000;
  export let playingByDefault: boolean = true;
  export let pauseBeforeRestart: number = 1000;

  // Layout
  export let width: number = 750;
  export let height: number = 375;
  export let marginWidth: number = 50;
  export let marginHeight: number = 20;

  // Trajectory settings
  export let numTrajectoriesToShow: number = 10;
  export let maxTrajectories: number = 30;
  export let maxUserTrajectories: number = settings.interactiveSettings.maxUserTrajectories;

  // Caption slot (passed as default children)
  export let children: Snippet | undefined = undefined;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  type SourceTargetScales = ReturnType<typeof createSourceTargetScales>;

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;

  // Animation state type - extends PathlineAnimationState
  type AnimationState = PathlineAnimationState;

  // Animation state - Timeline system (Timeline owns Clock internally)
  let initialized = false;
  let player: Player<AnimationState> | null = null;

  // PathlineAnimation instance for clip generation
  let pathlineAnimation: PathlineAnimation<AnimationState> | null = null;

  // Visibility tracking
  let figureIsActive: Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // Pre-computed data (computed once on mount/data change)
  let scales: SourceTargetScales | null = null;
  let regularTrajectories: number[][][] = []; // [trajectory][timestep][x,y in pixels] - fixed pre-computed
  let sourcePixelCoords: number[][] = []; // [point][x,y] in pixel space
  let targetPixelCoords: number[][] = []; // [point][x,y] in pixel space
  let selectedTrajectoryIndices: number[] = [];
  let combinedMeanX: number = 0;

  // User-defined trajectory state
  let userStartPoints: number[][] = []; // Array of [x, y] domain coordinates
  let inProgressUserTrajectories: number[][][] = []; // Currently streaming [trajectory][timestep][x,y]
  let completedUserTrajectories: number[][][] = []; // Completed user trajectories (capped at maxUserTrajectories)
  let activeRequestId: string | null = null;

  // Derived values
  $: numTimeSteps = allTimeSamples?.length || 1;
  $: numSegments = numTimeSteps - 1;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // Pick trajectories (first N samples that start within bounds)
  function selectTrajectoryIndices() {
    if (!allTimeSamples || allTimeSamples.length === 0) return;

    // Filter to only include trajectories with starting points within clipping radius
    const clippingRadius = settings.stylingSettings.scatterPlot.clippingRadius;
    const validIndices: number[] = [];

    for (let i = 0; i < allTimeSamples[0].length && validIndices.length < numTrajectoriesToShow; i++) {
      const startPoint = allTimeSamples[0][i];
      const distance = Math.sqrt(startPoint[0] ** 2 + startPoint[1] ** 2);
      if (distance <= clippingRadius) {
        validIndices.push(i);
      }
    }

    selectedTrajectoryIndices = validIndices;
  }

  function getPixelX(dataX: number, meanX: number, t: number): number {
    const centerPixelX =
      scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - meanX) * scales.xScaleFactor;
  }

  // Pre-compute all trajectory pixel coordinates
  function precomputeTrajectories() {
    if (!allTimeSamples || allTimeSamples.length === 0 || !scales) return;

    const allX = [
      ...sourceDistributionSamples.map((p) => p[0]),
      ...targetDistributionSamples.map((p) => p[0]),
    ];
    combinedMeanX = allX.reduce((a, b) => a + b, 0) / allX.length;

    regularTrajectories = selectedTrajectoryIndices.map((sampleIdx) => {
      return allTimeSamples.map((timestep, tIdx) => {
        const point = timestep[sampleIdx];
        const t = tIdx / (allTimeSamples.length - 1);
        const pixelX = getPixelX(point[0], combinedMeanX, t);
        const pixelY = scales.yScale(point[1]);
        return [pixelX, pixelY];
      });
    });
  }

  // Pre-compute scatter plot pixel coordinates
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

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
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

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  async function setupTimeline() {
    // Create PathlineAnimation for regular trajectories with settings-based style
    pathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(regularTrajectories, {
      style: {
        color: settings.stylingSettings.trajectory.color,
        strokeWidth: settings.stylingSettings.trajectory.strokeWidth,
        pointRadius: settings.stylingSettings.trajectory.endpointRadius,
        opacity: settings.stylingSettings.trajectory.opacity,
      }
    });

    // Initialize the animation with the canvas
    await pathlineAnimation.init(canvas);

    const tl = Timeline.from<AnimationState>({
      duration: animationDuration / 1000,
      initialState: { segmentIndex: 0 },
      clips: [
        { clip: pathlineAnimation.clip, start: 0, end: 1 },
      ],
    });
    player = new Player(tl, {
      looping: true,
      endPause: pauseBeforeRestart / 1000,
    });
    player.onTick((_, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx || !initialized || !pathlineAnimation) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // --- Static Background ---
    drawScatterPlot(
      ctx,
      sourcePixelCoords,
      settings.stylingSettings.scatterPlot.radius,
      settings.stylingSettings.scatterPlot.color,
      settings.stylingSettings.scatterPlot.opacity
    );

    // Draw target scatter (right)
    drawScatterPlot(
      ctx,
      targetPixelCoords,
      settings.stylingSettings.scatterPlot.radius,
      settings.stylingSettings.scatterPlot.color,
      settings.stylingSettings.scatterPlot.opacity
    );

    // Draw distribution labels
    const labelColor = settings.stylingSettings.label.color;
    const labelFontSize = settings.stylingSettings.label.fontSize;
    const labelFontWeight = settings.stylingSettings.label.fontWeight;
    const labelOpacity = settings.stylingSettings.label.opacity;
    const labelFont = `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`;
    drawText(ctx, "Source Distribution", scales.sourceCenterPixelX, marginHeight / 2, { color: labelColor, font: labelFont, opacity: labelOpacity });
    drawText(ctx, "Target Distribution", scales.targetCenterPixelX, marginHeight / 2, { color: labelColor, font: labelFont, opacity: labelOpacity });

    // --- Dynamic Foreground ---
    const normalOpacity = settings.stylingSettings.trajectory.opacity;
    const dimmedOpacity = 0.15;

    // Combine completed and in-progress user trajectories
    const validInProgress = inProgressUserTrajectories.filter(t => t && t.length >= 2);
    const allUserTrajectories = [...completedUserTrajectories, ...validInProgress];
    const hasUserTrajectories = allUserTrajectories.length > 0;

    // Draw regular trajectories (dimmed if user has clicked)
    pathlineAnimation.draw(state, {
      opacity: hasUserTrajectories ? dimmedOpacity : normalOpacity,
    });

    // Draw user trajectories (full opacity)
    if (hasUserTrajectories) {
      pathlineAnimation.draw({ ...state, pathlines: allUserTrajectories }, {
        opacity: 1.0,
      });
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  // Handle canvas click - restricted to source distribution region
  function handleCanvasClick(event: MouseEvent) {
    if (!settings.flowModelWorkerUrl || !settings.flowMatchingModelPath) return;
    if (!scales || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    // Restrict to source distribution region (left half of canvas)
    const sourceRegionMaxX = width * 0.5;
    if (clickX > sourceRegionMaxX) return;

    // Convert pixel to domain coordinates
    // Inverse of: pixelX = sourceCenterPixelX + (dataX - sourceMeanX) * xScaleFactor
    const domainX = scales.sourceMeanX + (clickX - scales.sourceCenterPixelX) / scales.xScaleFactor;
    const domainY = scales.yScale.invert(clickY);

    // Cancel any in-progress request before adding new point
    if (activeRequestId) {
      flowMatchingClient.stopRequest(activeRequestId);
      activeRequestId = null;
    }

    // Add new point to the list of user start points
    userStartPoints = [...userStartPoints, [domainX, domainY]];

    // If we exceed the max, remove the oldest point
    if (userStartPoints.length > maxUserTrajectories) {
      userStartPoints = userStartPoints.slice(-maxUserTrajectories);
    }

    // Start sampling all user points
    sampleFromUserPoints();
  }

  // Sample trajectories from all user start points
  function sampleFromUserPoints() {
    if (userStartPoints.length === 0) return;

    // Initialize in-progress trajectories for each user point at t=0 position
    inProgressUserTrajectories = userStartPoints.map(point => {
      const initialPixelX = getPixelX(point[0], combinedMeanX, 0);
      const initialPixelY = scales.yScale(point[1]);
      return [[initialPixelX, initialPixelY]];
    });

    // Reset animation and start
    if (player) {
      player.reset();
      player.play();
    }

    // Sample all user points with streaming
    const result = flowMatchingClient.sampleFromInitialPoints(
      userStartPoints,
      numTimeSteps,
      {},
      // onStep - append each new point for all trajectories, transformed to pixel space
      (step, x_t) => {
        const t = (step + 1) / numTimeSteps;
        inProgressUserTrajectories = inProgressUserTrajectories.map((traj, sampleIdx) => {
          if (sampleIdx < x_t.length) {
            const pixelX = getPixelX(x_t[sampleIdx][0], combinedMeanX, t);
            const pixelY = scales.yScale(x_t[sampleIdx][1]);
            return [...traj, [pixelX, pixelY]];
          }
          return traj;
        });
      }
    );
    activeRequestId = result.requestId;
    result.promise.then(() => {
      // Move completed trajectories to completedUserTrajectories
      const validTrajectories = inProgressUserTrajectories.filter(t => t && t.length > 1);
      if (validTrajectories.length > 0) {
        completedUserTrajectories = [...completedUserTrajectories, ...validTrajectories];

        // Cap at maxUserTrajectories (remove oldest)
        if (completedUserTrajectories.length > maxUserTrajectories) {
          completedUserTrajectories = completedUserTrajectories.slice(-maxUserTrajectories);
        }
      }
      inProgressUserTrajectories = [];
      userStartPoints = [];
      activeRequestId = null;
    });
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (player) player.pause();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Initialize when canvas and data are ready
  $: if (
    canvas &&
    allTimeSamples &&
    allTimeSamples.length > 0 &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    !initialized
  ) {
    runInitialComputation();
    setupTimeline().then(() => {
      initialized = true;
      draw(player!.state);
      if (playingByDefault) player!.play();
    });
  }

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && initialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure {caption} backgroundVisible={false} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div
      style="display:flex;flex-direction:column;align-items:center;width:100%;"
    >
      <canvas
        bind:this={canvas}
        use:canvas2d.bindCanvas
        onclick={handleCanvasClick}
        style="cursor:pointer;width:100%;height:auto;max-width:{width}px;aspect-ratio:{width}/{height};"
      ></canvas>
      <TimeSlider timeline={player}
        color={settings.stylingSettings.trajectory.color}
      />
    </div>
  {/snippet}
</Figure>
