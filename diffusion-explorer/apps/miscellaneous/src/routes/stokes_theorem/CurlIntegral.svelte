<!-- Curl integral visualization with rotating arrows showing curl at interior points. -->

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
    drawClosedCurve,
    computeBoundingBox,
    computeCurl,
    sampleInteriorPoints,
    isPointInside,
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
  export let labelText = "S";
  export let surfaceLabelFontSize = 28;
  export let surfaceLabelColor = "#f97316";
  export let surfaceLabelStrokeColor = "white";
  export let surfaceLabelStrokeWidth = 15;
  export let labelExclusionRadius = 0.3; // Domain units - exclude curl points near label

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

  // Curl arrow styling
  export let curlArrowColor = "#f97316"; // Orange
  export let curlCircleRadius = 12; // Radius of the rotation circle in pixels
  export let curlArrowArcAngle = 2 * Math.PI * 0.6; // Arc length in radians (60% of full circle)
  export let curlArrowHeadSize = 5;
  export let curlArrowWidth = 2;
  export let minCircleSpacing = 1.4; // Minimum spacing between circles (multiplier of circle diameter)
  export let boundaryMargin = 0.15; // Extra margin from surface boundary in domain units
  export let numCandidates = 200; // Number of uniform candidate points to sample

  // Label styling
  export let labelStrokeOpacity = 0.8;

  // Animation timing
  export let streamlineDuration = 8;
  export let rotationsPerCycle = 3; // Number of full curl arrow rotations per animation
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

  // Animation state
  type AnimationState = StreamlineAnimationState & {
    curlRotationAngle: number; // Rotation angle in radians
  };

  let timeline: Timeline<AnimationState> | null = null;
  let streamlineAnim: StreamlineAnimation<AnimationState> | null = null;

  let boundingBox: BoundingBox | null = null;

  // Pre-computed curl points
  let curlPoints: Array<{
    position: [number, number];
    pixelPos: [number, number];
    curl: number;
  }> = [];

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

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas) return;

    // Compute bounding box from curve
    boundingBox = computeBoundingBox(curveFn);

    // Convert circle radius from pixels to domain units
    const domainWidth = boundingBox.xMax - boundingBox.xMin + 2 * domainMargin;
    const circleRadiusDomain = (curlCircleRadius / width) * domainWidth;

    // Minimum distance between circle centers
    const minDist = circleRadiusDomain * 2 * minCircleSpacing;

    // Center of the surface (for label exclusion)
    const centerX = (boundingBox.xMin + boundingBox.xMax) / 2;
    const centerY = (boundingBox.yMin + boundingBox.yMax) / 2;

    const { xMin, xMax, yMin, yMax } = boundingBox;
    const placedPoints: Array<[number, number]> = [];

    // Generate uniform candidate points in bounding box
    const candidates: Array<[number, number]> = [];
    const gridSize = Math.ceil(Math.sqrt(numCandidates));
    const stepX = (xMax - xMin) / gridSize;
    const stepY = (yMax - yMin) / gridSize;

    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const x = xMin + (i + 0.5) * stepX;
        const y = yMin + (j + 0.5) * stepY;
        candidates.push([x, y]);
      }
    }

    // Shuffle candidates for random selection order
    let seed = 98765;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    // Try to place circles from shuffled candidates
    for (const point of candidates) {
      const [x, y] = point;

      // Check if circle fits inside surface (check boundary with margin)
      const totalMargin = circleRadiusDomain + boundaryMargin;
      if (!isPointInside(curveFn, point, totalMargin)) {
        continue;
      }

      // Check distance from center (label exclusion - include circle radius)
      const dxCenter = x - centerX;
      const dyCenter = y - centerY;
      const distCenter = Math.sqrt(dxCenter * dxCenter + dyCenter * dyCenter);
      if (distCenter < labelExclusionRadius + circleRadiusDomain) {
        continue;
      }

      // Check collision with existing circles
      let collides = false;
      for (const existing of placedPoints) {
        const dx = x - existing[0];
        const dy = y - existing[1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) {
          collides = true;
          break;
        }
      }

      if (!collides) {
        placedPoints.push(point);
      }
    }

    curlPoints = placedPoints.map((pos) => ({
      position: pos,
      pixelPos: toPixel(pos),
      curl: computeCurl(vectorFieldFn, pos[0], pos[1]),
    }));

    // Create streamline animation
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
      loopMultiplier: 1,
    });
  }

  function setupTimeline() {
    if (!streamlineAnim) return;

    timeline = new Timeline<AnimationState>();
    timeline.initialState = { streamlinePhase: 0, curlRotationAngle: 0 };
    timeline.duration = streamlineDuration;
    timeline.looping = true;

    // Add streamline clip
    timeline.add(streamlineAnim.clip, { start: 0, end: 1 });

    // Curl rotation clip
    timeline.add(
      {
        name: "CurlRotation",
        reduce(t: number) {
          return { curlRotationAngle: t * rotationsPerCycle * 2 * Math.PI };
        },
      },
      { start: 0, end: 1 }
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

  /**
   * Draw a curved arrow along a circular arc.
   * @param center - Center of the rotation circle in pixel coords
   * @param curl - Curl value (sign determines direction: positive=CCW, negative=CW)
   * @param startAngle - Starting angle of the arc in radians (animated)
   */
  function drawCurlArrow(
    center: [number, number],
    curl: number,
    startAngle: number
  ) {
    if (!ctx) return;

    const [cx, cy] = center;
    const radius = curlCircleRadius;

    // All arrows rotate counter-clockwise
    const direction = 1;
    const arcAngle = curlArrowArcAngle;

    // Compute start and end angles for the arc
    // startAngle is animated, arcAngle is how much of circle to draw
    const animatedStart = startAngle * direction;
    const arcStart = animatedStart;
    const arcEnd = animatedStart + arcAngle * direction;

    // Draw the arc path
    ctx.strokeStyle = curlArrowColor;
    ctx.lineWidth = curlArrowWidth;
    ctx.lineCap = "round";
    ctx.beginPath();

    // Canvas arc uses clockwise as positive, but we want standard math convention
    // where positive angle is CCW. Canvas y is flipped, so we need to negate.
    if (direction > 0) {
      // CCW in math = CW in canvas (because y is flipped)
      ctx.arc(cx, cy, radius, -arcStart, -arcEnd, true);
    } else {
      // CW in math = CCW in canvas
      ctx.arc(cx, cy, radius, -arcStart, -arcEnd, false);
    }
    ctx.stroke();

    // Draw arrowhead with base centered at arc end
    const endAngle = arcEnd;
    const baseX = cx + radius * Math.cos(endAngle);
    const baseY = cy - radius * Math.sin(endAngle); // Flip y for canvas

    // Tangent direction at the arc end (perpendicular to radius)
    // For CCW, tangent points in +angle direction
    const tangentAngle = endAngle + (direction > 0 ? Math.PI / 2 : -Math.PI / 2);

    // Draw arrowhead (equilateral triangle with base centered at arc end)
    ctx.fillStyle = curlArrowColor;
    const headLength = curlArrowHeadSize;
    const headAngle = Math.PI / 6; // 30 degrees for equilateral

    // Tip of triangle is forward along tangent
    const tipX = baseX + headLength * Math.cos(tangentAngle);
    const tipY = baseY - headLength * Math.sin(tangentAngle);

    // Base corners perpendicular to tangent
    const baseHalfWidth = headLength * Math.tan(headAngle);
    const perpAngle = tangentAngle + Math.PI / 2;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      baseX + baseHalfWidth * Math.cos(perpAngle),
      baseY - baseHalfWidth * Math.sin(perpAngle)
    );
    ctx.lineTo(
      baseX - baseHalfWidth * Math.cos(perpAngle),
      baseY + baseHalfWidth * Math.sin(perpAngle)
    );
    ctx.closePath();
    ctx.fill();
  }

  function draw(state: AnimationState) {
    if (!ctx || !isInitialized || !streamlineAnim) return;

    const { curlRotationAngle } = state;

    ctx.clearRect(0, 0, width, height);

    // 1. Draw streamlines (behind)
    streamlineAnim.draw(ctx, state);

    // 2. Draw white overlay between streamlines and surface
    ctx.fillStyle = "white";
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;

    // 3. Draw surface fill
    drawClosedCurve(ctx, curveFn, toPixel, {
      fillColor: surfaceFillColor,
      fillOpacity: surfaceOpacity,
      strokeColor: surfaceStrokeColor,
      strokeWidth: surfaceStrokeWidth,
    });

    // 3. Draw curl arrows at each sampled point
    for (const { pixelPos, curl } of curlPoints) {
      // Skip points with negligible curl
      if (Math.abs(curl) < 0.1) continue;
      drawCurlArrow(pixelPos, curl, curlRotationAngle);
    }

    // 4. Surface label (S) - centered in the surface, shifted down slightly
    if (showLabel && boundingBox) {
      const centerX = (boundingBox.xMin + boundingBox.xMax) / 2;
      const centerY = (boundingBox.yMin + boundingBox.yMax) / 2;
      const labelYOffset = -0.25; // Shift down (negative Y in domain = down in canvas)
      const [slx, sly] = toPixel([centerX, centerY + labelYOffset]);

      drawMathjax(
        ctx,
        labelText,
        slx,
        sly,
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

<div class="curl-integral-wrapper">
  <div class="curl-integral-container">
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
    ></canvas>
  </div>
</div>

<style>
  .curl-integral-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  .curl-integral-container {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
  }
</style>
