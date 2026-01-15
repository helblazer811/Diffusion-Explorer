<!-- Mass Conservation visualization with volume (left) and surface normals (right) side by side. -->

<script lang="ts">
  import { tick, onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    DoubleFigure,
    useCanvas2D,
    useVisibilityHandler,
    drawArrow,
    drawMathjax,
    Timeline,
    StreamlineAnimation,
    Katex,
    computeContours,
    plotContours,
    type VectorFieldFn,
    type StreamlineAnimationState,
    type ComputedContours,
  } from "@diffusion-explorer/ui";
  import {
    createClosedCurve,
    createWavyVectorField,
    drawClosedCurve,
    getTangentAndNormal,
    type CurveFn,
  } from "./DivergenceTheorem/divergence_theorem";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot
  export let children: import("svelte").Snippet | undefined = undefined;

  // Layout
  export let width = 800;
  export let height = 350;
  export let gap = 20;
  export let backgroundVisible = false;

  // Curve parameters
  export let baseRadius = 0.85;
  export let curveAmplitudes = [0.2, 0.15, 0.1];
  export let curvePhases = [0, 0.7, 1.3];
  export let curveFrequencies = [1, 2, 3];

  // Domain margin around bounding box
  export let domainMargin = 0.7;

  // Vector field parameters
  export let wavyAmplitude = 0.3;
  export let wavyFrequency = 1.5;

  // Streamline settings
  export let density: number | [number, number] = 0.8;
  export let minPathLength = 1.5;
  export let segmentLength = 0.01;
  export let streamlineColor = "#3b82f6"; // Blue
  export let streamlineWidth = 2.5;
  export let gradientSubdivisions = 12;
  export let pulseWidthPixels = 30;
  export let pulsePauseWidthPixels = 5;
  export let streamlineDuration = 8;
  export let playingByDefault = true;

  // Left canvas styling (Volume)
  export let volumeStrokeColor = "#f97316"; // Orange
  export let volumeStrokeWidth = 3;
  export let volumeLabelText = "V";
  export let volumeLabelFontSize = 32;
  export let volumeLabelColor = "#f97316"; // Orange to match boundary

  // Density label (ρ above surface)
  export let densityLabelText = "\\rho";
  export let densityLabelFontSize = 28;
  export let densityLabelColor = "#3b82f6"; // Blue to match contours
  export let densityLabelYOffset = -0.7; // Fraction of bounding box height from center

  // Gaussian mixture for left side contour plot
  export let gaussianMixture: Array<{
    mean: [number, number];
    cov: [[number, number], [number, number]];
    weight: number;
  }> = [
    { mean: [-0.7, 0.55], cov: [[0.12, 0.04], [0.04, 0.05]], weight: 0.35 },
    { mean: [0.7, 0.5], cov: [[0.04, -0.02], [-0.02, 0.15]], weight: 0.35 },
    { mean: [0.0, -0.75], cov: [[0.18, 0.05], [0.05, 0.06]], weight: 0.30 },
  ];
  export let gaussianNumSamples = 3000;
  export let gaussianContourBandwidth = 10;
  export let gaussianGridSize = 400;
  export let gaussianContourThresholds = 8;
  export let gaussianContourOpacity = 0.4;
  export let gaussianContourColor = "#3b82f6"; // Blue

  // Contour animation
  export let contourAnimationSteps = 50;
  export let contourStepSize = 0.005;
  export let contourAnimationDuration = 4;

  // Mask outside surface
  export let outsideMaskOpacity = 0.7;

  // Right canvas styling (Surface with rotating vectors)
  export let surfaceFillColor = "#fff7ed"; // Light orange tint
  export let surfaceFillOpacity = 0.9;
  export let surfaceStrokeColor = "#f97316"; // Orange
  export let surfaceStrokeWidth = 3;

  // Surface label
  export let surfaceLabelText = "S";
  export let surfaceLabelFontSize = 28;
  export let surfaceLabelColor = "#f97316"; // Orange
  export let surfaceLabelStrokeColor = "white";
  export let surfaceLabelStrokeWidth = 15;
  export let surfaceLabelYOffset = -0.7; // Fraction of bounding box height from center

  // Rotation animation
  export let rotationDuration = 8; // seconds for one full rotation

  // Vector styling (for rotating normal/field vectors)
  export let vectorLength = 0.4;
  export let vectorScale = 1.2;
  export let vectorWidth = 3;
  export let arrowHeadSize = 8;
  export let normalColor = "#555555"; // Dark gray
  export let fieldColor = "#3b82f6"; // Blue
  export let dotColor = "#f97316"; // Orange
  export let dotRadius = 4;

  // Label styling
  export let labelOffset = 30;
  export let labelFontSize = 18;
  export let labelStrokeColor = "white";
  export let labelStrokeWidth = 10;
  export let labelStrokeOpacity = 0.8;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Visibility binding from DoubleFigure
  let figureIsActive: Writable<boolean>;

  // Left canvas
  let leftCanvas: HTMLCanvasElement | null = null;
  const leftCanvas2d = useCanvas2D(width, height);

  // Right canvas
  let rightCanvas: HTMLCanvasElement | null = null;
  const rightCanvas2d = useCanvas2D(width, height);

  // Bounding box for the curve
  let boundingBox: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  } | null = null;

  // Initialization flag
  let isInitialized = false;

  // Animation state type (extends StreamlineAnimationState with rotation and contour frame)
  type AnimationState = StreamlineAnimationState & {
    theta: number; // 0-2π for rotation around surface (right side only)
    contourFrame: number; // 0 to (contourAnimationSteps-1) for left side contour animation
  };

  // Animation objects
  let timeline: Timeline<AnimationState> | null = null;
  let streamlineAnim: StreamlineAnimation<AnimationState> | null = null;
  let gaussianContourFrames: ComputedContours[] = [];

  // Visibility handler
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function toPixel(p: [number, number], cWidth: number, cHeight: number): [number, number] {
    if (!boundingBox) return [0, 0];
    const xMin = boundingBox.xMin - domainMargin;
    const xMax = boundingBox.xMax + domainMargin;
    const yMin = boundingBox.yMin - domainMargin;
    const yMax = boundingBox.yMax + domainMargin;
    return [
      ((p[0] - xMin) / (xMax - xMin)) * cWidth,
      ((yMax - p[1]) / (yMax - yMin)) * cHeight,
    ];
  }

  function scaleLength(domainLen: number, cWidth: number): number {
    if (!boundingBox) return 0;
    const domainWidth = boundingBox.xMax - boundingBox.xMin + 2 * domainMargin;
    return (domainLen / domainWidth) * cWidth;
  }

  function computeBoundingBox(curve: (theta: number) => [number, number], numSamples: number = 360): {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  } {
    let xMin = Infinity,
      xMax = -Infinity;
    let yMin = Infinity,
      yMax = -Infinity;
    const step = (2 * Math.PI) / numSamples;

    for (let i = 0; i < numSamples; i++) {
      const theta = i * step;
      const [x, y] = curve(theta);
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    }

    return { xMin, xMax, yMin, yMax };
  }

  function boxMullerTransform(): [number, number] {
    const u1 = Math.random();
    const u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    return [r * Math.cos(theta), r * Math.sin(theta)];
  }

  function sampleGaussianMixture(
    numSamples: number,
    gaussians: typeof gaussianMixture
  ): [number, number][] {
    const samples: [number, number][] = [];
    for (let i = 0; i < numSamples; i++) {
      // Pick component by weight
      const r = Math.random();
      let cumWeight = 0;
      let selected = gaussians[0];
      for (const g of gaussians) {
        cumWeight += g.weight;
        if (r <= cumWeight) {
          selected = g;
          break;
        }
      }
      // Cholesky decomposition of 2x2 covariance
      const { mean, cov } = selected;
      const [z1, z2] = boxMullerTransform();
      const a = Math.sqrt(cov[0][0]);
      const b = cov[1][0] / a;
      const c = Math.sqrt(cov[1][1] - b * b);
      samples.push([mean[0] + a * z1, mean[1] + b * z1 + c * z2]);
    }
    return samples;
  }

  function drawOutsideMask(
    ctx: CanvasRenderingContext2D,
    curveFn: CurveFn,
    toPixelFn: (p: [number, number]) => [number, number],
    cWidth: number,
    cHeight: number,
    opacity: number
  ) {
    ctx.save();
    ctx.beginPath();
    // Outer rectangle (clockwise)
    ctx.rect(0, 0, cWidth, cHeight);
    // Inner curve (counter-clockwise for even-odd)
    const numSamples = 200;
    for (let i = 0; i <= numSamples; i++) {
      const theta = (i / numSamples) * 2 * Math.PI;
      const [px, py] = toPixelFn(curveFn(theta));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = "white";
    ctx.globalAlpha = opacity;
    ctx.fill("evenodd");
    ctx.restore();
  }

  function eulerIntegrate(
    samples: [number, number][],
    vectorField: (x: number, y: number) => [number, number],
    dt: number
  ): [number, number][] {
    return samples.map(([x, y]) => {
      const [vx, vy] = vectorField(x, y);
      return [x + vx * dt, y + vy * dt];
    });
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation(
    curve: (theta: number) => [number, number],
    vectorField: (x: number, y: number) => [number, number],
    cWidth: number,
    cHeight: number
  ) {
    boundingBox = computeBoundingBox(curve);

    // Create toPixel function bound to current canvas dimensions
    const toPixelBound = (p: [number, number]) => toPixel(p, cWidth, cHeight);

    // Create streamline animation (for right side only)
    streamlineAnim = StreamlineAnimation.create<StreamlineAnimationState>({
      vectorFieldFn: vectorField as VectorFieldFn,
      domain: {
        xMin: boundingBox.xMin - domainMargin,
        xMax: boundingBox.xMax + domainMargin,
        yMin: boundingBox.yMin - domainMargin,
        yMax: boundingBox.yMax + domainMargin,
      },
      toPixel: toPixelBound,
      density,
      minPathLength,
      segmentLength,
      color: streamlineColor,
      strokeWidth: streamlineWidth,
      gradientSubdivisions,
      pulseWidthPixels,
      pulsePauseWidthPixels,
      offsets: "synchronized",
      loopMultiplier: 1,
    });

    // Generate gaussian samples and compute contours for all animation frames
    let samples = sampleGaussianMixture(gaussianNumSamples, gaussianMixture);
    const contourDomain: [number, number, number, number] = [
      boundingBox.xMin - domainMargin,
      boundingBox.xMax + domainMargin,
      boundingBox.yMin - domainMargin,
      boundingBox.yMax + domainMargin,
    ];

    gaussianContourFrames = [];
    for (let i = 0; i < contourAnimationSteps; i++) {
      gaussianContourFrames.push(
        computeContours(samples, {
          bandwidth: gaussianContourBandwidth,
          gridSize: gaussianGridSize,
          thresholds: gaussianContourThresholds,
          domain: contourDomain,
        })
      );
      // Euler integrate samples to next frame
      samples = eulerIntegrate(samples, vectorField, contourStepSize);
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline(
    curve: (theta: number) => [number, number],
    vectorField: (x: number, y: number) => [number, number],
    cWidth: number,
    cHeight: number
  ) {
    if (!streamlineAnim) return;

    const totalDuration = Math.max(streamlineDuration, rotationDuration, contourAnimationDuration);

    timeline = new Timeline<AnimationState>();
    timeline.initialState = { streamlinePhase: 0, theta: 0, contourFrame: 0 };
    timeline.duration = totalDuration;
    timeline.looping = true;

    // Add streamline clip from the animation (for right side)
    timeline.add(streamlineAnim.clip, { start: 0, end: 1 });

    // Add rotation clip for the surface vectors (runs full duration, loops internally)
    timeline.add(
      {
        name: "SurfaceRotation",
        reduce(t: number) {
          const loops = totalDuration / rotationDuration;
          return { theta: ((t * loops) % 1) * 2 * Math.PI };
        },
      },
      { start: 0, end: 1 }
    );

    // Add contour animation clip (cycles through frames for left side)
    timeline.add(
      {
        name: "ContourAnimation",
        reduce(t: number) {
          const loops = totalDuration / contourAnimationDuration;
          const frameProgress = (t * loops) % 1;
          const contourFrame = Math.floor(frameProgress * contourAnimationSteps);
          return { contourFrame: Math.min(contourFrame, contourAnimationSteps - 1) };
        },
      },
      { start: 0, end: 1 }
    );

    timeline.onTick((_t, state) => {
      drawLeft(state, cWidth, cHeight, curve);
      drawRight(state, cWidth, cHeight, curve, vectorField);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawLeft(
    state: AnimationState,
    cWidth: number,
    cHeight: number,
    curve?: CurveFn
  ) {
    const ctx = leftCanvas2d.ctx;
    const { contourFrame } = state;
    const currentContours = gaussianContourFrames[contourFrame];
    if (!ctx || !boundingBox || !curve || !currentContours) return;

    ctx.clearRect(0, 0, cWidth, cHeight);

    // Create toPixel function bound to current canvas dimensions
    const toPixelBound = (p: [number, number]) => toPixel(p, cWidth, cHeight);

    // 1. Draw gaussian contour plot (animated frame)
    plotContours(ctx, currentContours, {
      xScale: (x) => toPixelBound([x, 0])[0],
      yScale: (y) => toPixelBound([0, y])[1],
      fillColor: gaussianContourColor,
      opacity: gaussianContourOpacity,
      fill: true,
      stroke: false,
    });

    // 2. Draw white mask outside surface
    drawOutsideMask(ctx, curve, toPixelBound, cWidth, cHeight, outsideMaskOpacity);

    // 3. Draw surface boundary (static, no fill)
    drawClosedCurve(ctx, curve, toPixelBound, {
      fillColor: "transparent",
      fillOpacity: 0,
      strokeColor: volumeStrokeColor,
      strokeWidth: volumeStrokeWidth,
    });

    // 4. Draw "V" label in center
    const centerX = (boundingBox.xMin + boundingBox.xMax) / 2;
    const centerY = (boundingBox.yMin + boundingBox.yMax) / 2;
    const [px, py] = toPixelBound([centerX, centerY]);

    drawMathjax(
      ctx,
      volumeLabelText,
      px,
      py + volumeLabelFontSize / 3,
      volumeLabelFontSize,
      0,
      0,
      {
        color: volumeLabelColor,
      }
    );

    // 5. Draw "ρ" label above the surface
    const bbHeight = boundingBox.yMax - boundingBox.yMin;
    const rhoLabelY = centerY - densityLabelYOffset * bbHeight;
    const [rlx, rly] = toPixelBound([centerX, rhoLabelY]);

    drawMathjax(
      ctx,
      densityLabelText,
      rlx,
      rly + densityLabelFontSize / 2,
      densityLabelFontSize,
      0,
      0,
      {
        color: densityLabelColor,
      }
    );
  }

  function drawRight(
    state: AnimationState,
    cWidth: number,
    cHeight: number,
    curve?: (theta: number) => [number, number],
    vectorField?: (x: number, y: number) => [number, number]
  ) {
    const ctx = rightCanvas2d.ctx;
    if (!ctx || !boundingBox || !streamlineAnim || !curve || !vectorField) return;

    const { theta } = state;

    ctx.clearRect(0, 0, cWidth, cHeight);

    // Create toPixel function bound to current canvas dimensions
    const toPixelBound = (p: [number, number]) => toPixel(p, cWidth, cHeight);

    // Draw streamlines first (behind)
    streamlineAnim.draw(ctx, state);

    // Draw surface outline on top
    drawClosedCurve(ctx, curve, toPixelBound, {
      fillColor: surfaceFillColor,
      fillOpacity: surfaceFillOpacity,
      strokeColor: surfaceStrokeColor,
      strokeWidth: surfaceStrokeWidth,
    });

    // Draw rotating normal and field vectors at current theta position
    const { position, normal } = getTangentAndNormal(curve, theta);
    const [px, py] = toPixelBound(position);

    // Field vector at this position
    const field = vectorField(position[0], position[1]);
    const fieldMag = Math.sqrt(field[0] * field[0] + field[1] * field[1]);
    const fieldNorm: [number, number] =
      fieldMag > 0 ? [field[0] / fieldMag, field[1] / fieldMag] : [1, 0];

    // Scale vectors to pixel length
    const vecPixelLen = scaleLength(vectorLength, cWidth) * vectorScale;

    // Normal vector end point (pointing outward)
    const normalEnd: [number, number] = [
      px + normal[0] * vecPixelLen,
      py - normal[1] * vecPixelLen, // Flip y for canvas coordinates
    ];

    // Field vector end point
    const fieldEnd: [number, number] = [
      px + fieldNorm[0] * vecPixelLen,
      py - fieldNorm[1] * vecPixelLen,
    ];

    // Draw normal vector (orange)
    ctx.strokeStyle = normalColor;
    ctx.fillStyle = normalColor;
    ctx.lineWidth = vectorWidth;
    drawArrow(ctx, px, py, normalEnd[0], normalEnd[1], arrowHeadSize);

    // Draw field vector (blue)
    ctx.strokeStyle = fieldColor;
    ctx.fillStyle = fieldColor;
    ctx.lineWidth = vectorWidth;
    drawArrow(ctx, px, py, fieldEnd[0], fieldEnd[1], arrowHeadSize);

    // Draw point on surface (on top of arrows)
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(px, py, dotRadius, 0, 2 * Math.PI);
    ctx.fill();

    // Draw labels at arrow tips using MathJax
    // Normal vector label (n hat) - orange with white outline
    const normalLabelX = normalEnd[0] + normal[0] * labelOffset;
    const normalLabelY = normalEnd[1] - normal[1] * labelOffset;
    drawMathjax(
      ctx,
      "\\hat{n}",
      normalLabelX,
      normalLabelY,
      labelFontSize,
      0,
      labelFontSize / 2,
      {
        color: normalColor,
        stroke: labelStrokeColor,
        strokeWidth: labelStrokeWidth,
        strokeOpacity: labelStrokeOpacity,
      }
    );

    // Field vector label (ρv) - blue with white outline
    const fieldLabelX = fieldEnd[0] + fieldNorm[0] * labelOffset;
    const fieldLabelY = fieldEnd[1] - fieldNorm[1] * labelOffset;
    drawMathjax(
      ctx,
      "\\rho \\mathbf{v}",
      fieldLabelX,
      fieldLabelY,
      labelFontSize,
      0,
      labelFontSize / 2,
      {
        color: fieldColor,
        stroke: labelStrokeColor,
        strokeWidth: labelStrokeWidth,
        strokeOpacity: labelStrokeOpacity,
      }
    );

    // Surface label (S) - above the surface
    const centerX = (boundingBox.xMin + boundingBox.xMax) / 2;
    const centerY = (boundingBox.yMin + boundingBox.yMax) / 2;
    const bbHeight = boundingBox.yMax - boundingBox.yMin;
    const labelY = centerY - surfaceLabelYOffset * bbHeight;
    const [slx, sly] = toPixelBound([centerX, labelY]);

    drawMathjax(
      ctx,
      surfaceLabelText,
      slx,
      sly + surfaceLabelFontSize / 2,
      surfaceLabelFontSize,
      0,
      0,
      {
        color: surfaceLabelColor,
        stroke: surfaceLabelStrokeColor,
        strokeWidth: surfaceLabelStrokeWidth,
        strokeOpacity: 0.8,
      }
    );
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

  // Compute canvas dimensions
  $: canvasWidth = Math.floor((width - gap) / 2);
  $: canvasHeight = height;

  // Create the curve function
  $: curveFn = createClosedCurve({
    baseRadius,
    amplitudes: curveAmplitudes,
    phases: curvePhases,
    frequencies: curveFrequencies,
  });

  // Create the vector field function
  $: vectorFieldFn = createWavyVectorField({
    amplitude: wavyAmplitude,
    frequency: wavyFrequency,
  });

  // Initialize and draw when canvases are ready
  $: if (!isInitialized && leftCanvas && rightCanvas && curveFn && vectorFieldFn) {
    runInitialComputation(curveFn, vectorFieldFn, canvasWidth, canvasHeight);
    setupTimeline(curveFn, vectorFieldFn, canvasWidth, canvasHeight);
    isInitialized = true;
    // Use tick() to ensure the canvas actions have run, then resize and draw
    tick().then(() => {
      // Resize canvases with correct dimensions
      leftCanvas2d.resize(canvasWidth, canvasHeight);
      rightCanvas2d.resize(canvasWidth, canvasHeight);
      if (timeline) {
        drawLeft(timeline.initialState, canvasWidth, canvasHeight, curveFn);
        drawRight(timeline.initialState, canvasWidth, canvasHeight, curveFn, vectorFieldFn);
        if (playingByDefault) timeline.play();
      }
    });
  }

  // Handle visibility changes
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<div class="mass-conservation-equation">
  <div class="equation-container">
    <div class="equation-side">
      <div class="equation-label">The change in probability density <Katex math={"\\color{#3b82f6}{\\rho}"}/> in a volume <Katex math={"\\color{#f97316}{V}"}/> over time.</div>
      <div class="equation-math">
        <Katex math={"\\frac{\\partial}{\\partial t} \\int_{\\color{#f97316}{V}} \\color{#3b82f6}{\\rho} \\, \\color{#f97316}{dV}"} displayMode={true} />
      </div>
    </div>
    <div class="equation-equals">
      <Katex math={"="} displayMode={true} />
    </div>
    <div class="equation-side">
      <div class="equation-label">The probability flux <Katex math={"\\color{#3b82f6}{\\rho \\mathbf{v}} \\color{#374151}{\\cdot \\hat{n}}"}/> through a surface <Katex math={"\\color{#f97316}{S}"}/>.</div>
      <div class="equation-math">
        <Katex math={"-\\oint_{\\color{#f97316}{S}} \\color{#3b82f6}{\\rho \\mathbf{v}} \\color{#374151}{\\cdot \\hat{n}} \\, \\color{#f97316}{dS}"} displayMode={true} />
      </div>
    </div>
  </div>
</div>

<DoubleFigure {gap} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet left()}
    <canvas
      bind:this={leftCanvas}
      use:leftCanvas2d.bindCanvas
      style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
    ></canvas>
  {/snippet}

  {#snippet right()}
    <canvas
      bind:this={rightCanvas}
      use:rightCanvas2d.bindCanvas
      style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
    ></canvas>
  {/snippet}

  {#snippet caption()}
    {@render children?.()}
  {/snippet}
</DoubleFigure>

<style>
  .mass-conservation-equation {
    text-align: center;
    margin-bottom: 0;
    color: #374151;
  }

  .equation-container {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.5rem;
  }

  .equation-side {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    max-width: 350px;
  }

  .equation-label {
    font-size: 1.5rem;
    color: #666;
    margin-bottom: 0.5rem;
    text-align: center;
    line-height: 1.4;
  }

  .equation-math {
    min-height: 3rem;
    display: flex;
    align-items: center;
    font-size: 1.4rem;
  }

  .equation-equals {
    display: flex;
    align-items: center;
    align-self: flex-end;
    padding-bottom: 0.5rem;
  }

  /* Remove top margin from DoubleFigure */
  .mass-conservation-equation + :global(.double-figure) {
    margin-top: 0;
  }
</style>
