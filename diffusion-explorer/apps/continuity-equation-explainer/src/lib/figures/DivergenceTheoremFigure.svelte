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
    type StreamlineAnimationState,
  } from "@diffusion-explorer/ui";
  import {
    createWavyVectorField,
    drawClosedCurve,
    type CurveFn,
    type VectorFieldFn,
  } from "./DivergenceTheorem/divergence_theorem";
  import {
    sampleSurfacePoints,
    computeBoundingBox,
    isPointInside,
  } from "./DivergenceTheorem/grid-animation";
  import {
    WaveCancellationAnimation,
    type GridCellSpec,
  } from "./DivergenceTheoremSquare/wave-cancellation-animation";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let curveFn: CurveFn;
  export let gridResolution = 3;
  // The RHS pane shows the SAME wave-cancellation visualization as the LHS,
  // but on a more complex closed curve with finer subdivisions — making the
  // point that the divergence theorem works for arbitrary shapes. If
  // rightCurveFn is null we fall back to curveFn (matching the original
  // single-shape behavior).
  export let rightCurveFn: CurveFn | null = null;
  export let rightGridResolution = 6;
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

  // Streamlines (GPU backend, rendered to its own canvas behind the 2D overlay)
  export let showStreamlines = true;
  export let streamlineColor = "#3b82f6";
  export let streamlineWidth = 3;
  // Density + min path length matched to MassConservation so streamlines look like
  // long flowing curves rather than chunky stubs at the same visual scale.
  export let streamlineDensity: number | [number, number] = 0.8;
  export let streamlineMinPathLength = 1.5;
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

  // Subdivision lines on the LHS rectangle (the 3×3 grid lines).
  export let subdivisionColor = "#f97316";
  export let subdivisionWidth = 1.5;
  export let subdivisionOpacity = 0.45;

  // Animation
  export let animationDuration = 8; // seconds for one cycle (rotating point + arrow wave)
  // Pulse frequency: number of pulse cycles per timeline loop. MUST satisfy
  // pulseFrequency × animationDuration ∈ ℤ to avoid a phase discontinuity at the
  // loop boundary (otherwise the pulse jumps backward each loop).
  // 0.5 × 8 = 4 → seamless. Pulse cycle = animationDuration / 4 = 2 s, matching
  // MassConservation's streamline pace.
  export let streamlinePulseFrequency = 0.5;
  export let playingByDefault = true;

  // Caption slot
  export let children: import("svelte").Snippet | undefined = undefined;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let figureIsActive: Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // Canvases — dual-canvas pattern matching MassConservation:
  //   - leftGpuCanvas / rightGpuCanvas: WebGPU surfaces for the streamline pulses
  //   - leftCanvas / rightCanvas: Canvas2D overlays for the surface, grid, arrows
  // Stacked via CSS so the streamlines sit behind everything else.
  let leftGpuCanvas: HTMLCanvasElement | null = null;
  let rightGpuCanvas: HTMLCanvasElement | null = null;
  let leftCanvas: HTMLCanvasElement | null = null;
  let rightCanvas: HTMLCanvasElement | null = null;
  const leftCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  const rightCanvas2d = useCanvas2D(canvasWidth, canvasHeight);

  type AnimationState = StreamlineAnimationState & {
    wavePhase: number; // 0..1 — drives the wave-cancellation animation (left)
    arrowPhase: number; // 0..1 — drives the propagating-arrow wave (right)
  };

  let timeline: Timeline<AnimationState> | null = null;
  let leftStreamlineAnim: StreamlineAnimation<AnimationState> | null = null;
  let rightStreamlineAnim: StreamlineAnimation<AnimationState> | null = null;
  let leftWaveAnim: WaveCancellationAnimation<AnimationState> | null = null;
  let rightWaveAnim: WaveCancellationAnimation<AnimationState> | null = null;

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

  /**
   * Build a fixed 3×3 grid for the LEFT pane's wave-cancellation animation.
   * Unlike the right pane's grid, this one always uses all 9 cells regardless
   * of curve shape — the wave-cancellation viz is fundamentally about the
   * 3×3 arrow topology, not whether the cells lie inside the boundary.
   */
  function buildLeftGrid(): { cells: GridCellSpec[]; cellSizePx: number } {
    if (!boundingBox) return { cells: [], cellSizePx: 0 };
    const dimX = boundingBox.xMax - boundingBox.xMin;
    const dimY = boundingBox.yMax - boundingBox.yMin;
    const maxDim = Math.max(dimX, dimY);
    const step = maxDim / 3;
    const cx = (boundingBox.xMin + boundingBox.xMax) / 2;
    const cy = (boundingBox.yMin + boundingBox.yMax) / 2;
    const gridXMin = cx - (step * 3) / 2;
    const gridYMin = cy - (step * 3) / 2;

    const out: GridCellSpec[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const centerDomain: [number, number] = [
          gridXMin + (col + 0.5) * step,
          gridYMin + (row + 0.5) * step,
        ];
        const [pxX, pxY] = toPixel(centerDomain);
        out.push({ cx: pxX, cy: pxY, row, col });
      }
    }
    return { cells: out, cellSizePx: scaleLength(step) };
  }

  /**
   * Build the RHS wave-cancellation grid: tile the bounding box with
   * rightGridResolution × rightGridResolution cells, keep those fully inside
   * the right curve, and pick the cell closest to the bbox center as the
   * wave origin. Returns cell specs in pixel coordinates.
   */
  function buildRightGrid(): {
    cells: GridCellSpec[];
    cellSizePx: number;
    centerCell: { row: number; col: number };
  } {
    const rCurve = rightCurveFn ?? curveFn;
    const surfaceSamples = sampleSurfacePoints(rCurve, 360);
    const bbox = computeBoundingBox(surfaceSamples.points);

    const dimX = bbox.xMax - bbox.xMin;
    const dimY = bbox.yMax - bbox.yMin;
    const maxDim = Math.max(dimX, dimY);
    const step = maxDim / rightGridResolution;
    const cx = (bbox.xMin + bbox.xMax) / 2;
    const cy = (bbox.yMin + bbox.yMax) / 2;
    const totalGridSize = step * rightGridResolution;
    const gridXMin = cx - totalGridSize / 2;
    const gridYMin = cy - totalGridSize / 2;

    type Candidate = { center: [number, number]; row: number; col: number };
    const candidates: Candidate[] = [];
    for (let row = 0; row < rightGridResolution; row++) {
      for (let col = 0; col < rightGridResolution; col++) {
        const xMin = gridXMin + col * step;
        const xMax = xMin + step;
        const yMin = gridYMin + row * step;
        const yMax = yMin + step;
        const center: [number, number] = [(xMin + xMax) / 2, (yMin + yMax) / 2];
        if (!isPointInside(center, surfaceSamples)) continue;
        const corners: [number, number][] = [
          [xMin, yMin],
          [xMax, yMin],
          [xMin, yMax],
          [xMax, yMax],
        ];
        if (!corners.every((c) => isPointInside(c, surfaceSamples))) continue;
        candidates.push({ center, row, col });
      }
    }

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const dx = candidates[i].center[0] - cx;
      const dy = candidates[i].center[1] - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        bestIdx = i;
      }
    }
    const origin = candidates[bestIdx] ?? { row: 0, col: 0 };

    const cellSpecs: GridCellSpec[] = candidates.map((c) => {
      const [pxX, pxY] = toPixel(c.center);
      return { cx: pxX, cy: pxY, row: c.row, col: c.col };
    });

    return {
      cells: cellSpecs,
      cellSizePx: scaleLength(step),
      centerCell: { row: origin.row, col: origin.col },
    };
  }

  async function runInitialComputation() {
    boundingBox = computeGridCells();

    // Build the LEFT pane's wave-cancellation animation on a 3×3 grid.
    const leftGrid = buildLeftGrid();
    leftWaveAnim = WaveCancellationAnimation.create<AnimationState>({
      cells: leftGrid.cells,
      gridResolution: 3,
      centerCell: { row: 1, col: 1 },
      cellSizePx: leftGrid.cellSizePx,
      arrowPadding: cellArrowPadding,
      color: cellArrowColor,
      strokeWidth: cellArrowStrokeWidth,
      headRadius: cellArrowHeadRadius,
    });
    if (leftCanvas) await leftWaveAnim.init(leftCanvas);

    // Build the RHS pane's wave-cancellation animation on a finer grid filtered
    // to the right curve's interior. Cells along the curve naturally pick up
    // "boundary" status (their outward direction has no neighbor).
    const rightGrid = buildRightGrid();
    if (rightGrid.cells.length > 0) {
      rightWaveAnim = WaveCancellationAnimation.create<AnimationState>({
        cells: rightGrid.cells,
        gridResolution: rightGridResolution,
        centerCell: rightGrid.centerCell,
        cellSizePx: rightGrid.cellSizePx,
        arrowPadding: cellArrowPadding,
        color: cellArrowColor,
        strokeWidth: cellArrowStrokeWidth,
        headRadius: cellArrowHeadRadius,
      });
      if (rightCanvas) await rightWaveAnim.init(rightCanvas);
    }

    if (showStreamlines) {
      const domain = {
        xMin: boundingBox.xMin - domainMargin,
        xMax: boundingBox.xMax + domainMargin,
        yMin: boundingBox.yMin - domainMargin,
        yMax: boundingBox.yMax + domainMargin,
      };

      // GPU backend (same as MassConservation) so pulses flow smoothly with per-pixel
      // alpha gradients. Each streamline animation gets its own dedicated GPU canvas
      // so the Canvas2D overlay (surface + grid + vectors) doesn't fight the WebGPU
      // context for the same canvas.
      //
      // Critical: size the GPU canvas's internal pixel buffer ourselves before
      // create(). HTML canvases default to 300×150; without this the WebGPU surface
      // renders at that scale and the streamlines look badly zoomed.
      const dpr = window.devicePixelRatio || 1;
      if (leftGpuCanvas) {
        leftGpuCanvas.width = canvasWidth * dpr;
        leftGpuCanvas.height = canvasHeight * dpr;
      }
      if (rightGpuCanvas) {
        rightGpuCanvas.width = canvasWidth * dpr;
        rightGpuCanvas.height = canvasHeight * dpr;
      }

      // Pass animationDuration as the streamline duration (matches the timeline's
      // duration) so loopMultiplier = pulseFrequency × duration is an integer and
      // streamlinePhase wraps from exactly N → 0 at the loop boundary — no stutter.
      const streamlineCommon = {
        backend: "gpu" as const,
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
        duration: animationDuration,
        pulseFrequency: streamlinePulseFrequency,
      };
      leftStreamlineAnim = StreamlineAnimation.create<AnimationState>(streamlineCommon);
      rightStreamlineAnim = StreamlineAnimation.create<AnimationState>(streamlineCommon);

      if (leftGpuCanvas) await leftStreamlineAnim.init(leftGpuCanvas);
      if (rightGpuCanvas) await rightStreamlineAnim.init(rightGpuCanvas);
    }
  }

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = {
      streamlinePhase: 0,
      wavePhase: 0,
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

    // Our own clip: wave-cancellation phase (left) + propagating arrow wave (right).
    timeline.add(
      {
        name: "DivergenceTheoremCycle",
        reduce(t: number): Partial<AnimationState> {
          return {
            wavePhase: t,
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

  function drawSurface(ctx: CanvasRenderingContext2D, curve: CurveFn = curveFn) {
    drawClosedCurve(ctx, curve, (p) => toPixel(p), {
      fillColor: surfaceFillColor,
      fillOpacity: surfaceFillOpacity,
      strokeColor: surfaceStrokeColor,
      strokeWidth: surfaceStrokeWidth,
    });
  }

  /**
   * Draw the RHS subdivision lines clipped to the right curve's interior.
   * The grid matches buildRightGrid: a rightGridResolution × rightGridResolution
   * tiling of the curve's bounding box, with lines visible only where the
   * curve covers them.
   */
  function drawRightSubdivisions(ctx: CanvasRenderingContext2D) {
    if (!boundingBox) return;
    const rCurve = rightCurveFn ?? curveFn;

    ctx.save();
    // Clip to the right curve's interior so grid lines only appear inside it.
    ctx.beginPath();
    const samples = 360;
    for (let i = 0; i <= samples; i++) {
      const theta = (i / samples) * 2 * Math.PI;
      const [px, py] = toPixel(rCurve(theta));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.clip();

    // Build the same grid layout used by buildRightGrid.
    const surfaceSamples = sampleSurfacePoints(rCurve, 360);
    const bbox = computeBoundingBox(surfaceSamples.points);
    const dimX = bbox.xMax - bbox.xMin;
    const dimY = bbox.yMax - bbox.yMin;
    const maxDim = Math.max(dimX, dimY);
    const step = maxDim / rightGridResolution;
    const cx = (bbox.xMin + bbox.xMax) / 2;
    const cy = (bbox.yMin + bbox.yMax) / 2;
    const totalGridSize = step * rightGridResolution;
    const gridXMin = cx - totalGridSize / 2;
    const gridYMin = cy - totalGridSize / 2;

    ctx.strokeStyle = subdivisionColor;
    ctx.lineWidth = subdivisionWidth;
    ctx.globalAlpha = subdivisionOpacity;

    for (let i = 1; i < rightGridResolution; i++) {
      const xDom = gridXMin + i * step;
      const [x1, y1] = toPixel([xDom, gridYMin]);
      const [x2, y2] = toPixel([xDom, gridYMin + totalGridSize]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const yDom = gridYMin + i * step;
      const [hx1, hy1] = toPixel([gridXMin, yDom]);
      const [hx2, hy2] = toPixel([gridXMin + totalGridSize, yDom]);
      ctx.beginPath();
      ctx.moveTo(hx1, hy1);
      ctx.lineTo(hx2, hy2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draw the 3×3 subdivision lines that match the LHS wave-cancellation grid.
   * The grid is centered on the bounding box and uses max(width, height) / 3
   * as the cell size, matching `buildLeftGrid`.
   */
  function drawLeftSubdivisions(ctx: CanvasRenderingContext2D) {
    if (!boundingBox) return;
    const cx = (boundingBox.xMin + boundingBox.xMax) / 2;
    const cy = (boundingBox.yMin + boundingBox.yMax) / 2;
    const dim = Math.max(
      boundingBox.xMax - boundingBox.xMin,
      boundingBox.yMax - boundingBox.yMin
    );
    const step = dim / 3;
    const gridXMin = cx - step * 1.5;
    const gridYMin = cy - step * 1.5;
    const gridXMax = gridXMin + 3 * step;
    const gridYMax = gridYMin + 3 * step;

    ctx.save();
    ctx.strokeStyle = subdivisionColor;
    ctx.lineWidth = subdivisionWidth;
    ctx.globalAlpha = subdivisionOpacity;

    for (let i = 1; i < 3; i++) {
      const xDomain = gridXMin + i * step;
      const [x1, y1] = toPixel([xDomain, gridYMin]);
      const [x2, y2] = toPixel([xDomain, gridYMax]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const yDomain = gridYMin + i * step;
      const [hx1, hy1] = toPixel([gridXMin, yDomain]);
      const [hx2, hy2] = toPixel([gridXMax, yDomain]);
      ctx.beginPath();
      ctx.moveTo(hx1, hy1);
      ctx.lineTo(hx2, hy2);
      ctx.stroke();
    }
    ctx.restore();
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

    // 1. Streamlines render to their own GPU canvas (behind, via CSS stacking).
    if (showStreamlines && leftStreamlineAnim?.initialized) {
      leftStreamlineAnim.draw(state, [0, 0, 0, 0]);
    }

    // Overlay canvas: clear, paint a translucent white "between" layer
    // (sits on top of GPU streamlines visually), then surface + wave arrows.
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    drawStreamlineOverlay(ctx);

    // 2. Surface fill + outline
    drawSurface(ctx);

    // 3. 3×3 subdivision lines so the discrete cells are explicit.
    drawLeftSubdivisions(ctx);

    // 4. Wave-cancellation animation: 3×3 grid of outward arrows whose
    //    interior pairs cancel center-out, leaving only boundary arrows
    //    pulsed for emphasis at the end of the cycle.
    if (leftWaveAnim?.initialized) {
      leftWaveAnim.draw(state);
    }
  }

  function drawRight(state: AnimationState) {
    const ctx = rightCanvas2d.ctx;
    if (!ctx || !boundingBox) return;

    // 1. Streamlines render to their own GPU canvas (behind).
    if (showStreamlines && rightStreamlineAnim?.initialized) {
      rightStreamlineAnim.draw(state, [0, 0, 0, 0]);
    }

    // Overlay canvas: clear, paint the muting layer, then surface + grid.
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    drawStreamlineOverlay(ctx);

    // 2. Surface fill + outline — uses the (more complex) right curve.
    drawSurface(ctx, rightCurveFn ?? curveFn);

    // 3. Subdivision lines clipped to the right curve.
    drawRightSubdivisions(ctx);

    // 4. Wave-cancellation animation (same logic as LHS, on finer cells that
    //    are filtered to fit the irregular shape).
    if (rightWaveAnim?.initialized) {
      rightWaveAnim.draw(state);
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) timeline.pause();
  });

  // Force re-init when inputs that affect *streamline geometry* change
  // (HMR + interactive prop tweaking). Streamlines are baked at init from the
  // current toPixel/domainMargin, so without this the cells respond to changes
  // but streamlines stay frozen at their old scale.
  let lastDomainMargin = domainMargin;
  let lastCurveFn = curveFn;
  let lastGridResolution = gridResolution;
  $: if (
    isInitialized &&
    (domainMargin !== lastDomainMargin ||
      curveFn !== lastCurveFn ||
      gridResolution !== lastGridResolution)
  ) {
    lastDomainMargin = domainMargin;
    lastCurveFn = curveFn;
    lastGridResolution = gridResolution;
    if (timeline) timeline.pause();
    timeline = null;
    leftStreamlineAnim = null;
    rightStreamlineAnim = null;
    leftWaveAnim?.destroy();
    leftWaveAnim = null;
    isInitialized = false;
  }

  // Initialize once all four canvases are bound
  $: if (
    !isInitialized &&
    leftCanvas &&
    rightCanvas &&
    leftGpuCanvas &&
    rightGpuCanvas &&
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
    <div class="canvas-stack" style="aspect-ratio: {canvasWidth}/{canvasHeight};">
      <canvas bind:this={leftGpuCanvas} class="gpu-canvas"></canvas>
      <canvas bind:this={leftCanvas} use:leftCanvas2d.bindCanvas class="overlay-canvas"></canvas>
    </div>
  {/snippet}

  {#snippet right()}
    <div class="canvas-stack" style="aspect-ratio: {canvasWidth}/{canvasHeight};">
      <canvas bind:this={rightGpuCanvas} class="gpu-canvas"></canvas>
      <canvas bind:this={rightCanvas} use:rightCanvas2d.bindCanvas class="overlay-canvas"></canvas>
    </div>
  {/snippet}
</DoubleFigure>

<style>
  .canvas-stack {
    position: relative;
    width: 100%;
  }
  .canvas-stack .gpu-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
  .canvas-stack .overlay-canvas {
    position: relative;
    z-index: 1;
    width: 100%;
    height: auto;
    display: block;
  }
</style>
