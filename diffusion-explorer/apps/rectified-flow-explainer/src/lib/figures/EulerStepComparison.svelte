<!-- Compares Euler sampler trajectories between Flow Matching and Rectified Flow with varying step counts -->

<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import {
    DoubleFigure,
    drawScatterPlot,
    Slider,
    FigureLegend,
    Clock,
    Track,
    useCanvas2D,
  } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ===== PROPS =====

  // FlowModelClient instances (passed from parent, created with correct base path)
  export let flowMatchingClient = null;
  export let rectifiedFlowClient = null;

  // Data
  export let targetDistribution = [];

  // Layout
  export let canvasWidth = 400;
  export let canvasHeight = 400;
  export let marginWidth = 10;
  export let marginHeight = 10;
  export let gap = 20;
  export let domainRange = { xMin: -1.7, xMax: 1.7, yMin: -1.5, yMax: 1.7 };

  // Labels
  export let leftLabel = "Flow Matching";
  export let rightLabel = "Rectified Flow";
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;
  export let labelOpacity = settings.stylingSettings.label.opacity;

  // Subtitles
  export let leftSubtitle = "High Error with Few Steps";
  export let rightSubtitle = "Low Error with Few Steps";
  export let subtitleFontSize = 26;
  export let subtitleColor = settings.stylingSettings.label.color;

  // Target distribution styling
  export let targetColor = "#3b82f6";
  export let targetOpacity = 0.2;
  export let targetPointRadius = 7;

  // Trajectory styling
  export let groundTruthColor = "#22c55e";
  export let groundTruthOpacity = 0.8;
  export let approximationColor = "#f17720";
  export let approximationOpacity = 0.8;
  export let errorColor = "#dc2626"; // Red for error line
  export let trajectoryStrokeWidth = 3;
  export let endpointRadius =
    settings.stylingSettings.trajectory.endpointRadius;

  // Starting points (supports multiple)
  export let defaultStartPoints = [
    [-1.5, -0.2],
  ];
  export let startPointRadius = endpointRadius;
  export let maxUserTrajectories = settings.interactiveSettings.maxUserTrajectories;

  // Callbacks & misc
  export let backgroundVisible = true;
  export let children = undefined;

  // ===== CONSTANTS =====

  const stepValues = [1, 2, 4, 8, 16];
  const defaultStepIndex = 2; // Default to 4 steps (index into stepValues)
  const groundTruthSteps = 64;

  // ===== DERIVED FROM PROPS =====

  $: caption = children;
  $: isDataValid = targetDistribution?.length > 0;

  // ===== STATE =====

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let leftCanvas = null;
  let rightCanvas = null;
  const leftCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  const rightCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  // Tie ctx reactivity to canvas variables so it updates when action runs
  $: leftCtx = leftCanvas && leftCanvas2d.ctx;
  $: rightCtx = rightCanvas && rightCanvas2d.ctx;

  // Scales
  let xScale;
  let yScale;

  // Pre-computed pixel coordinates
  let scaledTargetDistribution = [];

  // Current slider index
  let currentStepIndex = defaultStepIndex;

  // Starting points (domain coordinates) - supports multiple
  let userStartPoints = [...defaultStartPoints];

  // Request ID tracking for cancellation (4 separate requests)
  let fmGroundTruthRequestId = null;
  let fmApproxRequestId = null;
  let rfGroundTruthRequestId = null;
  let rfApproxRequestId = null;

  // Pre-computed trajectories for all step counts
  // Format: { steps: [traj1, traj2, ...] } where each traj is [[x,y], ...]
  let flowMatchingTrajectories = {};
  let rectifiedFlowTrajectories = {};
  let flowMatchingGroundTruths = []; // Array of trajectories
  let rectifiedFlowGroundTruths = [];

  // Loading state
  let isLoading = true;

  // Initialization
  let isInitialized = false;

  // Animation timing config (in ms)
  const segmentDuration = 600;
  const segmentPauseDuration = 400;
  const endPauseDuration = 2500;

  // Animation state
  let leftState = { segmentIndex: 0, segmentProgress: 0, inEndPause: false };
  let rightState = { segmentIndex: 0, segmentProgress: 0, inEndPause: false };

  // Tracks and clock for animation
  let leftTrack = new Track();
  let rightTrack = new Track();
  const clock = new Clock();

  // Create segment clip that animates through segments with pauses
  function createSegmentClip(numSegments) {
    const cycleTime = segmentDuration + segmentPauseDuration;
    const segmentPhaseMs = numSegments * cycleTime;
    const totalMs = segmentPhaseMs + endPauseDuration;
    const segmentPhaseNormalized = segmentPhaseMs / totalMs;

    return {
      name: "Segments",
      duration: segmentPhaseNormalized,
      apply(t, _params, state) {
        const absoluteTime = t * segmentPhaseMs;
        const segmentIdx = Math.floor(absoluteTime / cycleTime);
        const timeInCycle = absoluteTime % cycleTime;

        state.segmentIndex = Math.min(segmentIdx, numSegments);
        if (segmentIdx < numSegments && timeInCycle < segmentDuration) {
          state.segmentProgress = timeInCycle / segmentDuration;
        } else {
          state.segmentProgress = 1;
        }
        state.inEndPause = false;
      }
    };
  }

  // Create end pause clip that triggers error line drawing
  function createEndPauseClipWithCallback(duration, onEnter) {
    let hasCalledOnEnter = false;
    return {
      name: "EndPause",
      duration,
      apply(_t, _params, state) {
        state.inEndPause = true;
        state.segmentProgress = 1;
        if (!hasCalledOnEnter) {
          hasCalledOnEnter = true;
          onEnter?.();
        }
      },
      reset() {
        hasCalledOnEnter = false;
      }
    };
  }

  // Store end pause clips for reset
  let leftEndPauseClip = null;
  let rightEndPauseClip = null;

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
  async function sampleTrajectoriesBatch(client, points, numSteps) {
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
    setupTracks();
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
        // Recreate tracks to pick up new data and start them
        setupTracks();
        startApproxAnimation();
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
        // Recreate tracks to pick up new data and start them
        setupTracks();
        startApproxAnimation();
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
    ctx,
    trajectory,
    color,
    lineWidth,
    showEndpoint = true
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
  function drawStartPoints(ctx) {
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
    ctx,
    groundTruthEndpoint,
    approxEndpoint,
    color,
    lineWidth
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

  // Background drawing functions for animation controllers
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

  // Draw partial trajectory with current segment being animated
  function drawPartialTrajectory(ctx, trajectory, segmentIndex, segmentProgress, color, strokeWidth, pointRadius, opacity) {
    if (!trajectory || trajectory.length < 2) return;

    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Draw completed segments
    if (segmentIndex > 0) {
      ctx.beginPath();
      ctx.moveTo(xScale(trajectory[0][0]), yScale(trajectory[0][1]));
      for (let i = 1; i <= segmentIndex && i < trajectory.length; i++) {
        ctx.lineTo(xScale(trajectory[i][0]), yScale(trajectory[i][1]));
      }
      ctx.stroke();
    }

    // Draw current segment being animated (interpolated)
    if (segmentIndex < trajectory.length - 1) {
      const startIdx = segmentIndex;
      const endIdx = segmentIndex + 1;
      if (endIdx < trajectory.length) {
        const startPt = trajectory[startIdx];
        const endPt = trajectory[endIdx];
        const interpX = xScale(startPt[0]) + (xScale(endPt[0]) - xScale(startPt[0])) * segmentProgress;
        const interpY = yScale(startPt[1]) + (yScale(endPt[1]) - yScale(startPt[1])) * segmentProgress;

        ctx.beginPath();
        ctx.moveTo(xScale(startPt[0]), yScale(startPt[1]));
        ctx.lineTo(interpX, interpY);
        ctx.stroke();

        // Draw current position marker
        ctx.beginPath();
        ctx.arc(interpX, interpY, pointRadius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      }
    } else if (trajectory.length > 0) {
      // Animation complete - draw endpoint marker
      const lastPt = trajectory[trajectory.length - 1];
      ctx.beginPath();
      ctx.arc(xScale(lastPt[0]), yScale(lastPt[1]), pointRadius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    }

    ctx.globalAlpha = 1.0;
  }

  // Draw approximation trajectories with current animation state
  function drawApproximation(ctx, trajectories, state) {
    for (const traj of trajectories) {
      drawPartialTrajectory(
        ctx,
        traj,
        state.segmentIndex,
        state.segmentProgress,
        approximationColor,
        trajectoryStrokeWidth + 0.5,
        endpointRadius,
        approximationOpacity
      );
    }
  }

  // Calculate total animation duration in ms
  function getTotalAnimationMs(numSegments) {
    return numSegments * (segmentDuration + segmentPauseDuration) + endPauseDuration;
  }

  // Setup tracks for the current step count
  function setupTracks() {
    const currentSteps = stepValues[currentStepIndex];
    const cycleTime = segmentDuration + segmentPauseDuration;
    const segmentPhaseMs = currentSteps * cycleTime;
    const totalMs = segmentPhaseMs + endPauseDuration;
    const segmentPhaseNormalized = segmentPhaseMs / totalMs;
    const endPauseNormalized = endPauseDuration / totalMs;

    // Reset tracks
    leftTrack = new Track();
    rightTrack = new Track();

    // Create clips
    const leftSegmentClip = createSegmentClip(currentSteps);
    leftEndPauseClip = createEndPauseClipWithCallback(endPauseNormalized, drawLeftErrorLines);
    leftTrack.add(leftSegmentClip, 0);
    leftTrack.add(leftEndPauseClip, segmentPhaseNormalized);

    const rightSegmentClip = createSegmentClip(currentSteps);
    rightEndPauseClip = createEndPauseClipWithCallback(endPauseNormalized, drawRightErrorLines);
    rightTrack.add(rightSegmentClip, 0);
    rightTrack.add(rightEndPauseClip, segmentPhaseNormalized);
  }

  // Draw a full frame (background + approximation)
  function drawLeftFrame() {
    drawLeftBackground();
    const currentSteps = stepValues[currentStepIndex];
    const leftApprox = flowMatchingTrajectories[currentSteps] || [];
    drawApproximation(leftCtx, leftApprox, leftState);
    if (leftState.inEndPause) {
      drawLeftErrorLines();
    }
  }

  function drawRightFrame() {
    drawRightBackground();
    const currentSteps = stepValues[currentStepIndex];
    const rightApprox = rectifiedFlowTrajectories[currentSteps] || [];
    drawApproximation(rightCtx, rightApprox, rightState);
    if (rightState.inEndPause) {
      drawRightErrorLines();
    }
  }

  function startApproxAnimation() {
    if (clock.isRunning) return;

    const currentSteps = stepValues[currentStepIndex];
    const totalMs = getTotalAnimationMs(currentSteps);

    clock.start((dt) => {
      // Convert real time (seconds) to normalized time
      const normalizedDt = dt / (totalMs / 1000);

      // Update both tracks
      leftTrack.update(normalizedDt, {}, leftState);
      rightTrack.update(normalizedDt, {}, rightState);

      // Handle looping - generate new random start point
      if (leftTrack.time >= 1) {
        leftTrack.reset();
        rightTrack.reset();
        leftEndPauseClip?.reset?.();
        rightEndPauseClip?.reset?.();
        leftState = { segmentIndex: 0, segmentProgress: 0, inEndPause: false };
        rightState = { segmentIndex: 0, segmentProgress: 0, inEndPause: false };

        // Generate a new random starting point for the next cycle
        userStartPoints = [generateRandomStartPoint()];

        // Stop animation and recompute trajectories (which will restart animation)
        clock.stop();
        computeAllTrajectories();
        return;
      }

      drawLeftFrame();
      drawRightFrame();
    });
  }

  function stopApproxAnimation() {
    clock.stop();
  }

  function resetApproxAnimation() {
    stopApproxAnimation();
    leftTrack.reset();
    rightTrack.reset();
    leftEndPauseClip?.reset?.();
    rightEndPauseClip?.reset?.();
    leftState = { segmentIndex: 0, segmentProgress: 0, inEndPause: false };
    rightState = { segmentIndex: 0, segmentProgress: 0, inEndPause: false };
    // Recreate tracks to pick up any trajectory changes
    setupTracks();
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
  function handleCanvasClick(event, side) {
    // Stop current animation and reset tracks
    stopApproxAnimation();
    leftTrack.reset();
    rightTrack.reset();
    leftEndPauseClip?.reset?.();
    rightEndPauseClip?.reset?.();
    leftState = { segmentIndex: 0, segmentProgress: 0, inEndPause: false };
    rightState = { segmentIndex: 0, segmentProgress: 0, inEndPause: false };

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
    stopApproxAnimation();
  });
</script>

{#if isDataValid}
  <DoubleFigure {gap} {caption} {backgroundVisible}>
    {#snippet left()}
      <div class="panel-container" style="max-width: {canvasWidth}px;">
        <div
          class="panel-label"
          style="font-size: {labelFontSize}px; color: {labelColor}; opacity: {labelOpacity};"
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
          style="font-size: {labelFontSize}px; color: {labelColor}; opacity: {labelOpacity};"
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
