<!--
  DivergenceTheoremFigure

  Reusable two-pane figure for the divergence theorem:
    LEFT  — surface boundary with a rotating point that carries the outward normal
            `n̂` and field vector `F`. This is the SURFACE INTEGRAL side:
            ∮_∂V F · n̂ dS  (mirrors the MassConservation right pane).
    RIGHT — the SAME surface, subdivided into a grid of cells. Each cell carries
            four arrows pointing outward (a discrete "divergence at each cell").
            Arrows propagate outward from the central cell, illustrating that
            interior contributions are present everywhere but cancel pairwise on
            shared edges — only the outer boundary contributions survive,
            recovering the surface-integral side.
            Background: streamlines of the same vector field.

  Used twice in the post — once with a square boundary (showing a clean 3×3
  subdivision) and once with an irregular closed curve (to make the point that
  the theorem holds for arbitrary smooth shapes).
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    DoubleFigure,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
    StreamlineAnimation,
    drawArrow,
    drawMathjax,
    type StreamlineAnimationState,
  } from "@diffusion-explorer/ui";
  import {
    createWavyVectorField,
    getTangentAndNormal,
    drawClosedCurve,
    type CurveFn,
    type VectorFieldFn,
  } from "./DivergenceTheorem/divergence_theorem";
  import {
    sampleSurfacePoints,
    computeBoundingBox,
    isPointInside,
  } from "./DivergenceTheorem/grid-animation";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let curveFn: CurveFn;
  export let gridResolution = 3;
  export let vectorFieldFn: VectorFieldFn = createWavyVectorField({
    amplitude: 0.3,
    frequency: 1.5,
  });

  export let width = 800;
  export let height = 360;
  export let gap = 20;
  export let canvasWidth = 360;
  export let canvasHeight = 360;
  export let domainMargin = 0.12;

  // Surface styling
  export let surfaceFillColor = "#fff7ed";
  export let surfaceFillOpacity = 0.8;
  export let surfaceStrokeColor = "#f97316";
  export let surfaceStrokeWidth = 3;

  // Streamlines (CPU backend so it works without WebGPU)
  export let showStreamlines = true;
  export let streamlineColor = "#3b82f6";
  export let streamlineWidth = 3;
  export let streamlineDensity: number | [number, number] = 0.9;
  export let streamlineMinPathLength = 0.4;
  export let pulseWidthPixels = 24;
  export let pulsePauseWidthPixels = 6;
  // Semi-transparent overlay drawn between streamlines and the surface/grid layers
  // — mutes the streamlines visually so the foreground stands out.
  export let streamlineOverlayColor = "#ffffff";
  export let streamlineOverlayOpacity = 0.3;

  // Grid-cell arrows (right pane)
  export let cellArrowColor = "#1f2937";
  export let cellArrowStrokeWidth = 2;
  export let cellArrowHeadRadius = 4;
  export let cellArrowPadding = 0.32; // fraction of half-cell to leave as padding

  // Rotating normal / field vector (left pane)
  export let normalColor = "#f97316";
  export let fieldColor = "#3b82f6";
  export let vectorDomainLength = 0.22;
  export let vectorWidth = 3;
  export let vectorHeadSize = 6;
  export let dotColor = "#f97316";
  export let dotRadius = 4;
  export let labelFontSize = 18;
  export let labelStrokeColor = "white";
  export let labelStrokeWidth = 8;

  // Animation
  export let animationDuration = 8; // seconds for one cycle
  export let playingByDefault = true;

  // Caption slot
  export let children: import("svelte").Snippet | undefined = undefined;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let figureIsActive: Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // Canvases
  let leftCanvas: HTMLCanvasElement | null = null;
  let rightCanvas: HTMLCanvasElement | null = null;
  const leftCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  const rightCanvas2d = useCanvas2D(canvasWidth, canvasHeight);

  type AnimationState = StreamlineAnimationState & {
    theta: number; // 0..2π — position of the rotating point on the boundary (left)
    arrowPhase: number; // 0..1 — drives the propagating-arrow wave (right)
  };

  let timeline: Timeline<AnimationState> | null = null;
  let leftStreamlineAnim: StreamlineAnimation<AnimationState> | null = null;
  let rightStreamlineAnim: StreamlineAnimation<AnimationState> | null = null;

  let boundingBox: { xMin: number; xMax: number; yMin: number; yMax: number } | null = null;
  let isInitialized = false;

  // Cells inside the surface, pre-computed
  type Cell = {
    center: [number, number];
    cellWidthDomain: number;
    cellHeightDomain: number;
    distanceFromCenter: number;
  };
  let cells: Cell[] = [];
  let maxCellDistance = 0;

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
      ((p[0] - xMin) / (xMax - xMin)) * canvasWidth,
      ((yMax - p[1]) / (yMax - yMin)) * canvasHeight,
    ];
  }

  function scaleLength(domainLen: number): number {
    if (!boundingBox) return 0;
    const domainWidth = boundingBox.xMax - boundingBox.xMin + 2 * domainMargin;
    return (domainLen / domainWidth) * canvasWidth;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function computeGridCells() {
    const surfaceSamples = sampleSurfacePoints(curveFn, 360);
    const bbox = computeBoundingBox(surfaceSamples.points);

    const dimX = bbox.xMax - bbox.xMin;
    const dimY = bbox.yMax - bbox.yMin;
    const maxDim = Math.max(dimX, dimY);
    const step = maxDim / gridResolution;

    // Center the grid in the bbox center
    const cx = (bbox.xMin + bbox.xMax) / 2;
    const cy = (bbox.yMin + bbox.yMax) / 2;
    const totalGridSize = step * gridResolution;
    const gridXMin = cx - totalGridSize / 2;
    const gridYMin = cy - totalGridSize / 2;

    const candidate: { center: [number, number]; row: number; col: number }[] = [];
    for (let row = 0; row < gridResolution; row++) {
      for (let col = 0; col < gridResolution; col++) {
        const xMin = gridXMin + col * step;
        const xMax = gridXMin + (col + 1) * step;
        const yMin = gridYMin + row * step;
        const yMax = gridYMin + (row + 1) * step;
        const center: [number, number] = [(xMin + xMax) / 2, (yMin + yMax) / 2];

        // Keep cell if center AND all 4 corners are inside the curve
        if (!isPointInside(center, surfaceSamples)) continue;
        const corners: [number, number][] = [
          [xMin, yMin],
          [xMax, yMin],
          [xMin, yMax],
          [xMax, yMax],
        ];
        if (!corners.every((c) => isPointInside(c, surfaceSamples))) continue;
        candidate.push({ center, row, col });
      }
    }

    // Pick the cell whose center is closest to the boundingBox center as the wave origin
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < candidate.length; i++) {
      const dx = candidate[i].center[0] - cx;
      const dy = candidate[i].center[1] - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        bestIdx = i;
      }
    }
    const originCell = candidate[bestIdx];

    cells = candidate.map((c) => {
      const d = Math.abs(c.row - originCell.row) + Math.abs(c.col - originCell.col);
      return {
        center: c.center,
        cellWidthDomain: step,
        cellHeightDomain: step,
        distanceFromCenter: d,
      };
    });
    maxCellDistance = cells.reduce((m, c) => Math.max(m, c.distanceFromCenter), 0);

    return bbox;
  }

  async function runInitialComputation() {
    boundingBox = computeGridCells();

    if (showStreamlines) {
      const domain = {
        xMin: boundingBox.xMin - domainMargin,
        xMax: boundingBox.xMax + domainMargin,
        yMin: boundingBox.yMin - domainMargin,
        yMax: boundingBox.yMax + domainMargin,
      };

      // One streamline animation per canvas (each owns its own canvas + RAF state).
      // CPU backend so streamlines share the Canvas2D context with the surface + grid
      // — pulses are computed via alpha LUTs and look fine, no second canvas needed.
      const totalDuration = animationDuration;
      const streamlineCommon = {
        backend: "cpu" as const,
        vectorFieldFn,
        domain,
        toPixel: (p: [number, number]) => toPixel(p),
        density: streamlineDensity,
        minPathLength: streamlineMinPathLength,
        color: streamlineColor,
        strokeWidth: streamlineWidth,
        pulseWidthPixels,
        pulsePauseWidthPixels,
        offsets: "synchronized" as const,
        duration: totalDuration,
        pulseFrequency: 0.5,
      };
      leftStreamlineAnim = StreamlineAnimation.create<AnimationState>(streamlineCommon);
      rightStreamlineAnim = StreamlineAnimation.create<AnimationState>(streamlineCommon);

      if (leftCanvas) await leftStreamlineAnim.init(leftCanvas);
      if (rightCanvas) await rightStreamlineAnim.init(rightCanvas);
    }
  }

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = {
      streamlinePhase: 0,
      theta: 0,
      arrowPhase: 0,
    };
    timeline.duration = animationDuration;
    timeline.looping = true;

    // Streamline clip: sets `streamlinePhase` on the state (drives pulse position).
    // We add one — both panes' animations read the same `streamlinePhase` and render
    // in sync.
    if (leftStreamlineAnim) {
      timeline.add(leftStreamlineAnim.clip, { start: 0, end: 1 });
    }

    // Our own clip: surface rotation + propagating arrow wave.
    timeline.add(
      {
        name: "DivergenceTheoremCycle",
        reduce(t: number): Partial<AnimationState> {
          return {
            theta: t * 2 * Math.PI,
            arrowPhase: t,
          };
        },
      },
      { start: 0, end: 1 }
    );

    timeline.onTick((_, state) => {
      drawLeft(state);
      drawRight(state);
    });
  }

  function startAnimation() {
    if (timeline) timeline.play();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawSurface(ctx: CanvasRenderingContext2D) {
    drawClosedCurve(ctx, curveFn, (p) => toPixel(p), {
      fillColor: surfaceFillColor,
      fillOpacity: surfaceFillOpacity,
      strokeColor: surfaceStrokeColor,
      strokeWidth: surfaceStrokeWidth,
    });
  }

  /**
   * Paint a semi-transparent rectangle over the streamlines so the surface,
   * grid, and arrows on top read more clearly.
   */
  function drawStreamlineOverlay(ctx: CanvasRenderingContext2D) {
    if (streamlineOverlayOpacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = streamlineOverlayOpacity;
    ctx.fillStyle = streamlineOverlayColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  }

  function drawLeft(state: AnimationState) {
    const ctx = leftCanvas2d.ctx;
    if (!ctx || !boundingBox) return;

    // Always clear first — the CPU StreamlineAnimation doesn't clear for us, so
    // skipping this leaves trails of every previous frame on the canvas.
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // 1. Streamlines behind (drawn to leftCanvas via leftStreamlineAnim)
    if (showStreamlines && leftStreamlineAnim?.initialized) {
      leftStreamlineAnim.draw(state, [0, 0, 0, 0]);
    }

    // 2. Muting overlay between streamlines and foreground
    drawStreamlineOverlay(ctx);

    // 3. Surface fill + outline
    drawSurface(ctx);

    // 4. Rotating boundary point with outward normal `n̂` and field vector `F`
    const { theta, position, normal } = getTangentAndNormalSafe(state.theta);
    const [px, py] = toPixel(position);

    const v = vectorFieldFn(position[0], position[1]);
    const vMag = Math.hypot(v[0], v[1]);
    const vUnit: [number, number] = vMag > 0 ? [v[0] / vMag, v[1] / vMag] : [1, 0];
    const pixelLen = scaleLength(vectorDomainLength);

    // Normal (outward, orange). y is flipped because canvas y grows downward.
    const nEnd: [number, number] = [px + normal[0] * pixelLen, py - normal[1] * pixelLen];
    ctx.save();
    ctx.strokeStyle = normalColor;
    ctx.fillStyle = normalColor;
    ctx.lineWidth = vectorWidth;
    drawArrow(ctx, px, py, nEnd[0], nEnd[1], vectorHeadSize);

    // Field vector (blue)
    const fEnd: [number, number] = [px + vUnit[0] * pixelLen, py - vUnit[1] * pixelLen];
    ctx.strokeStyle = fieldColor;
    ctx.fillStyle = fieldColor;
    drawArrow(ctx, px, py, fEnd[0], fEnd[1], vectorHeadSize);

    // Point
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(px, py, dotRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();

    // Labels (n̂ and F)
    drawMathjax(
      ctx,
      "\\hat{n}",
      nEnd[0] + normal[0] * 14,
      nEnd[1] - normal[1] * 14,
      labelFontSize,
      0,
      labelFontSize / 2,
      { color: normalColor, stroke: labelStrokeColor, strokeWidth: labelStrokeWidth, strokeOpacity: 0.9 }
    );
    drawMathjax(
      ctx,
      "\\mathbf{F}",
      fEnd[0] + vUnit[0] * 14,
      fEnd[1] - vUnit[1] * 14,
      labelFontSize,
      0,
      labelFontSize / 2,
      { color: fieldColor, stroke: labelStrokeColor, strokeWidth: labelStrokeWidth, strokeOpacity: 0.9 }
    );

    void theta; // (used only to convey that the rotation tracks state.theta)
  }

  function getTangentAndNormalSafe(thetaRad: number) {
    const r = getTangentAndNormal(curveFn, thetaRad);
    return { theta: thetaRad, position: r.position, normal: r.normal };
  }

  function drawRight(state: AnimationState) {
    const ctx = rightCanvas2d.ctx;
    if (!ctx || !boundingBox) return;

    // Always clear first (see drawLeft note).
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // 1. Streamlines behind
    if (showStreamlines && rightStreamlineAnim?.initialized) {
      rightStreamlineAnim.draw(state, [0, 0, 0, 0]);
    }

    // 2. Muting overlay between streamlines and foreground
    drawStreamlineOverlay(ctx);

    // 3. Surface fill + outline
    drawSurface(ctx);

    // 4. Grid cells with outward-propagating arrows
    ctx.save();
    ctx.strokeStyle = cellArrowColor;
    ctx.fillStyle = cellArrowColor;
    ctx.lineWidth = cellArrowStrokeWidth;

    // The wave sweeps across the cells over one full cycle.
    // For each cell, the local phase is shifted by its distance from the central cell.
    const denom = Math.max(maxCellDistance + 1, 1);

    for (const cell of cells) {
      // Local phase t in [0, 1] driven by global arrowPhase, advanced earlier for closer cells.
      const offset = cell.distanceFromCenter / denom;
      let local = state.arrowPhase - offset;
      local = local - Math.floor(local); // wrap to [0, 1)

      // Pulse profile: grow from 0 → 1 in first half, then decay back to 0.
      // Smooth bell so arrows don't snap at the wrap.
      const pulse = Math.max(0, Math.sin(local * Math.PI));

      const [cxPx, cyPx] = toPixel(cell.center);
      const halfWPx = scaleLength(cell.cellWidthDomain / 2) * (1 - cellArrowPadding);
      const halfHPx = scaleLength(cell.cellHeightDomain / 2) * (1 - cellArrowPadding);

      // Four cardinal arrows from the center
      const dirs: [number, number, number][] = [
        [1, 0, halfWPx], // right
        [-1, 0, halfWPx], // left
        [0, -1, halfHPx], // up (canvas y is flipped)
        [0, 1, halfHPx], // down
      ];

      ctx.globalAlpha = 0.25 + 0.75 * pulse; // always faintly visible, brighter when pulse fires
      for (const [dx, dy, lenMax] of dirs) {
        const len = lenMax * (0.15 + 0.85 * pulse); // grow with the pulse
        drawArrow(ctx, cxPx, cyPx, cxPx + dx * len, cyPx + dy * len, cellArrowHeadRadius);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) timeline.pause();
  });

  // Initialize once the canvases are bound
  $: if (
    !isInitialized &&
    leftCanvas &&
    rightCanvas &&
    leftCanvas2d.ctx &&
    rightCanvas2d.ctx
  ) {
    isInitialized = true;
    runInitialComputation().then(() => {
      setupTimeline();
      if (timeline) {
        drawLeft(timeline.initialState);
        drawRight(timeline.initialState);
        if (playingByDefault) startAnimation();
      }
    });
  }

  // Pause/resume based on viewport visibility
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  // Caption slot
  $: caption = children;
</script>

<DoubleFigure {gap} {caption} backgroundVisible={false} bind:isActive={figureIsActive}>
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
</DoubleFigure>
