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
    type VectorFieldFn,
    type StreamlineAnimationState,
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
  export let pulseWidth = 0.2;
  export let pulsePauseWidth = 0.05;
  export let streamlineDuration = 8;
  export let playingByDefault = true;

  // Left canvas styling (Volume)
  export let volumeFillColor = "#fff7ed"; // Light orange tint
  export let volumeFillOpacity = 0.7;
  export let volumeStrokeColor = "#f97316"; // Orange
  export let volumeStrokeWidth = 3;
  export let volumeLabelText = "V";
  export let volumeLabelFontSize = 32;
  export let volumeLabelColor = "#f97316"; // Orange to match boundary
  export let volumeLabelStrokeColor = "white";
  export let volumeLabelStrokeWidth = 12;

  // Volume pulsing animation (represents ∂/∂t)
  export let volumeScaleMin = 0.8;
  export let volumeScaleMax = 1.0;
  export let volumeScaleDuration = 4; // seconds for one pulse cycle

  // Volume normal arrows (show surface stretching)
  export let volumeNumArrows = 16;
  export let volumeArrowLength = 0.15;
  export let volumeArrowWidth = 2;
  export let volumeArrowHeadSize = 6;
  export let volumeArrowColor = "#f97316"; // Orange

  // Right canvas styling (Surface with rotating vectors)
  export let surfaceFillColor = "#fff7ed"; // Light orange tint
  export let surfaceFillOpacity = 0.7; // Match left side
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
  export let normalColor = "#f97316"; // Orange
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

  // Animation state type (extends StreamlineAnimationState with rotation and volume scale)
  type AnimationState = StreamlineAnimationState & {
    theta: number; // 0-2π for rotation around surface
    volumeScale: number; // Scale factor for volume (0.8-1.0 for pulsing)
  };

  // Animation objects
  let timeline: Timeline<AnimationState> | null = null;
  let streamlineAnim: StreamlineAnimation<AnimationState> | null = null;

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

    // Create streamline animation
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
      pulseWidth,
      pulsePauseWidth,
      offsets: "synchronized",
      loopMultiplier: 1,
    });
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

    const totalDuration = Math.max(streamlineDuration, rotationDuration, volumeScaleDuration);

    timeline = new Timeline<AnimationState>();
    timeline.initialState = { streamlinePhase: 0, theta: 0, volumeScale: volumeScaleMin };
    timeline.duration = totalDuration;
    timeline.looping = true;

    // Add streamline clip from the animation
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

    // Add volume scale clip (pulsing from min to max using sine wave, runs full duration)
    timeline.add(
      {
        name: "VolumeScale",
        reduce(t: number) {
          const loops = totalDuration / volumeScaleDuration;
          const phase = t * loops * 2 * Math.PI;
          // Use sine wave: starts at min, goes to max, back to min
          const normalized = (1 - Math.cos(phase)) / 2; // 0 to 1 to 0
          return { volumeScale: volumeScaleMin + normalized * (volumeScaleMax - volumeScaleMin) };
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
    curve?: (theta: number) => [number, number]
  ) {
    const ctx = leftCanvas2d.ctx;
    if (!ctx || !boundingBox || !streamlineAnim || !curve) return;

    const { volumeScale } = state;

    ctx.clearRect(0, 0, cWidth, cHeight);

    // Create toPixel function bound to current canvas dimensions
    const toPixelBound = (p: [number, number]) => toPixel(p, cWidth, cHeight);

    // Draw streamlines first (behind)
    streamlineAnim.draw(ctx, state);

    // Create scaled curve function for pulsing volume
    const scaledCurveFn = (theta: number): [number, number] => {
      const [x, y] = curve(theta);
      return [x * volumeScale, y * volumeScale];
    };

    // Draw filled surface on top (scaled)
    drawClosedCurve(ctx, scaledCurveFn, toPixelBound, {
      fillColor: volumeFillColor,
      fillOpacity: volumeFillOpacity,
      strokeColor: volumeStrokeColor,
      strokeWidth: volumeStrokeWidth,
    });

    // Draw normal arrows around the perimeter (showing surface stretching)
    const arrowPixelLength = scaleLength(volumeArrowLength, cWidth);
    for (let i = 0; i < volumeNumArrows; i++) {
      const theta = (i / volumeNumArrows) * 2 * Math.PI;
      const { position, normal } = getTangentAndNormal(scaledCurveFn, theta);
      const [px, py] = toPixelBound(position);

      // Arrow end point (normal points outward)
      const endX = px + normal[0] * arrowPixelLength;
      const endY = py - normal[1] * arrowPixelLength; // Flip y for canvas coords

      ctx.strokeStyle = volumeArrowColor;
      ctx.fillStyle = volumeArrowColor;
      ctx.lineWidth = volumeArrowWidth;
      drawArrow(ctx, px, py, endX, endY, volumeArrowHeadSize);
    }

    // Draw "V" label in center
    const centerX = (boundingBox.xMin + boundingBox.xMax) / 2;
    const centerY = (boundingBox.yMin + boundingBox.yMax) / 2;
    const [px, py] = toPixelBound([centerX, centerY]);

    drawMathjax(
      ctx,
      volumeLabelText,
      px,
      py + volumeLabelFontSize / 3, // Adjust for vertical centering
      volumeLabelFontSize,
      0,
      0,
      {
        color: volumeLabelColor,
        stroke: volumeLabelStrokeColor,
        strokeWidth: volumeLabelStrokeWidth,
        strokeOpacity: 0.8,
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
      <div class="equation-label">The change in probability density <Katex math={"\\rho"}/> in a volume <Katex math={"V"}/> over time.</div>
      <div class="equation-math">
        <Katex math={"\\frac{\\partial}{\\partial t} \\int_V \\rho \\, dV"} displayMode={true} />
      </div>
    </div>
    <div class="equation-equals">
      <Katex math={"="} displayMode={true} />
    </div>
    <div class="equation-side">
      <div class="equation-label">The probability flux <Katex math={"\\rho \\mathbf{v}"}/> through a surface <Katex math={"S"}/>.</div>
      <div class="equation-math">
        <Katex math={"-\\oint_S \\rho \\mathbf{v} \\cdot \\hat{n} \\, dS"} displayMode={true} />
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
    gap: 1rem;
  }

  .equation-side {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    max-width: 350px;
  }

  .equation-label {
    font-size: 1.1rem;
    color: #666;
    margin-bottom: 0.5rem;
    text-align: center;
    line-height: 1.4;
  }

  .equation-math {
    min-height: 3rem;
    display: flex;
    align-items: center;
  }

  .equation-equals {
    display: flex;
    align-items: center;
  }

  /* Remove top margin from DoubleFigure */
  .mass-conservation-equation + :global(.double-figure) {
    margin-top: 0;
  }
</style>
