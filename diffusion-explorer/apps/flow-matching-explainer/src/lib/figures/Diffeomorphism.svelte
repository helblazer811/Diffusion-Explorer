<!-- Diffeomorphism figure - visualizes how a flow matching model transforms space via an animated mesh grid

TODO:
1. Scale up the smiley face in the flow matching training so it is more symmetrical as a figure.
2. Cache the uniform grid trajectories/pull from the cache rather than running every time.
-->

<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import { FlowModelClient } from "@diffusion-explorer/diffusion";
  import { Player,
    Figure,
    TimeSlider,
    drawScatterPlot,
    drawText,
    plotMeshGrid,
    createSourceTargetScales,
    Timeline,
    createPauseClip,
    useCanvas2D,
    computeContours,
    plotContours,
    type ComputedContours
  } from "@diffusion-explorer/ui";
  import * as d3 from "d3";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot (passed as default children)
  export let children: Snippet | undefined = undefined;

  // Data props (passed from page)
  export let sourceDistributionSamples: [number, number][] = [];
  export let targetDistributionSamples: [number, number][] = [];

  // Mesh grid styling props
  export let meshGridColor: string = "#666666";
  export let meshGridOpacity: number = 0.8;
  export let meshGridStrokeWidth: number = 2;

  // Layout/sizing
  export let width: number = 800;
  export let height: number = 450;
  export let marginWidth: number = 50;
  export let marginHeight: number = 20;

  // Animation
  export let animationDuration: number = 6000;
  export let pauseDuration: number = 1000;
  export let playingByDefault: boolean = true;

  // Grid sampling
  export let gridResolution: number = 10;
  export let numSteps: number = settings.samplingSettings.flowMatchingGrid.numSteps;

  // Scatter plot styling
  export let scatterPointRadius: number = settings.stylingSettings.scatterPlot.radius;
  export let scatterPointOpacity: number = 0.3;
  export let scatterPointColor: string = settings.stylingSettings.scatterPlot.color;

  // Label styling
  export let labelFontSize: number = settings.stylingSettings.label.fontSize;
  export let labelFontWeight: number = settings.stylingSettings.label.fontWeight;
  export let labelColor: string = settings.stylingSettings.label.color;
  export let sourceLabelText: string = "Source Distribution";
  export let targetLabelText: string = "Target Distribution";

  // Background visibility
  export let backgroundVisible: boolean = false;

  // Contour props
  export let showContours: boolean = true;
  export let contourOpacity: number = 0.7;
  export let contourGridSize: number = 100;
  export let contourBandwidth: number = 15;
  export let contourLevels: number = 15;
  export let contourColorScale: (t: number) => string = (t: number) => d3.interpolateRgb("white", "orange")(t);
  export let contourNumSamples: number = 5000;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  type AnimationState = { time: number };
  type Scales = ReturnType<typeof createSourceTargetScales>;

  $: caption = children;

  // Canvas state - using useCanvas2D for DPR handling
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  // Scales and coordinates
  let scales: Scales | null = null;
  let sourcePixelCoords: [number, number][] = [];
  let targetPixelCoords: [number, number][] = [];

  // Grid trajectory data
  // Shape: [timesteps][gridResolution][gridResolution][2]
  let allGridStates: number[][][][] = [];
  let isLoading: boolean = true;

  // Animation state - Timeline system
  let isInitialized: boolean = false;
  let player: Player<AnimationState> | null = null;
  let displayTime: number = 0;  // Semantic time for slider display (tracks state.time)

  // Visibility-based animation control
  let figureIsActive: Writable<boolean>;
  let wasPlayingBeforeHidden: boolean = false;

  // FlowModelClient instance
  let client: FlowModelClient | null = null;
  let activeRequestId: string | null = null;

  // Contour state
  // Shape: [timesteps][numSamples][2]
  let contourTrajectories: number[][][] = [];
  // Precomputed contour data array, one per timestep
  let precomputedContours: ComputedContours[] = [];
  // Domain for contour rendering [xMin, xMax, yMin, yMax]
  let contourDataDomain: [number, number, number, number] | null = null;
  let contourActiveRequestId: string | null = null;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // Reshape flat trajectory data to grid structure
  // Input: [timesteps, gridResolution², 2]
  // Output: [timesteps][gridResolution][gridResolution][2]
  function reshapeToGrid(trajectories: number[][][], resolution: number): number[][][][] {
    return trajectories.map(timestep => {
      const grid: number[][][] = [];
      for (let i = 0; i < resolution; i++) {
        grid[i] = [] as number[][];
        for (let j = 0; j < resolution; j++) {
          const sampleIdx = i * resolution + j;
          grid[i][j] = timestep[sampleIdx];
        }
      }
      return grid;
    });
  }

  // Transform grid coordinates to pixels with horizontal interpolation
  function transformGridToPixels(grid: number[][][], t: number): number[][][] {
    if (!scales) return grid;

    const centerPixelX = scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);

    return grid.map(row => row.map(point => {
      const [dataX, dataY] = point;
      // Use source mean for x offset since grid starts in source region
      const pixelX = centerPixelX + (dataX - scales.sourceMeanX) * scales.xScaleFactor;
      const pixelY = scales.yScale(dataY);
      return [pixelX, pixelY];
    }));
  }

  // Compute domain range from source distribution
  function computeDomainRange() {
    if (sourceDistributionSamples.length === 0) {
      return settings.samplingSettings.flowMatchingGrid.gridDomainRange;
    }

    const xs = sourceDistributionSamples.map(p => p[0]);
    const ys = sourceDistributionSamples.map(p => p[1]);

    const padding = 0.1; // Add some padding
    const xMin = Math.min(...xs) - padding;
    const xMax = Math.max(...xs) + padding;
    const yMin = Math.min(...ys) - padding;
    const yMax = Math.max(...ys) + padding;

    return { xMin, xMax, yMin, yMax };
  }

  // Pre-compute scatter coordinates
  function precomputeScatterCoords() {
    if (!scales) return;

    sourcePixelCoords = sourceDistributionSamples.map((p) => [
      scales.sourceCenterPixelX + (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    targetPixelCoords = targetDistributionSamples.map((p) => [
      scales.targetCenterPixelX + (p[0] - scales.targetMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);
  }

  // Generate random initial points for contour sampling
  function generateContourInitialPoints(numSamples: number): number[][] {
    const domain = computeDomainRange();
    const points: number[][] = [];
    for (let i = 0; i < numSamples; i++) {
      const x = domain.xMin + Math.random() * (domain.xMax - domain.xMin);
      const y = domain.yMin + Math.random() * (domain.yMax - domain.yMin);
      points.push([x, y]);
    }
    return points;
  }

  // Precompute contours for each timestep
  function precomputeContoursData() {
    if (contourTrajectories.length === 0 || !scales) return;

    // Compute domain from all trajectory points
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const timestep of contourTrajectories) {
      for (const [x, y] of timestep) {
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    }
    const padding = Math.max(xMax - xMin, yMax - yMin) * 0.1;
    contourDataDomain = [xMin - padding, xMax + padding, yMin - padding, yMax + padding];

    // Precompute contours for each timestep
    precomputedContours = contourTrajectories.map(points =>
      computeContours(points, {
        gridSize: contourGridSize,
        bandwidth: contourBandwidth,
        thresholds: contourLevels,
        domain: contourDataDomain
      })
    );
  }

  // Draw precomputed contours with horizontal interpolation
  function drawPrecomputedContours(contourData: ComputedContours, t: number): void {
    if (!ctx || !scales || !contourDataDomain) return;

    // Animated center position (same interpolation as mesh grid)
    const centerPixelX = scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);

    // Create scale functions that account for the animated horizontal position
    const xScale = (dataX: number) => centerPixelX + (dataX - scales.sourceMeanX) * scales.xScaleFactor;
    const yScale = (dataY: number) => scales.yScale(dataY);

    plotContours(ctx, contourData, {
      colorScale: contourColorScale,
      fill: true,
      stroke: false,
      opacity: contourOpacity,
      xScale,
      yScale
    });
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  // Sample grid trajectories from model
  async function sampleGridTrajectories() {
    if (!client) return;

    const gridDomainRange = computeDomainRange();

    try {
      const result = client.sampleGrid(
        gridResolution,
        gridDomainRange,
        numSteps
      );

      activeRequestId = result.requestId;
      const trajectories = await result.promise;
      activeRequestId = null;
      // trajectories shape: [timesteps, gridResolution², 2]
      allGridStates = reshapeToGrid(trajectories, gridResolution);
      isLoading = false;
    } catch (error) {
      activeRequestId = null;
      console.error("Error sampling grid trajectories:", error);
      isLoading = false;
    }
  }

  // Sample trajectories for contour visualization
  async function sampleContourTrajectories() {
    if (!client) return;

    const initialPoints = generateContourInitialPoints(contourNumSamples);

    try {
      const result = client.sampleFromInitialPoints(
        initialPoints,
        numSteps
      );

      contourActiveRequestId = result.requestId;
      contourTrajectories = await result.promise;
      contourActiveRequestId = null;

      // Precompute contours after trajectories are loaded
      precomputeContoursData();
    } catch (error) {
      contourActiveRequestId = null;
      console.error("Error sampling contour trajectories:", error);
    }
  }

  function initializeVisualization() {
    if (!canvas) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    // Create scales for horizontal layout
    scales = createSourceTargetScales(sourceDistributionSamples, targetDistributionSamples, {
      width,
      height,
      marginWidth,
      marginHeight,
      sourceCenterX: settings.stylingSettings.layout.sourceCenterX,
      targetCenterX: settings.stylingSettings.layout.targetCenterX,
      yShiftFactor: settings.stylingSettings.scatterPlot.yShiftFactor,
    });

    // Pre-compute scatter coordinates
    precomputeScatterCoords();

    // Create model client and start sampling
    client = new FlowModelClient(
      settings.samplingWorkerUrl,
      settings.flowMatchingModelPath,
      "Flow Matching",
      settings.trainingSettings.modelConfig
    );

    sampleGridTrajectories();
    if (showContours) {
      sampleContourTrajectories();
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Forward clip (0→1)
  const forwardClip = {
    name: "Forward",
    reduce(t: number): AnimationState {
      return { time: t };
    }
  };

  // Backward clip (1→0)
  const backwardClip = {
    name: "Backward",
    reduce(t: number): AnimationState {
      return { time: 1 - t };
    }
  };

  function setupTimeline() {
    const tl = Timeline.from<AnimationState>({
      duration: totalCycleDuration / 1000,
      initialState: { time: 0 },
      clips: [
        { clip: forwardClip, ...{ start: 0, end: t1 } },
        { clip: createPauseClip(), ...{ start: t1, end: t2 } },
        { clip: backwardClip, ...{ start: t2, end: t3 } },
        { clip: createPauseClip(), ...{ start: t3, end: 1 } },
      ],
    });
    player = new Player(tl, { looping: true });

    // Total cycle: forward + pause + backward + pause
    const totalCycleDuration = 2 * animationDuration + 2 * pauseDuration;
    const forwardDuration = animationDuration / totalCycleDuration;
    const pauseNormalized = pauseDuration / totalCycleDuration;

    // Add clips in sequence with proper timing objects
    const t1 = forwardDuration;
    const t2 = forwardDuration + pauseNormalized;
    const t3 = 2 * forwardDuration + pauseNormalized;




    // Set duration in seconds


    // Register tick callback
    player.onTick((_t: number, state: AnimationState) => {
      displayTime = state.time;  // Track semantic time for slider
      draw(state);
    });
  }

  // Handle seeking by display time - map to forward clip's timeline range
  function handleSeekByDisplayTime(t: number): void {
    if (!player) return;
    const totalCycleDuration = 2 * animationDuration + 2 * pauseDuration;
    const forwardEnd = animationDuration / totalCycleDuration;
    player.seek(t * forwardEnd);
  }

  function startAnimation() {
    if (player) player.play();
  }

  function stopAnimation() {
    if (player) player.pause();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState): void {
    if (!ctx || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    const time = state.time;

    // --- Static Background ---
    // Draw text labels
    const textY = marginHeight / 2;
    drawText(ctx, sourceLabelText, scales.sourceCenterPixelX, textY, {
      font: `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`,
      color: labelColor,
      align: "center",
      baseline: "top",
    });
    drawText(ctx, targetLabelText, scales.targetCenterPixelX, textY, {
      font: `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`,
      color: labelColor,
      align: "center",
      baseline: "top",
    });

    // Draw scatter plots
    drawScatterPlot(ctx, sourcePixelCoords, scatterPointRadius, scatterPointColor, scatterPointOpacity);
    drawScatterPlot(ctx, targetPixelCoords, scatterPointRadius, scatterPointColor, scatterPointOpacity);

    // --- Dynamic Foreground ---

    // Draw contours (behind mesh grid)
    if (showContours && precomputedContours.length > 0 && contourDataDomain) {
      const contourTimestepIndex = Math.min(
        Math.floor(time * (precomputedContours.length - 1)),
        precomputedContours.length - 1
      );
      drawPrecomputedContours(precomputedContours[contourTimestepIndex], time);
    }

    // Draw mesh grid if data is ready
    if (allGridStates.length > 0) {
      // Get current grid state based on animation time
      const timestepIndex = Math.min(
        Math.floor(time * (allGridStates.length - 1)),
        allGridStates.length - 1
      );
      const currentGrid = allGridStates[timestepIndex];

      // Transform to pixel coordinates with horizontal interpolation
      const pixelGrid = transformGridToPixels(currentGrid, time);

      // Draw mesh grid
      plotMeshGrid(ctx, pixelGrid, {
        color: meshGridColor,
        opacity: meshGridOpacity,
        strokeWidth: meshGridStrokeWidth
      });
    } else if (isLoading) {
      // Show loading indicator
      drawText(ctx, "Loading model...", width / 2, height / 2, {
        font: "16px Helvetica, Arial, sans-serif",
        color: "#999",
        align: "center",
        baseline: "middle",
      });
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function handleVisibilityChange(isActive: boolean): void {
    if (!player) return;
    if (!isActive && player.isPlaying) {
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

  onDestroy(() => {
    if (player) player.pause();

    // Cancel any pending worker request to prevent orphaned promises
    if (activeRequestId && client) {
      client.stopRequest(activeRequestId);
    }

    // Cancel contour request
    if (contourActiveRequestId && client) {
      client.stopRequest(contourActiveRequestId);
    }
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Reactive initialization
  $: if (
    !isInitialized &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    canvas
  ) {
    initializeVisualization();
    setupTimeline();
    isInitialized = true;
    draw(player!.timeline.initialState);
    if (playingByDefault) startAnimation();
  }

  // Pause animation when figure goes off-screen
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  // Redraw when grid data becomes available
  $: if (isInitialized && allGridStates.length > 0 && player) {
    draw(player.state);
  }

  // Redraw when contour data becomes available
  $: if (isInitialized && precomputedContours.length > 0 && player) {
    draw(player.state);
  }
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <div style="width: 100%; max-width: {width}px;">
        <canvas
          bind:this={canvas}
          use:canvas2d.bindCanvas
          style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
        ></canvas>
      </div>
      <TimeSlider timeline={player} {displayTime} onSeekByDisplayTime={handleSeekByDisplayTime} color="orange" />
    </div>
  {/snippet}
</Figure>
