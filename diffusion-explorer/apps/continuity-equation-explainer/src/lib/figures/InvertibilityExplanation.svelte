<!-- InvertibilityExplanation: Shows two trajectories that merge at time t, demonstrating why invertibility is required for well-behaved flows. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    Figure,
    TimeSlider,
    drawScatterPlot,
    drawTrajectories,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
    createPauseClip,
    drawMathjax,
    type Clip,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot (receives content from parent as default slot)
  export let children = undefined;

  // Layout props
  export let width = 800;
  export let height = 400;
  export let marginWidth = 50;
  export let marginHeight = 50;

  // Source/Target layout (normalized 0-1)
  export let sourceCenterX = 0.2;
  export let targetCenterX = 0.8;

  // Trajectory control points (in normalized domain coordinates, roughly -1 to 1)
  export let trajectoryA: {
    start: [number, number];
    ctrl1: [number, number];
    ctrl2: [number, number];
    merge: [number, number];
  } = {
    start: [-0.6, 0.4],
    ctrl1: [-0.3, 0.5],
    ctrl2: [0.0, 0.3],
    merge: [0.2, 0.1]
  };

  export let trajectoryB: {
    start: [number, number];
    ctrl1: [number, number];
    ctrl2: [number, number];
    merge: [number, number];
  } = {
    start: [-0.6, -0.4],
    ctrl1: [-0.3, -0.5],
    ctrl2: [0.0, -0.1],
    merge: [0.2, 0.1]  // Same merge point as trajectoryA
  };

  export let sharedPath: {
    ctrl1: [number, number];
    ctrl2: [number, number];
    end: [number, number];
  } = {
    ctrl1: [0.35, -0.05],
    ctrl2: [0.4, -0.2],
    end: [0.45, -0.35]
  };

  export let mergeTime = 0.4;  // Normalized time (0-1) when trajectories merge
  export let numSteps = 400;   // Number of discrete points per trajectory

  // Distribution data - can be provided or loaded from file
  export let sourceDistribution: number[][] | null = null;  // If null, generates Gaussian
  export let targetDistribution: number[][] | null = null;  // If null, loads smiley face from file
  export let smileyFaceDataPath = "/data/smiley_face.json";  // Path to smiley face data
  export let numScatterPoints = 150;  // Number of points to display for target (samples from distribution)
  export let numSourcePoints = 300;   // Number of points for source distribution (more for denser look)
  export let distributionScale = 0.4;  // Scale factor for distributions
  export let sourceClipRadius = 0.8;   // Clip source points beyond this radius for ball shape (0 = no clip)
  export let distributionVerticalOffset = 30;  // Shift distributions down by this many pixels

  // Styling props - scatter plots
  export let scatterRadius = 4;
  export let scatterOpacity = 0.25;
  export let scatterColor = "#3b82f6";
  export let showSourceScatter = true;
  export let showTargetScatter = true;

  // Styling props - trajectories
  export let trajectoryColor = "#f17720";
  export let trajectoryStrokeWidth = 3;
  export let trajectoryPointRadius = 4;

  // Styling props - labels
  export let latexFontSize = 18;
  export let labelFontSize = 22;
  export let labelFontFamily = "sans-serif";

  // Animation props
  export let animationDuration = 8000;
  export let timing = {
    animationEnd: 1.0,
  };
  export let playingByDefault = true;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Canvas refs
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  // Scales (using uniform scale factor for aspect-ratio-preserving rendering)
  let scales: {
    scaleFactor: number;  // Uniform scale for both x and y
    centerY: number;      // Vertical center in pixels
    sourceCenterPixelX: number;
    targetCenterPixelX: number;
  } | null = null;

  // Precomputed pixel coordinates for scatter plots
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];

  // Precomputed pixel trajectories
  let pixelTrajectories: number[][][] = [];

  // Animation state type
  type AnimationState = {
    segmentIndex: number;
    time: number;
  };

  // Timeline
  let timeline: Timeline<AnimationState> | null = null;

  // Visibility handling
  let figureIsActive: import("svelte/store").Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);
  let isInitialized = false;
  let isDataLoaded = false;

  // Loaded smiley face data
  let loadedSmileyFaceData: number[][] | null = null;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Evaluate a cubic Bezier curve at parameter t (0-1)
   * P(t) = (1-t)^3*P0 + 3*(1-t)^2*t*P1 + 3*(1-t)*t^2*P2 + t^3*P3
   */
  function evaluateCubicBezier(
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    t: number
  ): [number, number] {
    const oneMinusT = 1 - t;
    const oneMinusT2 = oneMinusT * oneMinusT;
    const oneMinusT3 = oneMinusT2 * oneMinusT;
    const t2 = t * t;
    const t3 = t2 * t;

    return [
      oneMinusT3 * p0[0] + 3 * oneMinusT2 * t * p1[0] + 3 * oneMinusT * t2 * p2[0] + t3 * p3[0],
      oneMinusT3 * p0[1] + 3 * oneMinusT2 * t * p1[1] + 3 * oneMinusT * t2 * p2[1] + t3 * p3[1]
    ];
  }

  /**
   * Sample a cubic Bezier curve into discrete points
   */
  function sampleBezierCurve(
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    numSamples: number
  ): [number, number][] {
    const points: [number, number][] = [];
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      points.push(evaluateCubicBezier(p0, p1, p2, p3, t));
    }
    return points;
  }

  /**
   * Convert domain coordinates to pixel coordinates
   * At t=0, centered at source; at t=1, centered at target
   * Uses uniform scale factor to preserve aspect ratio
   */
  function domainToPixel(point: [number, number], t: number): [number, number] {
    if (!scales) return [0, 0];
    const centerPixelX =
      scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return [
      centerPixelX + point[0] * scales.scaleFactor,
      scales.centerY - point[1] * scales.scaleFactor  // Subtract because canvas y increases downward
    ];
  }

  /**
   * Generate simple Gaussian scatter points with optional clip radius for ball shape
   */
  function generateGaussianPoints(
    centerX: number,
    centerY: number,
    std: number,
    count: number,
    clipRadius: number = 0
  ): [number, number][] {
    const points: [number, number][] = [];
    // Generate extra points to account for clipping
    const maxAttempts = count * 10;
    let attempts = 0;

    while (points.length < count && attempts < maxAttempts) {
      attempts++;
      // Box-Muller transform for Gaussian
      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
      const x = centerX + z0 * std;
      const y = centerY + z1 * std;

      // If clip radius is set, only keep points within radius
      if (clipRadius > 0) {
        const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        if (dist <= clipRadius) {
          points.push([x, y]);
        }
      } else {
        points.push([x, y]);
      }
    }
    return points;
  }

  /**
   * Normalize distribution to be centered at origin with given scale
   */
  function normalizeDistribution(
    points: number[][],
    scale: number
  ): [number, number][] {
    if (points.length === 0) return [];

    // Compute mean
    let meanX = 0, meanY = 0;
    for (const p of points) {
      meanX += p[0];
      meanY += p[1];
    }
    meanX /= points.length;
    meanY /= points.length;

    // Compute std
    let varX = 0, varY = 0;
    for (const p of points) {
      varX += (p[0] - meanX) ** 2;
      varY += (p[1] - meanY) ** 2;
    }
    const stdX = Math.sqrt(varX / points.length);
    const stdY = Math.sqrt(varY / points.length);
    const maxStd = Math.max(stdX, stdY);

    // Normalize: center and scale (negate y to flip for canvas coordinates)
    return points.map(p => [
      ((p[0] - meanX) / maxStd) * scale,
      -((p[1] - meanY) / maxStd) * scale  // Flip y-axis
    ]);
  }

  /**
   * Randomly sample points from a distribution
   */
  function samplePoints(points: [number, number][], count: number): [number, number][] {
    if (points.length <= count) return points;
    const shuffled = [...points].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  /**
   * Load smiley face data from JSON file
   */
  async function loadSmileyFaceData(): Promise<number[][] | null> {
    try {
      const response = await fetch(smileyFaceDataPath);
      if (!response.ok) {
        console.warn(`Failed to load smiley face data: ${response.status}`);
        return null;
      }
      const data = await response.json();
      return data.points || null;
    } catch (error) {
      console.warn("Error loading smiley face data:", error);
      return null;
    }
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas) return;

    // Create scales with uniform scale factor for aspect-ratio preservation
    const plotWidth = width - 2 * marginWidth;
    const plotHeight = height - 2 * marginHeight;

    // Use a uniform scale factor (based on width for consistency)
    const scaleFactor = plotWidth / 4;

    scales = {
      scaleFactor,
      centerY: height / 2,  // Vertical center of canvas
      sourceCenterPixelX: marginWidth + plotWidth * sourceCenterX,
      targetCenterPixelX: marginWidth + plotWidth * targetCenterX,
    };

    // Get source distribution: use provided data or generate Gaussian with clip radius
    let sourcePoints: [number, number][];
    if (sourceDistribution && sourceDistribution.length > 0) {
      sourcePoints = normalizeDistribution(sourceDistribution, distributionScale);
      sourcePoints = samplePoints(sourcePoints, numSourcePoints);
    } else {
      sourcePoints = generateGaussianPoints(0, 0, distributionScale, numSourcePoints, sourceClipRadius);
    }

    // Get target distribution: use provided data, loaded smiley face, or generate Gaussian
    let targetPoints: [number, number][];
    const targetData = targetDistribution || loadedSmileyFaceData;
    if (targetData && targetData.length > 0) {
      targetPoints = normalizeDistribution(targetData, distributionScale);
      targetPoints = samplePoints(targetPoints, numScatterPoints);
    } else {
      targetPoints = generateGaussianPoints(0, 0, distributionScale, numScatterPoints);
    }

    // Convert to pixel coordinates (with vertical offset to shift distributions down)
    sourcePixelCoords = sourcePoints.map(p => {
      const [px, py] = domainToPixel(p, 0);
      return [px, py + distributionVerticalOffset];
    });
    targetPixelCoords = targetPoints.map(p => {
      const [px, py] = domainToPixel(p, 1);
      return [px, py + distributionVerticalOffset];
    });

    // Build the merging trajectories
    const mergeStep = Math.floor(mergeTime * numSteps);
    const sharedSteps = numSteps - mergeStep;

    // Phase 1: Individual paths to merge point
    const phaseA1 = sampleBezierCurve(
      trajectoryA.start, trajectoryA.ctrl1, trajectoryA.ctrl2, trajectoryA.merge,
      mergeStep
    );

    const phaseB1 = sampleBezierCurve(
      trajectoryB.start, trajectoryB.ctrl1, trajectoryB.ctrl2, trajectoryB.merge,
      mergeStep
    );

    // Phase 2: Shared path from merge to end
    const phase2 = sampleBezierCurve(
      trajectoryA.merge, sharedPath.ctrl1, sharedPath.ctrl2, sharedPath.end,
      sharedSteps
    );

    // Combine phases into full trajectories
    const trajADomain = [...phaseA1, ...phase2.slice(1)];
    const trajBDomain = [...phaseB1, ...phase2.slice(1)];

    // Convert to pixel coordinates with horizontal interpolation
    pixelTrajectories = [
      trajADomain.map((pt, idx) => {
        const t = idx / (trajADomain.length - 1);
        return domainToPixel(pt, t);
      }),
      trajBDomain.map((pt, idx) => {
        const t = idx / (trajBDomain.length - 1);
        return domainToPixel(pt, t);
      })
    ];
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    if (!scales || pixelTrajectories.length === 0) return;

    timeline = new Timeline<AnimationState>();
    timeline.initialState = {
      segmentIndex: 0,
      time: 0
    };

    const numSegments = pixelTrajectories[0].length - 1;

    // Main animation clip
    const mainClip: Clip<AnimationState> = {
      name: "InvertibilityAnimation",
      reduce(t: number) {
        return {
          segmentIndex: Math.floor(t * numSegments),
          time: t
        };
      }
    };

    timeline.add(mainClip, { start: 0, end: timing.animationEnd });
    timeline.add(createPauseClip(), { start: timing.animationEnd, end: 1 });

    timeline.duration = animationDuration / 1000;
    timeline.looping = true;

    timeline.onTick((_, state) => {
      draw(state);
    });
  }

  function startAnimation() {
    if (!timeline) return;
    timeline.play();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function requestRedraw() {
    if (timeline) {
      draw(timeline.state);
    }
  }

  function draw(state: AnimationState) {
    if (!ctx || !scales) return;
    ctx.clearRect(0, 0, width, height);

    const { segmentIndex, time } = state;

    // --- Static Background ---

    // Draw source distribution scatter (faded)
    if (showSourceScatter && sourcePixelCoords.length > 0) {
      drawScatterPlot(ctx, sourcePixelCoords, scatterRadius, scatterColor, scatterOpacity);
    }

    // Draw target distribution scatter (faded)
    if (showTargetScatter && targetPixelCoords.length > 0) {
      drawScatterPlot(ctx, targetPixelCoords, scatterRadius, scatterColor, scatterOpacity);
    }

    // --- Dynamic Foreground ---

    // Draw trajectories
    drawTrajectories(ctx, pixelTrajectories, segmentIndex, {
      strokeWidth: trajectoryStrokeWidth,
      color: trajectoryColor,
      opacity: 1.0,
      pointRadius: trajectoryPointRadius,
      showPreview: true,
      previewOpacity: 0.15,
      showHeadMarker: true
    });

    // Draw labels
    drawLabels(state);

    // Draw explanatory text
    drawExplanatoryText(time);
  }

  function drawLabels(state: AnimationState) {
    if (!ctx || !scales || pixelTrajectories.length < 2) return;

    const { segmentIndex, time } = state;
    const labelMargin = 18;

    // Get starting points
    const startA = pixelTrajectories[0][0];
    const startB = pixelTrajectories[1][0];

    // Draw starting point markers
    ctx.fillStyle = trajectoryColor;
    ctx.beginPath();
    ctx.arc(startA[0], startA[1], trajectoryPointRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(startB[0], startB[1], trajectoryPointRadius, 0, Math.PI * 2);
    ctx.fill();

    // Draw x_a and x_b labels at starting points
    drawMathjax(
      ctx,
      "x_a",
      startA[0],
      startA[1] - labelMargin,
      latexFontSize,
      0,
      0,
      { color: "#666", stroke: "#fff", strokeWidth: 3 },
      requestRedraw
    );

    drawMathjax(
      ctx,
      "x_b",
      startB[0],
      startB[1] + labelMargin + 20,
      latexFontSize,
      0,
      0,
      { color: "#666", stroke: "#fff", strokeWidth: 3 },
      requestRedraw
    );

    // Get current positions
    const currentA = pixelTrajectories[0][segmentIndex];
    const currentB = pixelTrajectories[1][segmentIndex];

    if (!currentA || !currentB) return;

    // Check if trajectories have merged
    const distance = Math.hypot(currentA[0] - currentB[0], currentA[1] - currentB[1]);
    const hasMerged = distance < 5;

    if (hasMerged && time >= mergeTime) {
      // After merge: show combined label
      drawMathjax(
        ctx,
        "\\psi_t(x_a) = \\psi_t(x_b)",
        currentA[0],
        currentA[1] - labelMargin - 5,
        latexFontSize,
        0,
        0,
        { color: "#666", stroke: "#fff", strokeWidth: 3 },
        requestRedraw
      );
    } else {
      // Before merge: show separate labels
      drawMathjax(
        ctx,
        "\\psi_t(x_a)",
        currentA[0],
        currentA[1] - labelMargin,
        latexFontSize,
        0,
        0,
        { color: "#666", stroke: "#fff", strokeWidth: 3 },
        requestRedraw
      );

      drawMathjax(
        ctx,
        "\\psi_t(x_b)",
        currentB[0],
        currentB[1] + labelMargin + 25,
        latexFontSize,
        0,
        0,
        { color: "#666", stroke: "#fff", strokeWidth: 3 },
        requestRedraw
      );
    }
  }

  function drawExplanatoryText(time: number) {
    if (!ctx) return;

    const centerY = marginHeight - 5;
    ctx.font = `400 ${labelFontSize}px ${labelFontFamily}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#666";
    ctx.fillText("Paths merge! Invertibility violated.", width / 2, centerY);
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) timeline.pause();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Store reference to avoid shadowing by snippet name
  $: captionSnippet = children;

  // Load smiley face data when canvas is ready (if not provided)
  $: if (!isDataLoaded && canvas && !targetDistribution) {
    isDataLoaded = true;  // Prevent multiple loads
    loadSmileyFaceData().then(data => {
      loadedSmileyFaceData = data;
      if (!isInitialized) {
        runInitialComputation();
        setupTimeline();
        isInitialized = true;
        if (timeline) {
          draw(timeline.initialState);
          if (playingByDefault) startAnimation();
        }
      }
    });
  }

  // Initialize immediately if target distribution is provided
  $: if (!isInitialized && canvas && targetDistribution) {
    isDataLoaded = true;
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
    if (timeline) {
      draw(timeline.initialState);
      if (playingByDefault) startAnimation();
    }
  }

  // Handle visibility changes
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure bind:isActive={figureIsActive} backgroundVisible={false}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <div style="width: 100%; max-width: {width}px;">
        <canvas
          bind:this={canvas}
          use:canvas2d.bindCanvas
          style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
        ></canvas>
      </div>
      <TimeSlider timeline={timeline as import("@diffusion-explorer/ui").Timeline<unknown> | null} color={trajectoryColor} />
    </div>
  {/snippet}

  {#snippet caption()}
    {@render captionSnippet?.()}
  {/snippet}
</Figure>
