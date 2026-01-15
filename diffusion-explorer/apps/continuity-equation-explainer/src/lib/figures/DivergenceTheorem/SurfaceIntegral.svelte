<!-- Surface integral visualization with streamlines and rotating normal/field vectors. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    Timeline,
    StreamlineAnimation,
    drawArrow,
    useCanvas2D,
    drawMathjax,
    type VectorFieldFn,
    type StreamlineAnimationState,
  } from "@diffusion-explorer/ui";
  import {
    getTangentAndNormal,
    drawClosedCurve,
    type CurveFn,
  } from "./divergence_theorem";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Curve and field functions from parent
  export let curveFn: CurveFn;
  export let vectorFieldFn: (x: number, y: number) => [number, number];

  // Layout
  export let width = 400;
  export let height = 350;

  // Domain margin around bounding box (matches VolumeIntegral)
  export let domainMargin = 0.7; // Margin around bounding box

  // Surface label (drawn on canvas)
  export let showLabel = true;
  export let labelText = "S";
  export let surfaceLabelFontSize = 28;
  export let surfaceLabelColor = "#f97316";
  export let surfaceLabelStrokeColor = "white";
  export let surfaceLabelStrokeWidth = 15;
  export let surfaceLabelYOffset = -0.55; // Fraction of bounding box height from center

  // Surface styling
  export let surfaceOpacity = 0.15;
  export let surfaceFillColor = "#e0e0e0";
  export let surfaceStrokeColor = "#999";
  export let surfaceStrokeWidth = 2;

  // Streamline generation
  export let density: number | [number, number] = 0.8;
  export let minPathLength = 1.5;
  export let segmentLength = 0.01;

  // Streamline styling
  export let streamlineColor = "#3b82f6";
  export let streamlineWidth = 2.5;
  export let gradientSubdivisions = 12;

  // Animation pulse settings (in pixels)
  export let pulseWidthPixels = 30;
  export let pulsePauseWidthPixels = 5;

  // Vector styling
  export let normalColor = "#f97316"; // Orange
  export let fieldColor = "#3b82f6"; // Blue
  export let dotColor = "#f97316"; // Orange
  export let dotRadius = 4;
  export let vectorLength = 0.4;
  export let vectorScale = 1.2; // Scale factor for arrow length
  export let vectorWidth = 3;
  export let arrowHeadSize = 8;

  // Label styling
  export let labelOffset = 20; // Distance from arrow tip
  export let labelFontSize = 18;
  export let labelStrokeColor = "white";
  export let labelStrokeWidth = 10;
  export let labelStrokeOpacity = 0.8;

  // Animation timing
  export let streamlineDuration = 8; // seconds for one streamline cycle
  export let rotationDuration = 8; // seconds for one full rotation
  export let playingByDefault = true;

  // Visibility
  export let isActive;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  let isInitialized = false;
  let wasPlayingBeforeHidden = false;

  // Animation state extends StreamlineAnimationState
  type AnimationState = StreamlineAnimationState & {
    theta: number; // 0-2π for rotation around surface
  };

  let timeline: Timeline<AnimationState> | null = null;
  let streamlineAnim: StreamlineAnimation<AnimationState> | null = null;

  // Bounding box for the curve
  let boundingBox: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  } | null = null;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function toPixel(p: [number, number]): [number, number] {
    if (!boundingBox) return [0, 0];
    const xMin = boundingBox.xMin - domainMargin;
    const xMax = boundingBox.xMax + domainMargin;
    const yMin = boundingBox.yMin - domainMargin;
    const yMax = boundingBox.yMax + domainMargin;
    return [
      ((p[0] - xMin) / (xMax - xMin)) * width,
      ((yMax - p[1]) / (yMax - yMin)) * height,
    ];
  }

  function scaleLength(domainLen: number): number {
    if (!boundingBox) return 0;
    const domainWidth = boundingBox.xMax - boundingBox.xMin + 2 * domainMargin;
    return (domainLen / domainWidth) * width;
  }

  function computeBoundingBox(numSamples: number = 360): {
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
      const [x, y] = curveFn(theta);
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

  function runInitialComputation() {
    if (!canvas) return;

    // Compute bounding box from curve (needed for toPixel)
    boundingBox = computeBoundingBox();

    // Create streamline animation
    const totalDuration = Math.max(streamlineDuration, rotationDuration);

    streamlineAnim = StreamlineAnimation.create<AnimationState>({
      vectorFieldFn: vectorFieldFn as VectorFieldFn,
      domain: {
        xMin: boundingBox.xMin - domainMargin,
        xMax: boundingBox.xMax + domainMargin,
        yMin: boundingBox.yMin - domainMargin,
        yMax: boundingBox.yMax + domainMargin,
      },
      toPixel,
      density,
      minPathLength,
      segmentLength,
      color: streamlineColor,
      strokeWidth: streamlineWidth,
      gradientSubdivisions,
      pulseWidthPixels,
      pulsePauseWidthPixels,
      offsets: "synchronized",
      loopMultiplier: totalDuration / streamlineDuration,
    });
  }

  function setupTimeline() {
    if (!streamlineAnim) return;

    timeline = new Timeline<AnimationState>();
    timeline.initialState = { streamlinePhase: 0, theta: 0 };

    const totalDuration = Math.max(streamlineDuration, rotationDuration);
    timeline.duration = totalDuration;
    timeline.looping = true;

    // Add streamline clip from the animation
    timeline.add(streamlineAnim.clip, { start: 0, end: 1 });

    // Rotation clip
    const rotationEnd = rotationDuration / totalDuration;
    timeline.add(
      {
        name: "SurfaceRotation",
        reduce(t: number) {
          const loops = totalDuration / rotationDuration;
          return { theta: ((t * loops) % 1) * 2 * Math.PI };
        },
      },
      { start: 0, end: rotationEnd }
    );

    timeline.onTick((_t, state) => {
      draw(state);
    });
  }

  function startAnimation() {
    if (timeline) timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx || !isInitialized || !streamlineAnim) return;

    const { streamlinePhase, theta } = state;

    ctx.clearRect(0, 0, width, height);

    // 1. Draw streamlines (behind) - using the animation's draw function
    streamlineAnim.draw(ctx, state);

    // 2. Draw surface curve (on top of streamlines)
    drawClosedCurve(ctx, curveFn, toPixel, {
      fillColor: surfaceFillColor,
      fillOpacity: surfaceOpacity,
      strokeColor: surfaceStrokeColor,
      strokeWidth: surfaceStrokeWidth,
    });

    // 3. Draw normal and field vectors at current theta position
    const { position, normal } = getTangentAndNormal(curveFn, theta);
    const [px, py] = toPixel(position);

    // Field vector at this position
    const field = vectorFieldFn(position[0], position[1]);
    const fieldMag = Math.sqrt(field[0] * field[0] + field[1] * field[1]);
    const fieldNorm: [number, number] =
      fieldMag > 0 ? [field[0] / fieldMag, field[1] / fieldMag] : [1, 0];

    // Scale vectors to pixel length (with scale factor)
    const vecPixelLen = scaleLength(vectorLength) * vectorScale;

    // Normal vector (pointing outward)
    const normalEnd: [number, number] = [
      px + normal[0] * vecPixelLen,
      py - normal[1] * vecPixelLen, // Flip y for canvas coordinates
    ];

    // Field vector
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

    // Field vector label (F) - blue with white outline
    const fieldLabelX = fieldEnd[0] + fieldNorm[0] * labelOffset;
    const fieldLabelY = fieldEnd[1] - fieldNorm[1] * labelOffset;
    drawMathjax(
      ctx,
      "\\mathbf{F}",
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
    if (showLabel && boundingBox) {
      const centerX = (boundingBox.xMin + boundingBox.xMax) / 2;
      const centerY = (boundingBox.yMin + boundingBox.yMax) / 2;
      const bbHeight = boundingBox.yMax - boundingBox.yMin;
      const labelY = centerY - surfaceLabelYOffset * bbHeight;
      const [slx, sly] = toPixel([centerX, labelY]);
      const labelHeight = surfaceLabelFontSize;

      drawMathjax(
        ctx,
        labelText,
        slx,
        sly + labelHeight / 2,
        surfaceLabelFontSize,
        0,
        0,
        {
          color: surfaceLabelColor,
          stroke: surfaceLabelStrokeColor,
          strokeWidth: surfaceLabelStrokeWidth,
          strokeOpacity: labelStrokeOpacity,
        }
      );
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function handleVisibilityChange(active: boolean) {
    if (!timeline) return;
    if (!active && timeline.isPlaying) {
      wasPlayingBeforeHidden = true;
      stopAnimation();
    } else if (active && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      startAnimation();
    }
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

  // Initialize when canvas is ready
  $: if (!isInitialized && canvas && curveFn && vectorFieldFn) {
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
    draw(timeline!.initialState);
    if (playingByDefault) startAnimation();
  }

  // Handle visibility changes
  $: if (isActive !== undefined && isInitialized) {
    handleVisibilityChange($isActive);
  }
</script>

<div class="surface-integral-wrapper">
  <div class="surface-integral-container">
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
    ></canvas>
  </div>
</div>

<style>
  .surface-integral-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }


  .surface-integral-container {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
  }
</style>
