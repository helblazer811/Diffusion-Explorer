<!-- Line integral visualization with streamlines and rotating F/dr vectors around curve C. -->

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
    computeBoundingBox,
    type CurveFn,
    type BoundingBox,
  } from "./stokes_theorem";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Curve and field functions from parent
  export let curveFn: CurveFn;
  export let vectorFieldFn: (x: number, y: number) => [number, number];

  // Layout
  export let width = 400;
  export let height = 350;

  // Domain margin around bounding box
  export let domainMargin = 0.7;

  // Surface label (drawn on canvas)
  export let showLabel = true;
  export let labelText = "C";
  export let surfaceLabelFontSize = 28;
  export let surfaceLabelColor = "#f97316";
  export let surfaceLabelStrokeColor = "white";
  export let surfaceLabelStrokeWidth = 15;
  export let surfaceLabelYOffset = -0.6;

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

  // Animation pulse settings
  export let pulseWidth = 0.2;
  export let pulsePauseWidth = 0.05;

  // Vector styling
  export let tangentColor = "#f97316"; // Orange for dr
  export let fieldColor = "#3b82f6"; // Blue for F
  export let dotColor = "#f97316";
  export let dotRadius = 4;
  export let vectorLength = 0.4;
  export let vectorScale = 1.2;
  export let vectorWidth = 3;
  export let arrowHeadSize = 8;

  // Label styling
  export let labelOffset = 20;
  export let labelFontSize = 18;
  export let labelStrokeColor = "white";
  export let labelStrokeWidth = 10;
  export let labelStrokeOpacity = 0.8;

  // Animation timing
  export let streamlineDuration = 8;
  export let rotationDuration = 8;
  export let playingByDefault = true;

  // Visibility
  export let isActive: import("svelte/store").Writable<boolean> | undefined =
    undefined;

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
    theta: number; // 0-2π for rotation around curve
  };

  let timeline: Timeline<AnimationState> | null = null;
  let streamlineAnim: StreamlineAnimation<AnimationState> | null = null;

  let boundingBox: BoundingBox | null = null;

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

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas) return;

    // Compute bounding box from curve
    boundingBox = computeBoundingBox(curveFn);

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
      pulseWidth,
      pulsePauseWidth,
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
        name: "CurveRotation",
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

    const { theta } = state;

    ctx.clearRect(0, 0, width, height);

    // 1. Draw streamlines (behind)
    streamlineAnim.draw(ctx, state);

    // 2. Draw white overlay between streamlines and surface
    ctx.fillStyle = "white";
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;

    // 3. Draw curve (on top of streamlines)
    drawClosedCurve(ctx, curveFn, toPixel, {
      fillColor: surfaceFillColor,
      fillOpacity: surfaceOpacity,
      strokeColor: surfaceStrokeColor,
      strokeWidth: surfaceStrokeWidth,
    });

    // 3. Draw tangent (dr) and field (F) vectors at current theta position
    const { position, tangent } = getTangentAndNormal(curveFn, theta);
    const [px, py] = toPixel(position);

    // Field vector at this position
    const field = vectorFieldFn(position[0], position[1]);
    const fieldMag = Math.sqrt(field[0] * field[0] + field[1] * field[1]);
    const fieldNorm: [number, number] =
      fieldMag > 0 ? [field[0] / fieldMag, field[1] / fieldMag] : [1, 0];

    // Scale vectors to pixel length
    const vecPixelLen = scaleLength(vectorLength) * vectorScale;

    // Tangent vector (dr) - pointing in direction of traversal
    const tangentEnd: [number, number] = [
      px + tangent[0] * vecPixelLen,
      py - tangent[1] * vecPixelLen, // Flip y for canvas coordinates
    ];

    // Field vector (F)
    const fieldEnd: [number, number] = [
      px + fieldNorm[0] * vecPixelLen,
      py - fieldNorm[1] * vecPixelLen,
    ];

    // Draw tangent vector dr (orange)
    ctx.strokeStyle = tangentColor;
    ctx.fillStyle = tangentColor;
    ctx.lineWidth = vectorWidth;
    drawArrow(ctx, px, py, tangentEnd[0], tangentEnd[1], arrowHeadSize);

    // Draw field vector F (blue)
    ctx.strokeStyle = fieldColor;
    ctx.fillStyle = fieldColor;
    ctx.lineWidth = vectorWidth;
    drawArrow(ctx, px, py, fieldEnd[0], fieldEnd[1], arrowHeadSize);

    // Draw point on curve (on top of arrows)
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(px, py, dotRadius, 0, 2 * Math.PI);
    ctx.fill();

    // Draw labels at arrow tips using MathJax
    // Tangent vector label (dr) - orange with white outline
    const tangentLabelX = tangentEnd[0] + tangent[0] * labelOffset;
    const tangentLabelY = tangentEnd[1] - tangent[1] * labelOffset;
    drawMathjax(
      ctx,
      "d\\mathbf{r}",
      tangentLabelX,
      tangentLabelY,
      labelFontSize,
      0,
      labelFontSize / 2,
      {
        color: tangentColor,
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

    // Curve label (C) - above the curve
    if (showLabel && boundingBox) {
      const centerX = (boundingBox.xMin + boundingBox.xMax) / 2;
      const centerY = (boundingBox.yMin + boundingBox.yMax) / 2;
      const bbHeight = boundingBox.yMax - boundingBox.yMin;
      const labelY = centerY - surfaceLabelYOffset * bbHeight;
      const [slx, sly] = toPixel([centerX, labelY]);
      const labelHeight = surfaceLabelFontSize;

      // Draw rounded rectangle background behind C
      const boxWidth = 36;
      const boxHeight = 36;
      const cornerRadius = 6;
      const boxX = slx - boxWidth / 2;
      const boxY = sly + labelHeight / 2 - boxHeight / 2 - 14; // Shifted up

      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, cornerRadius);
      ctx.fillStyle = "white";
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;

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

<div class="line-integral-wrapper">
  <div class="line-integral-container">
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
    ></canvas>
  </div>
</div>

<style>
  .line-integral-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  .line-integral-container {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
  }
</style>
