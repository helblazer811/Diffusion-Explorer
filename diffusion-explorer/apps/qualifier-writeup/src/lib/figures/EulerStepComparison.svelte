<!-- Compares Euler sampler trajectories between Flow Matching and Rectified Flow with varying step counts -->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import {
    DoubleFigure,
    drawScatterPlot,
    drawTrajectories,
    Slider,
    FigureLegend,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";
  import type { FlowModelClient } from "@diffusion-explorer/diffusion";
  import type { Snippet } from "svelte";

  // ===== PROPS =====

  // FlowModelClient instances (passed from parent, created with correct base path)
  export let flowMatchingClient: FlowModelClient | null = null;
  export let rectifiedFlowClient: FlowModelClient | null = null;

  // Data
  export let targetDistribution: number[][] = [];

  // Layout
  export let canvasWidth: number = 400;
  export let canvasHeight: number = 400;
  export let marginWidth: number = 10;
  export let marginHeight: number = 10;
  export let gap: number = 20;
  export let domainRange: { xMin: number; xMax: number; yMin: number; yMax: number } = { xMin: -1.7, xMax: 1.7, yMin: -1.5, yMax: 1.7 };

  // Labels
  export let leftLabel: string = "Flow Matching";
  export let rightLabel: string = "Rectified Flow";
  export let labelFontSize: number = settings.stylingSettings.label.fontSize;
  export let labelColor: string = settings.stylingSettings.label.color;
  export let labelOpacity: number = settings.stylingSettings.label.opacity;
  export let labelFontFamily: string = "Helvetica, Arial, sans-serif";

  // Subtitles
  export let leftSubtitle: string = "High Error with Few Steps";
  export let rightSubtitle: string = "Low Error with Few Steps";
  export let subtitleFontSize: number = 26;
  export let subtitleColor: string = settings.stylingSettings.label.color;

  // Target distribution styling
  export let targetColor: string = "#3b82f6";
  export let targetOpacity: number = 0.2;
  export let targetPointRadius: number = 5;

  // Trajectory styling
  export let groundTruthColor: string = "#22c55e";
  export let groundTruthOpacity: number = 0.8;
  export let approximationColor: string = "#f17720";
  export let approximationOpacity: number = 0.8;
  export let errorColor: string = "#dc2626"; // Red for error line
  export let trajectoryStrokeWidth: number = 3;
  export let endpointRadius: number =
    settings.stylingSettings.trajectory.endpointRadius;

  // Starting points (supports multiple)
  export let defaultStartPoints: number[][] = [
    [-1.5, -0.2],
  ];
  export let startPointRadius: number = endpointRadius;
  export let maxUserTrajectories: number = settings.interactiveSettings.maxUserTrajectories;

  // Callbacks & misc
  export let backgroundVisible: boolean = true;
  export let children: Snippet | undefined = undefined;

  // ===== CONSTANTS =====

  const stepValues = [1, 2, 4, 8, 16];
  const defaultStepIndex = 2; // Default to 4 steps (index into stepValues)
  const groundTruthSteps = 64;

  // ===== DERIVED FROM PROPS =====

  $: caption = children;
  $: isDataValid = targetDistribution?.length > 0;

  // ===== STATE =====

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let leftCanvas: HTMLCanvasElement | null = null;
  let rightCanvas: HTMLCanvasElement | null = null;
  const leftCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  const rightCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  // Tie ctx reactivity to canvas variables so it updates when action runs
  $: leftCtx = leftCanvas && leftCanvas2d.ctx;
  $: rightCtx = rightCanvas && rightCanvas2d.ctx;

  // Scales
  let xScale: d3.ScaleLinear<number, number>;
  let yScale: d3.ScaleLinear<number, number>;

  // Pre-computed pixel coordinates
  let scaledTargetDistribution: number[][] = [];

  // Current slider index
  let currentStepIndex: number = defaultStepIndex;

  // Starting points (domain coordinates) - supports multiple
  let userStartPoints: number[][] = [...defaultStartPoints];

  // Request ID tracking for cancellation (4 separate requests)
  let fmGroundTruthRequestId: string | null = null;
  let fmApproxRequestId: string | null = null;
  let rfGroundTruthRequestId: string | null = null;
  let rfApproxRequestId: string | null = null;

  // Pre-computed trajectories for all step counts
  // Format: { steps: [traj1, traj2, ...] } where each traj is [[x,y], ...]
  let flowMatchingTrajectories: Record<number, number[][][]> = {};
  let rectifiedFlowTrajectories: Record<number, number[][][]> = {};
  let flowMatchingGroundTruths: number[][][] = []; // Array of trajectories
  let rectifiedFlowGroundTruths: number[][][] = [];

  // Loading state
  let isLoading: boolean = true;

  // Initialization
  let isInitialized: boolean = false;

  // Visibility
  let figureIsActive: boolean;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // Animation timing config (in ms)
  const segmentDuration = 600;
  const segmentPauseDuration = 400;
  const endPauseDuration = 2500;

  // Animation state (combined for single Timeline)
  type AnimationState = {
    leftSegmentIndex: number;
    leftSegmentProgress: number;
    leftInEndPause: boolean;
    rightSegmentIndex: number;
    rightSegmentProgress: number;
    rightInEndPause: boolean;
  };

  // Timeline for animation
  let timeline: Timeline<AnimationState> | null = null;

  // Track previous end pause state for detecting transitions
  let prevLeftInEndPause = false;
  let prevRightInEndPause = false;

  // Create segment clip for left side
  function createLeftSegmentClip(numSegments: number, segmentPhaseMs: number) {
    const cycleTime = segmentDuration + segmentPauseDuration;
    return {
      name: "LeftSegments",
      reduce(t: number) {
        const absoluteTime = t * segmentPhaseMs;
        const segmentIdx = Math.floor(absoluteTime / cycleTime);
        const timeInCycle = absoluteTime % cycleTime;

        const segmentIndex = Math.min(segmentIdx, numSegments);
        const segmentProgress = (segmentIdx < numSegments && timeInCycle < segmentDuration)
          ? timeInCycle / segmentDuration
          : 1;

        return {
          leftSegmentIndex: segmentIndex,
          leftSegmentProgress: segmentProgress,
          leftInEndPause: false
        };
      }
    };
  }

  // Create segment clip for right side
  function createRightSegmentClip(numSegments: number, segmentPhaseMs: number) {
    const cycleTime = segmentDuration + segmentPauseDuration;
    return {
      name: "RightSegments",
      reduce(t: number) {
        const absoluteTime = t * segmentPhaseMs;
        const segmentIdx = Math.floor(absoluteTime / cycleTime);
        const timeInCycle = absoluteTime % cycleTime;

        const segmentIndex = Math.min(segmentIdx, numSegments);
        const segmentProgress = (segmentIdx < numSegments && timeInCycle < segmentDuration)
          ? timeInCycle / segmentDuration
          : 1;

        return {
          rightSegmentIndex: segmentIndex,
          rightSegmentProgress: segmentProgress,
          rightInEndPause: false
        };
      }
    };
  }

  // Create end pause clip for left side
  function createLeftEndPauseClip(numSegments: number) {
    return {
      name: "LeftEndPause",
      reduce() {
        return {
          leftInEndPause: true,
          leftSegmentIndex: numSegments,
          leftSegmentProgress: 1
        };
      }
    };
  }

  // Create end pause clip for right side
  function createRightEndPauseClip(numSegments: number) {
    return {
      name: "RightEndPause",
      reduce() {
        return {
          rightInEndPause: true,
          rightSegmentIndex: numSegments,
          rightSegmentProgress: 1
        };
      }
    };
  }

  // ===== FUNCTIONS =====

  function initializeScales() {
    if (!isDataValid) return;

    const { xMin, xMax, yMin, yMax } = domainRange;

    xScale = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .range([marginWidth, canvasWidth - marginWidth]);

    yScale = d3
      .scaleLinear()
      .domain([yMin, yMax])
      .range([marginHeight, canvasHeight - marginHeight]);
  }


  function precomputeCoordinates() {
    if (!xScale || !yScale) return;

    scaledTargetDistribution = targetDistribution.map((p) => [
      xScale(p[0]),
      yScale(p[1]),
    ]);
  }

  // Generate a random starting point within the domain
  function generateRandomStartPoint() {
    const { xMin, xMax, yMin, yMax } = domainRange;
    const x = xMin + Math.random() * (xMax - xMin);
    const y = yMin + Math.random() * (yMax - yMin);
    return [x, y];
  }

  // Cancel all in-flight requests
  function cancelAllRequests() {
    if (fmGroundTruthRequestId) {
      flowMatchingClient.stopRequest(fmGroundTruthRequestId);
      fmGroundTruthRequestId = null;
    }
    if (fmApproxRequestId) {
      flowMatchingClient.stopRequest(fmApproxRequestId);
      fmApproxRequestId = null;
    }
    if (rfGroundTruthRequestId) {
      rectifiedFlowClient.stopRequest(rfGroundTruthRequestId);
      rfGroundTruthRequestId = null;
    }
    if (rfApproxRequestId) {
      rectifiedFlowClient.stopRequest(rfApproxRequestId);
      rfApproxRequestId = null;
    }
  }

  // Sample trajectories using batch mode (for background loading of remaining step counts)
  async function sampleTrajectoriesBatch(client: FlowModelClient, points: number[][], numSteps: number) {
    const { promise } = client.sampleFromInitialPoints(points, numSteps, { scheduler: "euler" });
    const allSamples = await promise;
    return points.map((point, pointIdx) => [
      point,
      ...allSamples.map((ts) => [ts[pointIdx][0], ts[pointIdx][1]]),
    ]);
  }

  // Load remaining step counts in background (non-blocking)
  async function loadRemainingStepCounts() {
    const currentSteps = stepValues[currentStepIndex];

    for (const steps of stepValues) {
      if (steps === currentSteps) continue;

      const [fmSteps, rfSteps] = await Promise.all([
        sampleTrajectoriesBatch(flowMatchingClient, userStartPoints, steps),
        sampleTrajectoriesBatch(rectifiedFlowClient, userStartPoints, steps)
      ]);

      flowMatchingTrajectories[steps] = fmSteps;
      rectifiedFlowTrajectories[steps] = rfSteps;
    }
  }

  // Compute all trajectories for all start points
  // Streams all 4 requests in parallel for immediate feedback
  function computeAllTrajectories() {
    // Cancel any in-progress requests
    cancelAllRequests();

    isLoading = true;

    const currentSteps = stepValues[currentStepIndex];

    // Initialize all trajectories with just starting points
    flowMatchingGroundTruths = userStartPoints.map(p => [p]);
    rectifiedFlowGroundTruths = userStartPoints.map(p => [p]);
    flowMatchingTrajectories = { [currentSteps]: userStartPoints.map(p => [p]) };
    rectifiedFlowTrajectories = { [currentSteps]: userStartPoints.map(p => [p]) };

    // Draw initial state immediately
    isLoading = false;
    setupTimeline();
    startApproxAnimation();

    let completedCount = 0;
    const checkComplete = () => {
      completedCount++;
      if (completedCount >= 4) {
        // All initial requests done - load remaining step counts in background
        loadRemainingStepCounts();
      }
    };

    // FM Ground Truth - streaming
    const fmGtResult = flowMatchingClient.sampleFromInitialPoints(
      userStartPoints,
      groundTruthSteps,
      { scheduler: "euler" },
      (_step, x_t) => {
        flowMatchingGroundTruths = flowMatchingGroundTruths.map((traj, i) => [
          ...traj, [x_t[i][0], x_t[i][1]]
        ]);
      }
    );
    fmGroundTruthRequestId = fmGtResult.requestId;
    fmGtResult.promise.then(() => {
      fmGroundTruthRequestId = null;
      checkComplete();
    });

    // RF Ground Truth - streaming
    const rfGtResult = rectifiedFlowClient.sampleFromInitialPoints(
      userStartPoints,
      groundTruthSteps,
      { scheduler: "euler" },
      (_step, x_t) => {
        rectifiedFlowGroundTruths = rectifiedFlowGroundTruths.map((traj, i) => [
          ...traj, [x_t[i][0], x_t[i][1]]
        ]);
      }
    );
    rfGroundTruthRequestId = rfGtResult.requestId;
    rfGtResult.promise.then(() => {
      rfGroundTruthRequestId = null;
      checkComplete();
    });

    // FM Approximation - streaming
    const fmApproxResult = flowMatchingClient.sampleFromInitialPoints(
      userStartPoints,
      currentSteps,
      { scheduler: "euler" },
      (_step, x_t) => {
        flowMatchingTrajectories[currentSteps] = flowMatchingTrajectories[currentSteps].map((traj, i) => [
          ...traj, [x_t[i][0], x_t[i][1]]
        ]);
        // Timeline tick callback will pick up updated trajectory data automatically
      }
    );
    fmApproxRequestId = fmApproxResult.requestId;
    fmApproxResult.promise.then(() => {
      fmApproxRequestId = null;
      checkComplete();
    });

    // RF Approximation - streaming
    const rfApproxResult = rectifiedFlowClient.sampleFromInitialPoints(
      userStartPoints,
      currentSteps,
      { scheduler: "euler" },
      (_step, x_t) => {
        rectifiedFlowTrajectories[currentSteps] = rectifiedFlowTrajectories[currentSteps].map((traj, i) => [
          ...traj, [x_t[i][0], x_t[i][1]]
        ]);
        // Timeline tick callback will pick up updated trajectory data automatically
      }
    );
    rfApproxRequestId = rfApproxResult.requestId;
    rfApproxResult.promise.then(() => {
      rfApproxRequestId = null;
      checkComplete();
    });
  }

  // Draw a full trajectory path (respects ctx.globalAlpha set by caller)
  function drawTrajectory(
    ctx: CanvasRenderingContext2D,
    trajectory: number[][],
    color: string,
    lineWidth: number,
    showEndpoint: boolean = true
  ) {
    if (!trajectory || trajectory.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    const [startX, startY] = [
      xScale(trajectory[0][0]),
      yScale(trajectory[0][1]),
    ];
    ctx.moveTo(startX, startY);

    for (let i = 1; i < trajectory.length; i++) {
      const [x, y] = [xScale(trajectory[i][0]), yScale(trajectory[i][1])];
      ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw endpoint marker
    if (showEndpoint) {
      const lastPoint = trajectory[trajectory.length - 1];
      const [endX, endY] = [xScale(lastPoint[0]), yScale(lastPoint[1])];
      ctx.beginPath();
      ctx.arc(endX, endY, endpointRadius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  // Draw start point markers for all start points
  function drawStartPoints(ctx: CanvasRenderingContext2D) {
    for (const point of userStartPoints) {
      const [x, y] = [xScale(point[0]), yScale(point[1])];

      // Outer ring
      ctx.beginPath();
      ctx.arc(x, y, startPointRadius + 2, 0, 2 * Math.PI);
      ctx.strokeStyle = groundTruthColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner fill
      ctx.beginPath();
      ctx.arc(x, y, startPointRadius, 0, 2 * Math.PI);
      ctx.fillStyle = groundTruthColor;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
  }

  // Draw error line (dashed) from ground truth endpoint to approximation endpoint
  function drawErrorLine(
    ctx: CanvasRenderingContext2D,
    groundTruthEndpoint: number[],
    approxEndpoint: number[],
    color: string,
    lineWidth: number
  ) {
    if (!groundTruthEndpoint || !approxEndpoint) return;

    const [gtX, gtY] = [
      xScale(groundTruthEndpoint[0]),
      yScale(groundTruthEndpoint[1]),
    ];
    const [apX, apY] = [xScale(approxEndpoint[0]), yScale(approxEndpoint[1])];

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([6, 4]); // Dashed line
    ctx.globalAlpha = 1.0;

    ctx.beginPath();
    ctx.moveTo(gtX, gtY);
    ctx.lineTo(apX, apY);
    ctx.stroke();

    ctx.setLineDash([]); // Reset to solid line
  }

  // --- Static Background ---
  function drawLeftBackground() {
    if (!leftCtx) return;
    leftCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw target distribution
    drawScatterPlot(
      leftCtx,
      scaledTargetDistribution,
      targetPointRadius,
      targetColor,
      targetOpacity
    );

    // Draw ground truth trajectories
    leftCtx.globalAlpha = groundTruthOpacity;
    for (const traj of flowMatchingGroundTruths) {
      drawTrajectory(
        leftCtx,
        traj,
        groundTruthColor,
        trajectoryStrokeWidth,
        true
      );
    }
    leftCtx.globalAlpha = 1.0;
  }

  function drawRightBackground() {
    if (!rightCtx) return;
    rightCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw target distribution
    drawScatterPlot(
      rightCtx,
      scaledTargetDistribution,
      targetPointRadius,
      targetColor,
      targetOpacity
    );

    // Draw ground truth trajectories
    rightCtx.globalAlpha = groundTruthOpacity;
    for (const traj of rectifiedFlowGroundTruths) {
      drawTrajectory(
        rightCtx,
        traj,
        groundTruthColor,
        trajectoryStrokeWidth,
        true
      );
    }
    rightCtx.globalAlpha = 1.0;
  }

  // --- Dynamic Foreground ---
  // Draw error lines for left panel (called during end pause)
  function drawLeftErrorLines() {
    if (!leftCtx) return;
    const currentSteps = stepValues[currentStepIndex];
    const leftApprox = flowMatchingTrajectories[currentSteps] || [];

    for (let i = 0; i < Math.min(flowMatchingGroundTruths.length, leftApprox.length); i++) {
      const gtTraj = flowMatchingGroundTruths[i];
      const apTraj = leftApprox[i];
      if (gtTraj && gtTraj.length > 0 && apTraj && apTraj.length > 0) {
        const gtEndpoint = gtTraj[gtTraj.length - 1];
        const apEndpoint = apTraj[apTraj.length - 1];
        drawErrorLine(leftCtx, gtEndpoint, apEndpoint, errorColor, 2);
      }
    }
  }

  // Draw error lines for right panel (called during end pause)
  function drawRightErrorLines() {
    if (!rightCtx) return;
    const currentSteps = stepValues[currentStepIndex];
    const rightApprox = rectifiedFlowTrajectories[currentSteps] || [];

    for (let i = 0; i < Math.min(rectifiedFlowGroundTruths.length, rightApprox.length); i++) {
      const gtTraj = rectifiedFlowGroundTruths[i];
      const apTraj = rightApprox[i];
      if (gtTraj && gtTraj.length > 0 && apTraj && apTraj.length > 0) {
        const gtEndpoint = gtTraj[gtTraj.length - 1];
        const apEndpoint = apTraj[apTraj.length - 1];
        drawErrorLine(rightCtx, gtEndpoint, apEndpoint, errorColor, 2);
      }
    }
  }

  // Draw approximation trajectories with current animation state
  function drawApproximation(ctx: CanvasRenderingContext2D | null, trajectories: number[][][], state: { segmentIndex: number; segmentProgress: number; inEndPause: boolean }) {
    if (!ctx) return;
    // Convert domain coordinates to pixel coordinates
    const scaledTrajectories = trajectories.map(traj =>
      traj.map(point => [xScale(point[0]), yScale(point[1])])
    );

    drawTrajectories(ctx, scaledTrajectories, state.segmentIndex, {
      color: approximationColor,
      strokeWidth: trajectoryStrokeWidth + 0.5,
      pointRadius: endpointRadius,
      opacity: approximationOpacity,
      headStyle: { type: 'arrow', radius: endpointRadius * 2.5 }
    });
  }

  // Calculate total animation duration in ms
  function getTotalAnimationMs(numSegments: number) {
    return numSegments * (segmentDuration + segmentPauseDuration) + endPauseDuration;
  }

  // Setup timeline for the current step count
  function setupTimeline() {
    // Clean up previous timeline to prevent memory leaks
    timeline?.dispose();

    const currentSteps = stepValues[currentStepIndex];
    const cycleTime = segmentDuration + segmentPauseDuration;
    const segmentPhaseMs = currentSteps * cycleTime;
    const totalMs = segmentPhaseMs + endPauseDuration;
    const segmentPhaseNormalized = segmentPhaseMs / totalMs;
    const endPauseNormalized = endPauseDuration / totalMs;

    // Create new timeline
    timeline = new Timeline<AnimationState>();
    timeline.initialState = {
      leftSegmentIndex: 0,
      leftSegmentProgress: 0,
      leftInEndPause: false,
      rightSegmentIndex: 0,
      rightSegmentProgress: 0,
      rightInEndPause: false
    };

    // Add clips for both sides
    timeline.add(createLeftSegmentClip(currentSteps, segmentPhaseMs), { start: 0, end: segmentPhaseNormalized });
    timeline.add(createRightSegmentClip(currentSteps, segmentPhaseMs), { start: 0, end: segmentPhaseNormalized });
    timeline.add(createLeftEndPauseClip(currentSteps), { start: segmentPhaseNormalized, end: 1 });
    timeline.add(createRightEndPauseClip(currentSteps), { start: segmentPhaseNormalized, end: 1 });

    // Set timeline duration in seconds
    timeline.duration = totalMs / 1000;
    timeline.looping = false; // We handle looping manually for regeneration

    // Reset transition tracking
    prevLeftInEndPause = false;
    prevRightInEndPause = false;

    // Register tick callback
    timeline.onTick((_t, state) => {
      // Detect transitions into end pause state to trigger error line drawing
      if (state.leftInEndPause && !prevLeftInEndPause) {
        drawLeftErrorLines();
      }
      if (state.rightInEndPause && !prevRightInEndPause) {
        drawRightErrorLines();
      }
      prevLeftInEndPause = state.leftInEndPause;
      prevRightInEndPause = state.rightInEndPause;

      // Handle looping - generate new random start point
      if (timeline && timeline.isAtEnd) {
        timeline.pause();

        // Generate a new random starting point for the next cycle
        userStartPoints = [generateRandomStartPoint()];

        // Reset transition tracking
        prevLeftInEndPause = false;
        prevRightInEndPause = false;

        // Recompute trajectories (which will restart animation)
        computeAllTrajectories();
        return;
      }

      drawLeftFrame(state);
      drawRightFrame(state);
    });
  }

  // Draw a full frame (background + approximation)
  function drawLeftFrame(state: AnimationState) {
    drawLeftBackground();
    const currentSteps = stepValues[currentStepIndex];
    const leftApprox = flowMatchingTrajectories[currentSteps] || [];
    const leftState = {
      segmentIndex: state.leftSegmentIndex,
      segmentProgress: state.leftSegmentProgress,
      inEndPause: state.leftInEndPause
    };
    drawApproximation(leftCtx, leftApprox, leftState);
    if (state.leftInEndPause) {
      drawLeftErrorLines();
    }
  }

  function drawRightFrame(state: AnimationState) {
    drawRightBackground();
    const currentSteps = stepValues[currentStepIndex];
    const rightApprox = rectifiedFlowTrajectories[currentSteps] || [];
    const rightState = {
      segmentIndex: state.rightSegmentIndex,
      segmentProgress: state.rightSegmentProgress,
      inEndPause: state.rightInEndPause
    };
    drawApproximation(rightCtx, rightApprox, rightState);
    if (state.rightInEndPause) {
      drawRightErrorLines();
    }
  }

  function startApproxAnimation() {
    if (!timeline || timeline.isPlaying) return;
    timeline.play();
  }

  function stopApproxAnimation() {
    if (timeline) timeline.pause();
  }

  function resetApproxAnimation() {
    stopApproxAnimation();
    // Recreate timeline to pick up any trajectory changes
    setupTimeline();
    startApproxAnimation();
  }

  // Draw only start points and target distribution (for immediate feedback)
  function drawInitialState() {
    if (!leftCtx || !rightCtx) return;

    // Clear both canvases
    leftCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    rightCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw target distribution on both
    drawScatterPlot(leftCtx, scaledTargetDistribution, targetPointRadius, targetColor, targetOpacity);
    drawScatterPlot(rightCtx, scaledTargetDistribution, targetPointRadius, targetColor, targetOpacity);
  }

  // Handle canvas click - convert to domain coordinates and add/replace start point
  function handleCanvasClick(event: MouseEvent, side: "left" | "right") {
    // Stop current animation and reset
    stopApproxAnimation();
    if (timeline) timeline.reset();
    prevLeftInEndPause = false;
    prevRightInEndPause = false;

    const canvas = side === "left" ? leftCanvas : rightCanvas;
    const rect = canvas.getBoundingClientRect();

    // Get click position in CSS pixels (account for canvas scaling)
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    // Convert to domain coordinates using scale.invert()
    const domainX = xScale.invert(clickX);
    const domainY = yScale.invert(clickY);
    const newPoint = [domainX, domainY];

    // Add new point to buffer (FIFO with max limit)
    userStartPoints = [...userStartPoints, newPoint];
    if (userStartPoints.length > maxUserTrajectories) {
      userStartPoints = userStartPoints.slice(-maxUserTrajectories);
    }

    // Immediately draw start points for visual feedback
    drawInitialState();

    // Recompute all trajectories (cancels any in-progress requests)
    computeAllTrajectories();
  }

  function handleSliderChange() {
    resetApproxAnimation();
  }

  function initializeVisualization() {
    if (!leftCanvas || !rightCanvas || !isDataValid) return;

    initializeScales();
    precomputeCoordinates();
    isInitialized = true;
    computeAllTrajectories();
  }

  // ===== REACTIVE EFFECTS =====

  $: if (isDataValid && leftCanvas && rightCanvas && !isInitialized) {
    initializeVisualization();
  }

  // Visibility handling - pause when scrolled off-screen
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  $: currentSteps = stepValues[currentStepIndex];

  // Legend items (reactive to update step count)
  $: legendItems = [
    { type: 'line', color: groundTruthColor, label: 'Ground Truth' },
    { type: 'line', color: approximationColor, label: `Approximation (${currentSteps} ${currentSteps === 1 ? "step" : "steps"})` },
    { type: 'dashed', color: errorColor, label: 'Error' },
  ];

  // Generate ticks for slider (log scale positions)
  $: sliderTicks = stepValues.map((step, i) => ({
    position: i / (stepValues.length - 1),
    label: String(step),
  }));

  // ===== LIFECYCLE =====

  onMount(() => {
    // Initialization handled by reactive statement
  });

  onDestroy(() => {
    timeline?.dispose();
  });
</script>

{#if isDataValid}
  <DoubleFigure {gap} {caption} {backgroundVisible} bind:isActive={figureIsActive}>
    {#snippet left()}
      <div class="panel-container" style="max-width: {canvasWidth}px;">
        <div
          class="panel-label"
          style="font-size: {labelFontSize}px; color: {labelColor}; opacity: {labelOpacity}; font-family: {labelFontFamily};"
        >
          {leftLabel}
        </div>
        <div
          class="panel-subtitle"
          style="font-size: {subtitleFontSize}px; color: {subtitleColor};"
        >
          {leftSubtitle}
        </div>
        <canvas
          bind:this={leftCanvas}
          use:leftCanvas2d.bindCanvas
          class="panel-canvas"
          onclick={(e) => handleCanvasClick(e, "left")}
          style="cursor: pointer;"
        ></canvas>
      </div>
    {/snippet}

    {#snippet right()}
      <div class="panel-container" style="max-width: {canvasWidth}px;">
        <div
          class="panel-label"
          style="font-size: {labelFontSize}px; color: {labelColor}; opacity: {labelOpacity}; font-family: {labelFontFamily};"
        >
          {rightLabel}
        </div>
        <div
          class="panel-subtitle"
          style="font-size: {subtitleFontSize}px; color: {subtitleColor};"
        >
          {rightSubtitle}
        </div>
        <canvas
          bind:this={rightCanvas}
          use:rightCanvas2d.bindCanvas
          class="panel-canvas"
          onclick={(e) => handleCanvasClick(e, "right")}
          style="cursor: pointer;"
        ></canvas>
      </div>
    {/snippet}

    {#snippet footer()}
      <div class="footer-container">
        <FigureLegend items={legendItems} />
        <div class="legend-spacer"></div>
        <Slider
          bind:value={currentStepIndex}
          min={0}
          max={stepValues.length - 1}
          step={1}
          disabled={isLoading}
          color={approximationColor}
          ticks={sliderTicks}
          activeTickIndex={currentStepIndex}
          showTickMarks={true}
          showLabel={false}
          onInput={handleSliderChange}
        />
        <div class="slider-label-below">Number of Euler Steps</div>
      </div>
    {/snippet}
  </DoubleFigure>
{:else}
  <div class="placeholder">
    <p>Euler step comparison requires target distribution data.</p>
  </div>
{/if}

<style>
  .panel-container {
    width: 100%;
  }

  .panel-label {
    text-align: center;
    padding-bottom: 4px;
    font-weight: 500;
  }

  .panel-subtitle {
    text-align: center;
    white-space: nowrap;
    font-weight: 200;
  }

  .panel-canvas {
    width: 100%;
    height: auto;
    display: block;
  }

  .footer-container {
    width: 100%;
  }

  .legend-spacer {
    height: 16px;
  }

  .slider-label-below {
    text-align: center;
    font-size: 16px;
    font-family: Helvetica, Arial, sans-serif;
    color: #7b7b7b;
    margin-top: 8px;
  }

  .placeholder {
    padding: 2rem;
    text-align: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    color: #666;
  }

  @media (max-width: 600px) {
    .panel-label {
      font-size: 18px !important;
    }

    .panel-subtitle {
      font-size: 13px !important;
    }
  }

  @media (max-width: 400px) {
    .panel-subtitle {
      font-size: 11px !important;
    }
  }

  @media (max-width: 400px) {
    .panel-label {
      font-size: 16px !important;
    }
  }
</style>
