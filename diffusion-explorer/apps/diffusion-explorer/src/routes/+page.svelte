<script lang="ts">
  import { onMount, onDestroy, setContext } from "svelte";
  import { base } from "$app/paths";
  import { createMainState } from "$lib/state/main/state";
  import { createMainStateHandlers } from "$lib/state/main/actions";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import ControlBar from "$lib/components/ControlBar.svelte";
  import DistributionEditWindow from "$lib/components/DistributionEditWindow.svelte";
  import {
    TimeSlider,
    Timeline,
    type Clip,
    useCanvas2D,
    drawScatterPlot,
    computeContours,
    plotContours,
    plotMeshGrid,
    drawTrajectories,
    type TrajectoryStyleOptions,
  } from "@diffusion-explorer/ui";
  import {
    FlowModelClient,
    DiffusionModelClient,
  } from "@diffusion-explorer/diffusion";
  import {
    interfaceSettings,
    domainRange,
    contourPlotSettings,
    scatterPlotSettings,
    pretrainedModelPaths,
    trainingObjectiveToModelConfig,
  } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------
  // (This page has no props - it's the root page component)

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Page state context
  const pageState = createMainState();
  setContext("pageState", pageState);

  const {
    modeState,
    trainingState,
    playbackState,
    distributionData,
    visibility,
    config,
    modelState,
    datasetDict,
    isTraining,
    isEditing,
    isPlaying,
  } = pageState;
  const state_handlers = createMainStateHandlers(pageState);

  // Canvas setup - dual canvas for background (static) and foreground (animated)
  const width = interfaceSettings.displayAreaWidth;
  const height = interfaceSettings.displayAreaHeight;
  const bgCanvas2d = useCanvas2D(width, height);
  const fgCanvas2d = useCanvas2D(width, height);

  // Helper getters for canvas contexts (populated after bindCanvas action runs)
  const getBgCtx = () => bgCanvas2d.ctx;
  const getFgCtx = () => fgCanvas2d.ctx;

  // Animation state
  type AnimationState = {
    time: number;
  };
  let timeline: Timeline<AnimationState>;

  // Path plot state
  let pathClient: FlowModelClient | DiffusionModelClient | null = null;
  let streamedTrajectory: number[][] | null = null;
  let isStreaming = false;
  let activeRequestId: string | null = null;
  let handlePosition = [
    interfaceSettings.distributionWidth / 2,
    interfaceSettings.distributionHeight / 2,
  ];
  let isDragging = false;

  // Training/editing state flags
  let trainingInitiated = false;
  let editingInitiated = false;

  // Track if background needs redraw
  let bgNeedsRedraw = true;

  // Track if canvas is ready
  let canvasReady = false;

  // Precomputed contours for performance
  let sourceContours: any = null;
  let targetContours: any = null;
  let allTimeContours: any[] = [];

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // Data in stores is already in PIXEL coordinates (via convertDataToDisplayCoordinateFrame)
  // So we use identity functions for pixel-based plotting
  const identityScale = (v: number) => v;

  // Coordinate scales: Domain [-3, 3] -> Pixel [0, distributionWidth/Height]
  // Only used for path sampling where we need domain coords
  const domainToPixelX = (x: number) =>
    ((x - domainRange.xMin) / (domainRange.xMax - domainRange.xMin)) *
    interfaceSettings.distributionWidth;
  const domainToPixelY = (y: number) =>
    interfaceSettings.distributionHeight -
    ((y - domainRange.yMin) / (domainRange.yMax - domainRange.yMin)) *
      interfaceSettings.distributionHeight;

  // Pixel to domain coordinate conversion (for path handle position -> sampling)
  function pixelToDomainX(px: number): number {
    return (
      domainRange.xMin +
      (px / interfaceSettings.distributionWidth) *
        (domainRange.xMax - domainRange.xMin)
    );
  }
  function pixelToDomainY(py: number): number {
    return (
      domainRange.yMax -
      (py / interfaceSettings.distributionHeight) *
        (domainRange.yMax - domainRange.yMin)
    );
  }

  // Extract a random trajectory from cached samples (pixel coords with time offset -> domain coords)
  function extractRandomTrajectoryFromCached(
    samples: number[][][]
  ): number[][] | null {
    if (
      !samples ||
      samples.length === 0 ||
      !samples[0] ||
      samples[0].length === 0
    )
      return null;

    const numSamples = samples[0].length;
    const randomIdx = Math.floor(Math.random() * numSamples);
    const xRange = width - distWidth;

    // Extract trajectory: samples[t][randomIdx] for all t, convert back to domain coords
    const trajectory: number[][] = [];
    for (let t = 0; t < samples.length; t++) {
      const point = samples[t][randomIdx];
      if (!point) continue;

      // Remove time-based x offset to get position in source distribution space
      const pointTime = t / (samples.length - 1 || 1);
      const xOffset = xRange * pointTime;
      const pxInSource = point[0] - xOffset;

      // Convert pixel to domain
      const domainX = pixelToDomainX(pxInSource);
      const domainY = pixelToDomainY(point[1]);
      trajectory.push([domainX, domainY]);
    }

    return trajectory;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  // Contour computation options
  // NOTE: Data in stores is in PIXEL coordinates, positioned at different x offsets based on time
  // Source (t=0) is at x=0, Target (t=1) is at x=(displayAreaWidth - distributionWidth) = 800
  const distWidth = interfaceSettings.distributionWidth;
  const distHeight = interfaceSettings.distributionHeight;
  const targetXOffset = width - distWidth; // 1300 - 500 = 800
  const yOffset = 20; // Vertical offset to shift distributions down

  // Pull contour settings from centralized config
  const {
    bandwidth: contourBandwidth,
    contourLevels: contourThresholds,
    opacity: contourOpacity,
    sourceColor,
    targetColor,
    currentColor,
    trainingColor,
  } = contourPlotSettings;

  // Source distribution domain: [0, 500] x [yOffset, 500+yOffset]
  const sourceContourOptions = {
    gridSize: 100,
    bandwidth: contourBandwidth,
    thresholds: contourThresholds,
    domain: [0, distWidth, yOffset, distHeight + yOffset] as [
      number,
      number,
      number,
      number,
    ],
  };

  // Target distribution domain: [800, 1300] x [yOffset, 500+yOffset]
  const targetContourOptions = {
    gridSize: 100,
    bandwidth: contourBandwidth,
    thresholds: contourThresholds,
    domain: [
      targetXOffset,
      targetXOffset + distWidth,
      yOffset,
      distHeight + yOffset,
    ] as [number, number, number, number],
  };

  // Function to get contour options for a given time (for animated distributions)
  function getContourOptionsForTime(t: number) {
    const xOffset = (width - distWidth) * t;
    return {
      gridSize: 100,
      bandwidth: contourBandwidth,
      thresholds: contourThresholds,
      domain: [xOffset, xOffset + distWidth, yOffset, distHeight + yOffset] as [
        number,
        number,
        number,
        number,
      ],
    };
  }

  // Forward playback clip - maps normalized time to animation state
  const forwardClip: Clip<AnimationState> = {
    name: "Forward",
    reduce(t: number) {
      return { time: t };
    },
  };

  /**
   * Precompute all data that depends on distribution samples.
   * Called reactively when source/target/allTime samples change.
   */
  function runInitialComputation(params: {
    source?: number[][];
    target?: number[][];
    allTime?: number[][][];
  }) {
    const { source, target, allTime } = params;

    // Precompute source contours (at t=0, x offset = 0)
    if (source !== undefined) {
      sourceContours = source?.length
        ? computeContours(source, sourceContourOptions)
        : null;
      bgNeedsRedraw = true;
    }

    // Precompute target contours (at t=1, x offset = 800)
    if (target !== undefined) {
      targetContours = target?.length
        ? computeContours(target, targetContourOptions)
        : null;
      bgNeedsRedraw = true;
    }

    // Precompute contours for all time steps (each at different x offset based on time)
    if (allTime !== undefined) {
      if (!allTime || allTime.length === 0) {
        allTimeContours = [];
      } else {
        allTimeContours = allTime.map((samples, i) => {
          if (!samples || samples.length === 0) return null;
          const t = i / (allTime.length - 1);
          return computeContours(samples, getContourOptionsForTime(t));
        });
      }
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = { time: 0 };
    timeline.duration = 10; // 10 second animation cycle
    timeline.looping = true;
    timeline.add(forwardClip, { start: 0, end: 1 });

    // Sync timeline state to playbackState store and trigger redraw
    timeline.onTick((_t, state) => {
      playbackState.update((p) => ({ ...p, time: state.time }));
      drawForeground(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  // Draw static background (source/target distributions)
  function drawBackground() {
    const ctx = getBgCtx();
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    // Source distribution (contour at t=0)
    if (sourceContours && $visibility.source) {
      plotContours(ctx, sourceContours, {
        xScale: identityScale,
        yScale: identityScale,
        fillColor: sourceColor,
        fill: true,
        stroke: false,
        opacity: contourOpacity,
      });
    }

    // Target distribution (contour at t=1)
    if (targetContours && $visibility.target) {
      plotContours(ctx, targetContours, {
        xScale: identityScale,
        yScale: identityScale,
        fillColor: targetColor,
        fill: true,
        stroke: false,
        opacity: contourOpacity,
      });
    }

    bgNeedsRedraw = false;
  }

  // Draw animated foreground (current distribution, mesh, paths)
  function drawForeground(state: AnimationState) {
    const ctx = getFgCtx();
    if (!ctx) return;

    // Redraw background if needed
    if (bgNeedsRedraw) {
      drawBackground();
    }

    ctx.clearRect(0, 0, width, height);

    const time = state.time;
    const currentData = $distributionData.current;
    const gridSamples = $distributionData.allTimeGrid;
    const plotTypes = $config.activePlotTypes;

    // Get precomputed contour for current time
    const timeIndex =
      allTimeContours.length > 0
        ? Math.min(
            Math.floor(time * (allTimeContours.length - 1)),
            allTimeContours.length - 1
          )
        : -1;
    const currentContours = timeIndex >= 0 ? allTimeContours[timeIndex] : null;

    // Current distribution based on active plot types
    if ($visibility.current) {
      if (plotTypes.includes("Contour") && currentContours) {
        plotContours(ctx, currentContours, {
          xScale: identityScale,
          yScale: identityScale,
          fillColor: currentColor,
          fill: true,
          stroke: false,
          opacity: contourOpacity,
        });
      }
      if (
        plotTypes.includes("Scatter") &&
        currentData &&
        currentData.length > 0
      ) {
        drawDistributionScatter(
          ctx,
          currentData,
          currentColor,
          scatterPlotSettings.pointOpacity
        );
      }
      if (plotTypes.includes("Mesh") && gridSamples) {
        drawMeshGrid(ctx, time, gridSamples);
      }
      if (plotTypes.includes("Path") && streamedTrajectory && !isDragging) {
        drawPathTrajectory(ctx, time, streamedTrajectory);
      }
    }

    // Training distribution (incremental contour)
    if (
      $trainingState.intermediateSamples &&
      $trainingState.intermediateSamples.length > 0 &&
      $visibility.training
    ) {
      drawDistributionContour(
        ctx,
        $trainingState.intermediateSamples,
        trainingColor
      );
    }
  }

  // Draw helper: Contour for a distribution (used for training which is displayed at t=1 position)
  function drawDistributionContour(
    ctx: CanvasRenderingContext2D,
    data: number[][],
    fillColor: string
  ) {
    if (!ctx || !data || data.length === 0) return;

    // Training distribution is at t=1 position (same as target)
    const contours = computeContours(data, targetContourOptions);

    // Data is already in pixel coords, use identity scale
    plotContours(ctx, contours, {
      xScale: identityScale,
      yScale: identityScale,
      fillColor,
      fill: true,
      stroke: false,
      opacity: contourOpacity,
    });
  }

  // Draw helper: Scatter plot for a distribution
  function drawDistributionScatter(
    ctx: CanvasRenderingContext2D,
    data: number[][],
    color: string,
    opacity: number
  ) {
    if (!ctx || !data || data.length === 0) return;

    // Data is already in pixel coords, use directly
    drawScatterPlot(ctx, data, scatterPlotSettings.pointRadius, color, opacity);
  }

  // Draw helper: Mesh grid
  function drawMeshGrid(
    ctx: CanvasRenderingContext2D,
    time: number,
    gridSamples: number[][][][]
  ) {
    if (!ctx || !gridSamples || gridSamples.length === 0) return;

    const timeIndex = Math.min(
      Math.floor(time * (gridSamples.length - 1)),
      gridSamples.length - 1
    );
    const grid = gridSamples[timeIndex];
    if (!grid) return;

    // Grid data is already in pixel coords, use directly
    plotMeshGrid(ctx, grid, {
      color: "#666",
      opacity: 0.6,
      strokeWidth: 1,
    });
  }

  // Draw helper: Trajectory path using UI package drawTrajectories
  function drawPathTrajectory(
    ctx: CanvasRenderingContext2D,
    time: number,
    trajectory: number[][] | null
  ) {
    if (!ctx || !trajectory || trajectory.length === 0) return;

    const numSteps = $config.numberOfSteps || 100;
    const timeIndex = Math.floor(time * numSteps);

    // Trajectory is in DOMAIN coordinates (from model sampling), convert to pixel coords
    // Each point also needs temporal x offset based on its time step
    const xRange = width - distWidth; // Total x translation range (0 to 800)
    const pixelTrajectory = trajectory.map((p, i) => {
      const pointTime = i / (numSteps - 1 || 1);
      const xOffset = xRange * pointTime;
      return [domainToPixelX(p[0]) + xOffset, domainToPixelY(p[1])];
    });

    // Determine segment index based on streaming state
    const loadedUpTo = trajectory.length - 1;
    // During streaming: show min of current time or what's loaded (only show what's available at current time)
    // After loaded: show only up to current time (so preview can show the future trajectory)
    const segmentIndex = isStreaming
      ? Math.min(timeIndex, loadedUpTo, pixelTrajectory.length - 2)
      : Math.min(timeIndex, pixelTrajectory.length - 2);

    const style: TrajectoryStyleOptions = {
      strokeWidth: 3,
      color: "#FF6400",
      progressOpacity: 1.0,
      pointRadius: 5,
      showPreview: !isStreaming && timeIndex < trajectory.length - 1,
      previewOpacity: 0.3,
      showHeadMarker: true,
      outline: {
        color: "white",
        width: 7,
        opacity: 0.3,
      },
    };

    drawTrajectories(ctx, [pixelTrajectory], segmentIndex, style);
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  // Keyboard handler for spacebar play/pause
  function handleKeydown(event: KeyboardEvent) {
    if (event.code === "Space") {
      event.preventDefault();
      if (!$isTraining && !$isEditing && timeline) {
        if (timeline.isPlaying) {
          timeline.pause();
        } else {
          timeline.play();
        }
      }
    }
  }

  function setupKeyboardInteractions() {
    window.addEventListener("keydown", handleKeydown);
  }

  // Path handle drag handlers
  function handleDragStart(e: PointerEvent) {
    isDragging = true;
    (e.target as SVGElement).setPointerCapture(e.pointerId);

    // Clear trajectory immediately when drag starts
    if (activeRequestId && pathClient) {
      pathClient.stopRequest(activeRequestId);
      activeRequestId = null;
      isStreaming = false;
    }
    streamedTrajectory = null;
  }

  function handleDragMove(e: PointerEvent) {
    if (!isDragging) return;

    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    // Clamp to distribution area
    x = Math.max(0, Math.min(x, interfaceSettings.distributionWidth));
    y = Math.max(0, Math.min(y, interfaceSettings.distributionHeight));

    handlePosition = [x, y];
  }

  function handleDragEnd() {
    console.log("Drag end");
    isDragging = false;

    // Cancel any in-progress request
    if (activeRequestId && pathClient) {
      pathClient.stopRequest(activeRequestId);
      activeRequestId = null;
      isStreaming = false;
    }
    streamedTrajectory = null;

    // Trigger sampling at final position
    triggerSampleFromPosition(handlePosition);
  }

  // Trigger trajectory sampling from current handle position
  async function triggerSampleFromPosition(position: number[]) {
    if (!pathClient) return;

    const domainX = pixelToDomainX(position[0]);
    const domainY = pixelToDomainY(position[1]);

    isStreaming = true;
    let tempTrajectory: number[][] = [[domainX, domainY]];

    const numSteps = $config.numberOfSteps || 100;

    const { requestId, promise } = pathClient.sampleFromInitialPoints(
      [[domainX, domainY]],
      numSteps,
      {},
      (_step, x_t) => {
        tempTrajectory.push([x_t[0][0], x_t[0][1]]);
        streamedTrajectory = [...tempTrajectory];
        if (timeline) drawForeground(timeline.state);
      }
    );

    activeRequestId = requestId;

    try {
      await promise;
      streamedTrajectory = tempTrajectory;
    } catch (e) {
      console.log("Sample request cancelled or failed:", e);
    } finally {
      isStreaming = false;
      activeRequestId = null;
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onMount(async () => {
    setupTimeline();
    await state_handlers.loadDatasets();
    setupKeyboardInteractions();
    state_handlers.initializeDistributions();

    // Mark canvas as ready after mount (bindCanvas action has run)
    canvasReady = true;
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", handleKeydown);
    }
    timeline?.dispose();
    if (activeRequestId && pathClient) {
      pathClient.stopRequest(activeRequestId);
    }
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Sync timeline with isPlaying store
  $: if (timeline && $isPlaying !== undefined) {
    if ($isPlaying && !timeline.isPlaying) {
      timeline.play();
    } else if (!$isPlaying && timeline.isPlaying) {
      timeline.pause();
    }
  }

  // Dataset "brush" toggles off usePretrained
  $: if ($config.datasetName === "brush") {
    modelState.update((m) => ({ ...m, usePretrained: false }));
  } else {
    modelState.update((m) => ({ ...m, usePretrained: true }));
  }

  // Training start/stop
  $: if ($isTraining && !trainingInitiated) {
    console.log("[+page] Training started, calling startTraining");
    trainingInitiated = true;
    if ($isEditing) {
      modeState.set({ mode: "idle" });
    }
    state_handlers.startTraining();
  }
  $: if (!$isTraining && trainingInitiated) {
    console.log(
      "[+page] Training stopped via reactive block, calling stopTraining"
    );
    trainingInitiated = false;
    state_handlers.stopTraining();
  }

  // Redraw when intermediate training samples update (timeline is stopped during training)
  $: if ($trainingState.intermediateSamples && timeline) {
    drawForeground(timeline.state);
  }

  // Trigger background redraw when visibility changes
  $: if ($visibility) {
    bgNeedsRedraw = true;
    if (timeline) drawForeground(timeline.state);
  }

  // Editing start/stop
  $: if ($isEditing && !editingInitiated) {
    editingInitiated = true;
    state_handlers.enterEditMode();
  }
  // Don't exit edit mode if we're starting training (mode goes editing -> training)
  $: if (!$isEditing && editingInitiated && !$isTraining) {
    editingInitiated = false;
    state_handlers.exitEditMode();
  }

  // Dataset change
  $: if (
    $config.datasetName &&
    $datasetDict[$config.datasetName] &&
    typeof window !== "undefined"
  ) {
    state_handlers.handleDatasetChange();
  }

  // usePretrained change
  $: if (
    $modelState.usePretrained &&
    $datasetDict[$config.datasetName] &&
    typeof window !== "undefined"
  ) {
    state_handlers.handleUsePretrained();
  }
  $: if (
    !$modelState.usePretrained &&
    $datasetDict[$config.datasetName] &&
    typeof window !== "undefined"
  ) {
    modeState.set({ mode: "training" });
  }

  // Training objective change
  $: if (
    $config.trainingObjective &&
    $datasetDict[$config.datasetName] &&
    typeof window !== "undefined"
  ) {
    state_handlers.handleTrainingObjectiveChange();
  }

  // Update current distribution samples when time changes
  $: if (
    $playbackState.time !== undefined &&
    $distributionData.allTime &&
    $distributionData.allTime.length > 0
  ) {
    let timeIndex = Math.floor(
      $playbackState.time * ($distributionData.allTime.length - 1)
    );
    timeIndex = Math.min(timeIndex, $distributionData.allTime.length - 1);
    const samples = $distributionData.allTime[timeIndex];
    distributionData.update((d) => ({ ...d, current: samples }));
  }

  // Precompute source contours when source data changes
  $: if ($distributionData.source) {
    runInitialComputation({ source: $distributionData.source });
  }

  // Precompute target contours when target data changes
  $: if ($distributionData.target) {
    runInitialComputation({ target: $distributionData.target });
  }

  // Precompute contours for all time steps when samples change
  $: if ($distributionData.allTime && $distributionData.allTime.length > 0) {
    runInitialComputation({ allTime: $distributionData.allTime });
  }

  // Set default trajectory from cached samples when available (only if no trajectory yet and not dragging)
  $: if (
    $distributionData.allTime &&
    $distributionData.allTime.length > 0 &&
    !streamedTrajectory &&
    !isStreaming &&
    !isDragging
  ) {
    const cachedTrajectory = extractRandomTrajectoryFromCached(
      $distributionData.allTime
    );
    if (cachedTrajectory && cachedTrajectory.length > 0) {
      streamedTrajectory = cachedTrajectory;
      // Set handle position to starting point (convert domain to pixel)
      const startPoint = cachedTrajectory[0];
      handlePosition = [
        domainToPixelX(startPoint[0]),
        domainToPixelY(startPoint[1]),
      ];
    }
  }

  // Trigger redraw when precomputed contours or current data changes
  $: if (
    canvasReady &&
    timeline &&
    (sourceContours ||
      targetContours ||
      allTimeContours.length > 0 ||
      $distributionData.current)
  ) {
    drawForeground(timeline.state);
  }

  // Create path client when model/objective changes
  $: {
    const modelPath = pretrainedModelPaths[$config.trainingObjective]?.[
      $config.datasetName
    ]
      ? base +
        pretrainedModelPaths[$config.trainingObjective][$config.datasetName]
      : "";
    const modelConfig = trainingObjectiveToModelConfig[
      $config.trainingObjective
    ] || {
      dim: 2,
      hidden: 64,
    };

    if (modelPath && typeof window !== "undefined") {
      if ($config.trainingObjective === "Flow Matching") {
        pathClient = new FlowModelClient(
          "/workers/flow_model.worker.js",
          modelPath,
          $config.trainingObjective,
          modelConfig
        );
      } else if ($config.trainingObjective === "Diffusion") {
        pathClient = new DiffusionModelClient(
          "/workers/diffusion_model.worker.js",
          modelPath,
          modelConfig
        );
      } else {
        throw new Error(
          `Unknown training objective: ${$config.trainingObjective}`
        );
      }
      streamedTrajectory = null;
    }
  }

  // Show path handle when Path plot is active
  $: showPathHandle =
    $config.activePlotTypes.includes("Path") && !$isTraining && !$isEditing;
</script>

<div class="container">
  <TitleBar />
  <ControlBar />
  <!-- Distribution titles (invisible during training to prevent layout jitter) -->
  <div class="titles-row" class:invisible={$isTraining}>
    <h1 class="distribution-title source-title">Source Distribution</h1>
    <h1 class="distribution-title target-title">Target Distribution</h1>
  </div>
  <div class="display-area">
    <!-- Background canvas: static source/target distributions -->
    <canvas use:bgCanvas2d.bindCanvas></canvas>
    <!-- Foreground canvas: animated current distribution -->
    <canvas use:fgCanvas2d.bindCanvas></canvas>
    <!-- SVG overlay for path drag handle (positioned over source distribution at left) -->
    {#if showPathHandle}
      <svg
        class="svg-overlay source-overlay"
        viewBox="0 0 {interfaceSettings.distributionWidth} {interfaceSettings.distributionHeight}"
        on:pointermove={handleDragMove}
        on:pointerup={handleDragEnd}
        on:pointercancel={handleDragEnd}
      >
        <image
          href="{base}/icons/PointerIcon.svg"
          x={handlePosition[0] - 20}
          y={handlePosition[1] - 20}
          width="40"
          height="40"
          style="cursor: {isDragging ? 'grabbing' : 'grab'}"
          on:pointerdown={handleDragStart}
        />
      </svg>
    {/if}
    <!-- SVG overlay for distribution editing -->
    <DistributionEditWindow />
  </div>
  <div class="time-slider-wrapper">
    <TimeSlider
      timeline={timeline as any}
      disabled={$isTraining || $isEditing}
    />
  </div>
  <div class="footer"></div>
</div>
