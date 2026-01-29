<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    Figure,
    Timeline,
    useVisibilityHandler,
    useCanvas2D,
    useCanvasWebGPU,
    ContourRenderer,
    createLinearColorScale,
    createSourceTargetScales,
    drawScatterPlot,
    drawMathjax,
  } from "@diffusion-explorer/ui";
  import type { ColorScaleFn, ContourDomain } from "@diffusion-explorer/ui";
  import { clipTrajectoriesToStartingRadius, loadCachedTrajectories, FlowModelClient, cancelAllPendingRequests } from "@diffusion-explorer/diffusion";
  import { base } from "$app/paths";
  import { settings } from "$lib/settings";
  import { PulsingPathlineAnimation, type PulsingPathlineAnimationState } from "@diffusion-explorer/ui";
  import { Katex } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot (passed as default children)
  export let children = undefined;

  export let width = 800;
  export let height = 350;

  // Layout props (matching ProbabilityPathIntro)
  export let sourceCenterX = 0.15; // Spread distributions wider
  export let targetCenterX = 0.85;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let distributionScaleFactor = 0.8;
  export let yShiftFactor = 0;

  // Contour settings
  export let contourGridSize = 80;
  export let contourBandwidth = 4;
  export let contourThresholds: number | number[] = 5;
  export let contourOpacity = 1.0;

  // Animation
  export let animationDuration = 3; // Seconds for one full pulse cycle
  export let timeRange: [number, number] = [0, 1.0]; // Full range for trajectory computation
  export let pulsingTimeRange: [number, number] = [0, 1.0]; // Full trajectories from t=0 to t=1

  // Sample time - which timestep to use for filtering trajectories through the box
  const SAMPLE_TIME = 0.5;
  // Display position - where to render the contour in the layout (0.5 = centered between source and target)
  const DISPLAY_POSITION = 0.5;
  // Contour time - which timestep's samples to use for the contour (0.9 for smiley face appearance)
  const CONTOUR_TIME = 0.9;

  // Pulsing region settings
  export let clickRadius = 0.35; // Domain units (half-width of sampling region)
  export let numTrajectories = 3; // Number of random sample points
  export let gridPaddingFraction = 0.15; // Padding inside region as fraction of clickRadius
  export let pulseWidthPixels = 40;
  export let pulsePauseWidthPixels = 60;
  export let pulseColor = "#f17720"; // Orange (matching ProbabilityPathIntro)

  // Region box settings
  export let showRegionBox = true;
  export let regionBoxColor = "#f17720"; // Orange
  export let regionBoxLineWidth = 3; // Thicker stroke
  export let regionBoxPadding = 5; // Padding around the click radius in pixels
  export let disableDrag = true; // Disable box dragging

  // Source distribution scatter plot settings
  export let sourceScatterColor = settings.stylingSettings.scatterPlot.color;
  export let sourceScatterOpacity = settings.stylingSettings.scatterPlot.opacity;

  // Target distribution scatter plot settings
  export let scatterRadius = settings.stylingSettings.scatterPlot.radius;
  export let scatterColor = settings.stylingSettings.scatterPlot.color;
  export let scatterOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let numScatterSamples = 100;

  // LaTeX label settings
  export let latexFontSize = settings.stylingSettings.figureLatex.fontSize;
  export let latexLabelOffsetY = 20;
  export let latexColor = settings.stylingSettings.figureLatex.color;

  // Text label settings
  export let labelFontSize = 28;
  export let labelColor = "#666666"; // Same gray as figure captions
  export let labelLineSpacing = 36;

  // ----------------------------------------------------------------
  // Data URLs and Model Configuration
  // ----------------------------------------------------------------

  const trajectoriesUrl = "/flow_invertibility/cached_samples/flow_matching_trajectories.json";

  // FlowModel configuration for runtime sampling
  const MODEL_CONFIG = { dim: 2, hidden: 64 };
  const MODEL_PATH = "/crown_jewel/models/flow_model.json";
  const WORKER_URL = "/crown_jewel/workers/flow_model.worker.js";

  // Hard-coded sample points in domain space (starting points at t=0.5)
  const HARDCODED_POINTS: [number, number][] = [
    [0.0, 0.1],   // Center-ish
    [-0.15, 0.0], // Left
    [0.15, 0.2],  // Right-bottom
  ];

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Data (loaded from files)
  let allTimeSamples: number[][][] = []; // [timestep][sample][x,y]
  let targetPoints: number[][] = []; // [[x,y], ...]

  // Source samples (from t=0)
  let sourcePoints: number[][] = [];

  // FlowModelClient for runtime sampling
  let flowModelClient: FlowModelClient | null = null;
  let isLoadingModel = true;

  // Sampled trajectories from hard-coded points (computed at runtime)
  let sampledTrajectories: number[][][] = [];  // [sample][step][x,y]
  let sampledTimeValues: number[] = [];

  // Background canvas (GPU contours for flow)
  let contourCanvasElement: HTMLCanvasElement | null = null;
  const contourCanvas = useCanvasWebGPU(width, height);

  // Scatter distribution canvas (source + target scatter plots)
  let scatterCanvasElement: HTMLCanvasElement | null = null;
  const scatterCanvas = useCanvas2D(width, height);

  // Foreground canvas (pulses + click dot + labels)
  let fgCanvasElement: HTMLCanvasElement | null = null;
  const fgCanvas2d = useCanvas2D(width, height);

  // Pulsing canvas (WebGPU for GPU-accelerated pulse animation)
  let pulsingCanvasElement: HTMLCanvasElement | null = null;

  // Caption derived from children
  $: caption = children;

  let timeline: Timeline<AnimationState> | null = null;
  let figureIsActive: Writable<boolean> | undefined;
  let setupComplete = false;
  let unsubscribeVisibility: (() => void) | null = null;

  // Scales for dual-panel layout
  type ScalesType = ReturnType<typeof createSourceTargetScales>;
  let scales: ScalesType | null = null;

  // Pre-computed scatter plot pixel coords
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];

  // Contour renderer
  let contourRenderer: ContourRenderer | null = null;
  let numFrames = 0;

  // Display time (fixed at SAMPLE_TIME)
  let displayTime = SAMPLE_TIME;

  // Clicked region center point (domain coordinates)
  let regionCenterDomain: [number, number] | null = null;

  // Sample points within the region (domain coordinates)
  let regionSamplePoints: number[][] = [];

  // Drag state
  let isDragging = false;
  let isHoveringBox = false;
  let dragStartPos: { x: number; y: number } | null = null;
  let regionCenterAtDragStart: [number, number] | null = null;


  // Animation state
  type AnimationState = PulsingPathlineAnimationState & {
    contourFrameIndex: number;
    pulsePhase: number;
  };

  // Pulsing animation (GPU-accelerated)
  let pulsingAnimation: PulsingPathlineAnimation<AnimationState> | null = null;

  // Orange color scale for flow contours
  const orangeColorScale: ColorScaleFn = createLinearColorScale(
    [1.0, 0.6, 0.0, 0.05], // outer: transparent orange
    [1.0, 0.35, 0.0, 0.7]  // inner: opaque dark orange
  );

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Convert domain coordinates to pixel coordinates at a given time t.
   * At t=0, point is at source center; at t=1, at target center.
   */
  function domainToPixelAtTime(x: number, y: number, t: number): [number, number] {
    if (!scales) return [0, 0];

    // Interpolate the center position based on time
    const centerPixelX = scales.sourceCenterPixelX + t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);

    // Interpolate the mean position (for proper centering)
    const meanX = scales.sourceMeanX + t * (scales.targetMeanX - scales.sourceMeanX);

    const pixelX = centerPixelX + (x - meanX) * scales.xScaleFactor;
    const pixelY = scales.yScale(y);

    return [pixelX, pixelY];
  }

  /**
   * Convert pixel coordinates back to domain coordinates at a given time t.
   */
  function pixelToDomainAtTime(pixelX: number, pixelY: number, t: number): [number, number] {
    if (!scales) return [0, 0];

    const centerPixelX = scales.sourceCenterPixelX + t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    const meanX = scales.sourceMeanX + t * (scales.targetMeanX - scales.sourceMeanX);

    const domainX = (pixelX - centerPixelX) / scales.xScaleFactor + meanX;
    const domainY = scales.yScale.invert(pixelY);

    return [domainX, domainY];
  }

  /**
   * Sample trajectories from hard-coded points using FlowModelClient.
   * Performs reverse sampling (t=0.5→0) and forward sampling (t=0.5→1),
   * then combines them into full trajectories.
   */
  async function sampleTrajectoriesFromHardcodedPoints(): Promise<void> {
    if (!flowModelClient) return;

    const NUM_STEPS = 50;  // Steps for each half (reverse and forward)

    try {
      // Reverse sampling: t=0.5 → t=0
      const { promise: reversePromise } = flowModelClient.sampleFromInitialPoints(
        HARDCODED_POINTS,
        NUM_STEPS,
        { reverse: true, t_start: 0.5, t_end: 0, scheduler: 'euler_midpoint' }
      );
      const reverseTrajectories = await reversePromise; // [step][sample][x,y]

      // Forward sampling: t=0.5 → t=1
      const { promise: forwardPromise } = flowModelClient.sampleFromInitialPoints(
        HARDCODED_POINTS,
        NUM_STEPS,
        { t_start: 0.5, t_end: 1, scheduler: 'euler_midpoint' }
      );
      const forwardTrajectories = await forwardPromise; // [step][sample][x,y]

      // Reverse the reverse trajectories to go t=0 → t=0.5
      const reversedReverse = reverseTrajectories.slice().reverse();

      // Combine: [t=0 → t=0.5] + [t=0.5 → t=1] (skip first step of forward to avoid duplicate)
      const fullTrajectories = [...reversedReverse, ...forwardTrajectories.slice(1)];

      // Transpose from [step][sample][x,y] to [sample][step][x,y]
      const numSteps = fullTrajectories.length;
      const numSamples = HARDCODED_POINTS.length;
      sampledTrajectories = [];

      for (let sample = 0; sample < numSamples; sample++) {
        const traj: number[][] = [];
        for (let step = 0; step < numSteps; step++) {
          traj.push(fullTrajectories[step][sample]);
        }
        sampledTrajectories.push(traj);
      }

      // Create time values array
      const totalSteps = numSteps;
      sampledTimeValues = Array.from({ length: totalSteps }, (_, i) => i / (totalSteps - 1));

      console.log(`Sampled ${sampledTrajectories.length} trajectories with ${numSteps} steps each`);
    } catch (e) {
      console.error("Failed to sample trajectories:", e);
    }
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  async function runInitialComputation() {
    if (allTimeSamples.length === 0 || targetPoints.length === 0) return;

    numFrames = allTimeSamples.length;

    // Create dual-panel scales
    scales = createSourceTargetScales(
      sourcePoints as [number, number][],
      targetPoints as [number, number][],
      { width, height, marginWidth, marginHeight, sourceCenterX, targetCenterX, yShiftFactor, distributionScaleFactor }
    );

    // Randomly subsample and pre-compute pixel coordinates for source (left panel)
    const sampledSourcePoints = sourcePoints.length <= numScatterSamples
      ? sourcePoints
      : sourcePoints
          .map((pt) => ({ pt, sort: Math.random() }))
          .sort((a, b) => a.sort - b.sort)
          .slice(0, numScatterSamples)
          .map(({ pt }) => pt);

    sourcePixelCoords = sampledSourcePoints.map(([x, y]) => [
      scales!.sourceCenterPixelX + (x - scales!.sourceMeanX) * scales!.xScaleFactor,
      scales!.yScale(y)
    ]);

    // Randomly subsample and pre-compute pixel coordinates for target (right panel)
    const sampledTargetPoints = targetPoints.length <= numScatterSamples
      ? targetPoints
      : targetPoints
          .map((pt) => ({ pt, sort: Math.random() }))
          .sort((a, b) => a.sort - b.sort)
          .slice(0, numScatterSamples)
          .map(({ pt }) => pt);

    targetPixelCoords = sampledTargetPoints.map(([x, y]) => [
      scales!.targetCenterPixelX + (x - scales!.targetMeanX) * scales!.xScaleFactor,
      scales!.yScale(y)
    ]);

    // Create contour renderer for flow animation
    if (contourCanvasElement) {
      // Compute domain from all samples
      let xMin = Infinity, xMax = -Infinity;
      let yMin = Infinity, yMax = -Infinity;
      for (const samples of allTimeSamples) {
        for (const [x, y] of samples) {
          if (x < xMin) xMin = x;
          if (x > xMax) xMax = x;
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
        }
      }
      const padding = 0.1;
      const xPad = (xMax - xMin) * padding;
      const yPad = (yMax - yMin) * padding;
      const contourDomain: ContourDomain = {
        xMin: xMin - xPad,
        xMax: xMax + xPad,
        yMin: yMin - yPad,
        yMax: yMax + yPad,
      };

      contourRenderer = await ContourRenderer.create({
        canvas: contourCanvasElement,
        gridSize: contourGridSize,
        bandwidth: contourBandwidth,
        thresholds: contourThresholds,
        opacity: contourOpacity,
        colorScale: orangeColorScale,
        preferGPU: true,
      });

      // Load all frames with time-based positioning
      for (let t = 0; t < numFrames; t++) {
        const normalizedT = t / (numFrames - 1);

        // Transform points to pixel space - always display at center position
        // Flip y for GPU contour renderer (GPU uses bottom-left origin)
        const pixelPoints = allTimeSamples[t].map(([x, y]) => {
          const [px, py] = domainToPixelAtTime(x, y, DISPLAY_POSITION);
          return [px, height - py];
        });

        // Create a pixel-space domain for the contour renderer
        const pixelDomain: ContourDomain = {
          xMin: 0,
          xMax: width,
          yMin: 0,
          yMax: height,
        };

        contourRenderer.setPointsForFrame(t, pixelPoints, pixelDomain);
      }
      await contourRenderer.computeAllFrames();
      console.log(`ContourRenderer: ${numFrames} frames computed (backend: ${contourRenderer.backend})`);
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();

    // Fixed frame at CONTOUR_TIME (0.9 for smiley face appearance)
    const fixedFrameIndex = Math.round(CONTOUR_TIME * (numFrames - 1));

    timeline.initialState = {
      pulsingPathlinePhase: 0,
      pulsePhase: 0,
      contourFrameIndex: fixedFrameIndex, // Fixed, no animation
    };
    timeline.looping = true;
    timeline.duration = animationDuration;

    // Pulse phase animation (2 loops per timeline cycle)
    // Update both pulsePhase (legacy) and pulsingPathlinePhase (GPU animation)
    timeline.add(
      {
        name: "PulsePhase",
        reduce: (t: number) => ({
          pulsePhase: (t * 2) % 1,
          pulsingPathlinePhase: (t * 2) % 1,
        }),
      },
      { start: 0, end: 1 }
    );

    timeline.onTick((t, state) => {
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!scales) return;

    // 1. Draw flow contour frame on WebGPU canvas
    if (contourRenderer && numFrames > 0) {
      const frameIdx = Math.max(0, Math.min(state.contourFrameIndex, numFrames - 1));
      contourRenderer.drawFrame(frameIdx);
    }

    // 2. Draw source + target scatter on scatter canvas
    const scatterCtx = scatterCanvas.ctx;
    if (scatterCtx) {
      scatterCtx.clearRect(0, 0, width, height);
      // Source (left)
      drawScatterPlot(scatterCtx, sourcePixelCoords, scatterRadius, sourceScatterColor, sourceScatterOpacity);
      // Target (right)
      drawScatterPlot(scatterCtx, targetPixelCoords, scatterRadius, scatterColor, scatterOpacity);
    }

    // 3. Draw dynamic foreground on Canvas2D
    const ctx = fgCanvas2d.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    // Draw LaTeX labels (p_0, p_1) at the bottom of their distributions
    const yDomain = scales.yScale.domain();
    const yBottom = yDomain[1];
    const textLabelY = scales.yScale(yBottom) + 15; // Below the distribution

    // Source distribution label (p_0) - using MathJax
    drawMathjax(
      ctx,
      "p_0",
      scales.sourceCenterPixelX,
      textLabelY,
      latexFontSize,
      0, 0,
      { color: labelColor },
      () => timeline?.tick(timeline.time)
    );

    // Target distribution label (p_1) - using MathJax
    drawMathjax(
      ctx,
      "p_1",
      scales.targetCenterPixelX,
      textLabelY,
      latexFontSize,
      0, 0,
      { color: labelColor },
      () => timeline?.tick(timeline.time)
    );

    // Center distribution label (p_t) - using MathJax
    const centerPixelX = (scales.sourceCenterPixelX + scales.targetCenterPixelX) / 2;
    drawMathjax(
      ctx,
      "p_t",
      centerPixelX,
      textLabelY,
      latexFontSize,
      0, 0,
      { color: labelColor },
      () => timeline?.tick(timeline.time)
    );

    // Draw dashed region box around clicked area
    if (showRegionBox && regionCenterDomain) {
      const [cx, cy] = regionCenterDomain;
      const centerPixel = domainToPixelAtTime(cx, cy, DISPLAY_POSITION);

      // Convert clickRadius from domain to pixel space (approximate)
      const radiusPixels = clickRadius * scales.xScaleFactor + regionBoxPadding;

      ctx.save();
      ctx.strokeStyle = regionBoxColor;
      ctx.lineWidth = regionBoxLineWidth;
      ctx.setLineDash([4, 4]); // Dashed line pattern

      ctx.strokeRect(
        centerPixel[0] - radiusPixels,
        centerPixel[1] - radiusPixels,
        radiusPixels * 2,
        radiusPixels * 2
      );

      ctx.restore();

      // Draw "S" label above the box
      drawMathjax(
        ctx,
        "S",
        centerPixel[0],
        centerPixel[1] - radiusPixels - 15,
        latexFontSize,
        0, 0,
        { color: regionBoxColor },
        () => timeline?.tick(timeline.time)
      );
    }

    // Draw pulsing trajectories (GPU - on separate canvas)
    if (pulsingAnimation) {
      pulsingAnimation.draw(state, [0, 0, 0, 0]); // Clear with transparent
    }

    // Draw dots at sample points within the region
    if (regionSamplePoints.length > 0) {
      ctx.fillStyle = pulseColor;
      ctx.globalAlpha = 0.9;
      const dotRadius = 2.5;

      for (const [sx, sy] of regionSamplePoints) {
        const [px, py] = domainToPixelAtTime(sx, sy, DISPLAY_POSITION);
        ctx.beginPath();
        ctx.arc(px, py, dotRadius, 0, 2 * Math.PI);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);


  /**
   * Check if a pixel coordinate is inside the region box.
   */
  function isPointInBox(pixelX: number, pixelY: number): boolean {
    if (!regionCenterDomain || !scales) return false;
    const [cx, cy] = regionCenterDomain;
    const centerPixel = domainToPixelAtTime(cx, cy, DISPLAY_POSITION);
    const radiusPixels = clickRadius * scales.xScaleFactor + regionBoxPadding;

    return (
      pixelX >= centerPixel[0] - radiusPixels &&
      pixelX <= centerPixel[0] + radiusPixels &&
      pixelY >= centerPixel[1] - radiusPixels &&
      pixelY <= centerPixel[1] + radiusPixels
    );
  }

  function handleMouseDown(event: MouseEvent) {
    if (!fgCanvasElement || disableDrag) return;
    const rect = fgCanvasElement.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const mouseX = (event.clientX - rect.left) * scaleX;
    const mouseY = (event.clientY - rect.top) * scaleY;

    if (isPointInBox(mouseX, mouseY)) {
      isDragging = true;
      dragStartPos = { x: mouseX, y: mouseY };
      regionCenterAtDragStart = regionCenterDomain ? [...regionCenterDomain] : null;

      // Clear current trajectories while dragging
      pulsingAnimation = null;
      regionSamplePoints = [];
    }
  }

  function handleMouseMove(event: MouseEvent) {
    if (!fgCanvasElement) return;

    // Don't update hover state when dragging is disabled
    if (disableDrag) {
      isHoveringBox = false;
      return;
    }

    const rect = fgCanvasElement.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const mouseX = (event.clientX - rect.left) * scaleX;
    const mouseY = (event.clientY - rect.top) * scaleY;

    // Update hover state
    isHoveringBox = isPointInBox(mouseX, mouseY);

    // Handle dragging
    if (isDragging && dragStartPos && regionCenterAtDragStart && scales) {
      const deltaX = mouseX - dragStartPos.x;
      const deltaY = mouseY - dragStartPos.y;

      // Convert pixel delta to domain delta
      const domainDeltaX = deltaX / scales.xScaleFactor;
      // Y scale: pixel Y increases downward, but yScale maps domain to pixel correctly
      // We need to use the same scale factor as X (assuming uniform scaling)
      const domainDeltaY = deltaY / scales.xScaleFactor;

      // Update region center
      regionCenterDomain = [
        regionCenterAtDragStart[0] + domainDeltaX,
        regionCenterAtDragStart[1] + domainDeltaY
      ];

      // Redraw to show updated box position
      if (timeline) {
        draw(timeline.state);
      }
    }
  }

  function handleMouseUp() {
    if (isDragging && regionCenterDomain) {
      isDragging = false;
      dragStartPos = null;
      regionCenterAtDragStart = null;

      // Trajectories are fixed from hard-coded points, just redraw
      if (timeline) {
        draw(timeline.state);
      }
    }
  }

  function handleMouseLeave() {
    isHoveringBox = false;
    if (isDragging) {
      isDragging = false;
      dragStartPos = null;
      regionCenterAtDragStart = null;
    }
  }


  /**
   * Update trajectories for the region using sampled trajectories from hard-coded points.
   * Creates a PulsingPathlineAnimation (GPU) from the runtime-sampled trajectories.
   */
  async function updateTrajectoriesForRegion() {
    if (!scales || sampledTrajectories.length === 0 || !pulsingCanvasElement) return;

    // Compute the region center from hard-coded points
    const meanX = HARDCODED_POINTS.reduce((sum, p) => sum + p[0], 0) / HARDCODED_POINTS.length;
    const meanY = HARDCODED_POINTS.reduce((sum, p) => sum + p[1], 0) / HARDCODED_POINTS.length;
    regionCenterDomain = [meanX, meanY];

    // Use the hard-coded points as the sample points for drawing dots in the box
    regionSamplePoints = HARDCODED_POINTS.map(p => [p[0], p[1]]);

    // Convert full trajectories to pixel coordinates (t=0 to t=1)
    const pixelTrajectories = sampledTrajectories.map(traj =>
      traj.map((pt, idx) => {
        const t = sampledTimeValues[idx] ?? 0;
        return domainToPixelAtTime(pt[0], pt[1], t);
      })
    );

    console.log(`Using ${sampledTrajectories.length} sampled trajectories with ${sampledTrajectories[0]?.length || 0} steps`);

    // Destroy existing animation if any
    if (pulsingAnimation) {
      pulsingAnimation.destroy();
    }

    // Create GPU-accelerated PulsingPathlineAnimation
    pulsingAnimation = PulsingPathlineAnimation.create<AnimationState>({
      paths: pixelTrajectories,
      pulseWidth: pulseWidthPixels,
      pulseGap: pulsePauseWidthPixels,
      baseOpacity: 0.8,
      color: pulseColor,
      thickness: 2.5,
      loopMultiplier: 1, // Timeline already does 2x
    });

    // Initialize with WebGPU canvas
    await pulsingAnimation.init(pulsingCanvasElement);
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  async function trySetup() {
    if (setupComplete) return;

    const fgCtx = fgCanvas2d.ctx;
    if (!fgCtx || !contourCanvasElement || !scatterCanvasElement || !pulsingCanvasElement || allTimeSamples.length === 0 || targetPoints.length === 0) return;
    if (sampledTrajectories.length === 0) return; // Wait for sampling to complete

    setupComplete = true;

    await runInitialComputation();
    setupTimeline();

    if (timeline) {
      draw(timeline.initialState);
      timeline.play();

      // Use sampled trajectories from hard-coded points (GPU animation)
      console.log("Setting up trajectories from hard-coded points");
      await updateTrajectoriesForRegion();
    }
  }

  onMount(async () => {
    if (contourCanvasElement) {
      contourCanvas.init(contourCanvasElement);
      contourCanvas.resize(width, height);
    }
    if (scatterCanvasElement) {
      scatterCanvas.init(scatterCanvasElement);
      scatterCanvas.resize(width, height);
    }
    if (fgCanvasElement) {
      fgCanvas2d.init(fgCanvasElement);
      fgCanvas2d.resize(width, height);
    }
    if (pulsingCanvasElement) {
      // Set canvas dimensions for WebGPU
      const dpr = window.devicePixelRatio || 1;
      pulsingCanvasElement.width = width * dpr;
      pulsingCanvasElement.height = height * dpr;
    }

    // Load trajectory data for contour animation (from flow_invertibility)
    try {
      const result = await loadCachedTrajectories(`${base}${trajectoriesUrl}`);
      if (result) {
        // Clip trajectories to samples starting within radius (same as ProbabilityPathIntro)
        const clippingRadius = settings.stylingSettings.scatterPlot.clippingRadius;
        const clippedTrajectories = clipTrajectoriesToStartingRadius(result.trajectories, clippingRadius);
        allTimeSamples = clippedTrajectories;
        // Extract source (t=0) and target (t=1) from clipped trajectories
        sourcePoints = clippedTrajectories[0] || [];
        targetPoints = clippedTrajectories[clippedTrajectories.length - 1] || [];
      }
    } catch (e) {
      console.warn("Failed to load CrownJewel data:", e);
    }

    // Initialize FlowModelClient and sample trajectories from hard-coded points
    try {
      isLoadingModel = true;
      flowModelClient = new FlowModelClient(
        `${base}${WORKER_URL}`,
        `${base}${MODEL_PATH}`,
        'Flow Matching',
        MODEL_CONFIG
      );

      await sampleTrajectoriesFromHardcodedPoints();
      isLoadingModel = false;
      console.log("FlowModelClient initialized and trajectories sampled");
    } catch (e) {
      console.warn("Failed to initialize FlowModelClient:", e);
      isLoadingModel = false;
    }

    trySetup();
  });

  onDestroy(() => {
    timeline?.dispose();
    unsubscribeVisibility?.();
    contourRenderer?.destroy();
    pulsingAnimation?.destroy();
    cancelAllPendingRequests();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (allTimeSamples.length > 0 && targetPoints.length > 0 && sampledTrajectories.length > 0 && !setupComplete) {
    trySetup();
  }

  $: if (figureIsActive && !unsubscribeVisibility) {
    unsubscribeVisibility = figureIsActive.subscribe((active: boolean) => {
      handleVisibilityChange(active);
    });
  }
</script>

<div class="crown-jewel-equation">
  <Katex math={"\\frac{d}{dt} \\int_V p_t(x) \\, dx = - \\oint_S v_t p_t \\cdot dS"} displayMode={true} />
</div>

<Figure {caption} bind:isActive={figureIsActive} backgroundVisible={false}>
  <div class="crown-jewel-wrapper">
    <div class="canvas-stack" style="width: {width}px; height: {height}px;">
      <!-- Scatter plots layer (bottom) -->
      <canvas class="scatter-canvas" bind:this={scatterCanvasElement} style="pointer-events: none;"></canvas>
      <!-- Flow contours layer -->
      <canvas class="contour-canvas" bind:this={contourCanvasElement} style="pointer-events: none;"></canvas>
      <!-- Pulsing trajectories layer (WebGPU) -->
      <canvas class="pulsing-canvas" bind:this={pulsingCanvasElement} style="pointer-events: none;"></canvas>
      <!-- Foreground: labels + dots (top layer, handles drag events) -->
      <canvas
        class="fg-canvas"
        bind:this={fgCanvasElement}
        on:mousedown={handleMouseDown}
        on:mousemove={handleMouseMove}
        on:mouseup={handleMouseUp}
        on:mouseleave={handleMouseLeave}
        style="cursor: {disableDrag ? 'default' : isDragging ? 'grabbing' : isHoveringBox ? 'grab' : 'default'};"
      ></canvas>
    </div>
  </div>
</Figure>

<style>
  .crown-jewel-equation {
    text-align: center;
    margin-bottom: 1rem;
    font-size: 1.4rem;
    color: #374151;
  }

  .crown-jewel-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  .canvas-stack {
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    background: transparent;
    margin: 0 auto;
  }

  .canvas-stack canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .scatter-canvas {
    background: transparent;
    z-index: 1;
  }

  .contour-canvas {
    background: transparent;
    z-index: 2;
  }

  .pulsing-canvas {
    background: transparent;
    z-index: 3;
  }

  .fg-canvas {
    background: transparent;
    z-index: 4;
  }
</style>
