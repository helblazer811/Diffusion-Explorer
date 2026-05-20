<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import { Player,
    Figure,
    Katex,
    drawScatterPlot,
    createSourceTargetScales,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
    createPauseClip,
    PathlineAnimation,
    type PathlineAnimationState,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    sourcePoints?: number[][];
    targetPoints?: number[][];
    otMatching?: number[];
    naiveMatching?: number[];
    otTrajectories?: number[][][];
    naiveTrajectories?: number[][][];
    canvasWidth?: number;
    canvasHeight?: number;
    marginWidth?: number;
    marginTop?: number;
    gap?: number;
    topLabel?: string;
    bottomLabel?: string;
    topEquation?: string;
    bottomEquation?: string;
    labelFontSize?: number;
    labelColor?: string;
    labelOpacity?: number;
    sourcePointColor?: string;
    targetPointColor?: string;
    pointRadius?: number;
    pointOpacity?: number;
    couplingLineColor?: string;
    couplingLineOpacity?: number;
    couplingLineWidth?: number;
    trajectoryColor?: string;
    trajectoryStrokeWidth?: number;
    trajectoryPointRadius?: number;
    trajectoryOpacity?: number;
    animationDuration?: number;
    numTrajectoriesToShow?: number;
    timing?: {
      couplingDrawEnd: number;
      couplingHoldEnd: number;
      couplingFadeEnd: number;
      trajectoryEnd: number;
      pauseEnd: number;
    };
    playingByDefault?: boolean;
    backgroundVisible?: boolean;
    children?: Snippet;
  }

  let {
    sourcePoints = [],
    targetPoints = [],
    otMatching = [],
    naiveMatching = [],
    otTrajectories = [],
    naiveTrajectories = [],
    canvasWidth = 1300,
    canvasHeight = 500,
    marginWidth = 40,
    marginTop = 110,
    gap = 0,
    numTrajectoriesToShow = 30,
    topLabel = "Independent Coupling",
    bottomLabel = "Optimal Transport Coupling",
    topEquation = "\\pi(x_0, x_1) = p_0(x_0)\\, p_1(x_1)",
    bottomEquation = "\\pi^{\\,*} = \\arg\\min_{\\pi}\\; \\mathbb{E}_{(x_0,x_1)\\sim\\pi}\\,\\lVert x_0 - x_1 \\rVert^{2}",
    labelFontSize = 38,
    labelColor = "#666",
    labelOpacity = 1.0,
    sourcePointColor = "#3b82f6",
    targetPointColor = "#3b82f6",
    pointRadius = 6,
    pointOpacity = 0.7,
    couplingLineColor = "#888",
    couplingLineOpacity = 0.5,
    couplingLineWidth = 2.5,
    trajectoryColor = "#f17720",
    trajectoryStrokeWidth = 2.5,
    trajectoryPointRadius = 4,
    trajectoryOpacity = 0.85,
    animationDuration = 20000,
    timing = {
      couplingDrawEnd: 0.28,
      couplingHoldEnd: 0.42,
      couplingFadeEnd: 0.50,
      trajectoryEnd: 0.92,
      pauseEnd: 1.0,
    },
    playingByDefault = true,
    backgroundVisible = false,
    children = undefined,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let caption = $derived(children);
  let isDataValid = $derived(
    sourcePoints.length > 0 &&
    targetPoints.length > 0 &&
    otMatching.length === sourcePoints.length &&
    naiveMatching.length === sourcePoints.length &&
    otTrajectories.length > 0 &&
    naiveTrajectories.length > 0,
  );

  // Top (OT) canvas
  let topCanvas: HTMLCanvasElement | null = $state(null);
  const topCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  let topCtx = $derived(topCanvas && topCanvas2d.ctx);

  // Bottom (Independent) canvas
  let bottomCanvas: HTMLCanvasElement | null = $state(null);
  const bottomCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  let bottomCtx = $derived(bottomCanvas && bottomCanvas2d.ctx);

  // Animation state — extends PathlineAnimationState
  type AnimationState = PathlineAnimationState & {
    time: number;
    couplingProgress: number; // 0 → 1 during draw, stays 1 during hold/fade
    couplingOpacity: number;  // 1 → 0 during fade
    inTrajectoryPhase: boolean;
  };

  let currentState: AnimationState = $state({
    segmentIndex: 0,
    time: 0,
    couplingProgress: 0,
    couplingOpacity: 1,
    inTrajectoryPhase: false,
  });

  let player: Player<AnimationState> | null = null;
  let topPathlineAnimation: PathlineAnimation<AnimationState> | null = null;
  let bottomPathlineAnimation: PathlineAnimation<AnimationState> | null = null;

  let isInitialized = $state(false);

  // Pre-computed pixel coords (per panel)
  let topScales: ReturnType<typeof createSourceTargetScales> | null = null;
  let bottomScales: ReturnType<typeof createSourceTargetScales> | null = null;
  let topSourcePixels: number[][] = [];
  let topTargetPixels: number[][] = [];
  let bottomSourcePixels: number[][] = [];
  let bottomTargetPixels: number[][] = [];
  let topScaledTrajectories: number[][][] = [];
  let bottomScaledTrajectories: number[][][] = [];
  let numSegments = 1;

  // Offscreen caches for static dot layer (rendered once in setup, blitted per frame)
  let topDotsCache: HTMLCanvasElement | null = null;
  let bottomDotsCache: HTMLCanvasElement | null = null;

  // Visibility
  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function buildPanelGeometry(
    sourcePts: number[][],
    targetPts: number[][],
    trajectories: number[][][],
  ): {
    scales: ReturnType<typeof createSourceTargetScales>;
    sourcePixels: number[][];
    targetPixels: number[][];
    scaledTrajectories: number[][][];
  } {
    const contentHeight = canvasHeight - marginTop;
    const scales = createSourceTargetScales(sourcePts, targetPts, {
      width: canvasWidth,
      height: contentHeight,
      marginWidth,
      marginHeight: 0,
      sourceCenterX: 0.18,
      targetCenterX: 0.82,
      yShiftFactor: 0,
    });
    // Offset yScale to account for top margin reserved for labels
    const originalYScale = scales.yScale;
    scales.yScale = (y: number) => originalYScale(y) + marginTop;

    const sourcePixels = sourcePts.map((p) => [
      scales.sourceCenterPixelX + (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);
    const targetPixels = targetPts.map((p) => [
      scales.targetCenterPixelX + (p[0] - scales.targetMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    // Scale trajectories: interpolate x by trajectory position along source-target axis
    const allX = [
      ...sourcePts.map((p) => p[0]),
      ...targetPts.map((p) => p[0]),
    ];
    const combinedMeanX = allX.reduce((a, b) => a + b, 0) / allX.length;
    const getPixelX = (dataX: number, t: number): number => {
      const centerPixelX =
        scales.sourceCenterPixelX +
        t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
      return centerPixelX + (dataX - combinedMeanX) * scales.xScaleFactor;
    };
    // Subsample trajectories to reduce visual crowding (evenly-spaced indices)
    const totalTraj = trajectories.length;
    const numShown = Math.min(numTrajectoriesToShow, totalTraj);
    const subsampledIndices = numShown === totalTraj
      ? Array.from({ length: totalTraj }, (_, i) => i)
      : Array.from({ length: numShown }, (_, i) => Math.floor((i * totalTraj) / numShown));
    const subsampledTrajectories = subsampledIndices.map((i) => trajectories[i]);

    const scaledTrajectories = subsampledTrajectories.map((traj) =>
      traj.map((point, tIdx) => {
        const t = traj.length > 1 ? tIdx / (traj.length - 1) : 0;
        return [getPixelX(point[0], t), scales.yScale(point[1])];
      }),
    );

    return { scales, sourcePixels, targetPixels, scaledTrajectories };
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  // Pre-render static dots to an offscreen canvas (called once in setup; result blitted each frame)
  function buildDotsCache(
    sourcePixels: number[][],
    targetPixels: number[][],
  ): HTMLCanvasElement {
    const dpr = window.devicePixelRatio || 1;
    const cache = document.createElement('canvas');
    cache.width = Math.round(canvasWidth * dpr);
    cache.height = Math.round(canvasHeight * dpr);
    const cacheCtx = cache.getContext('2d');
    if (!cacheCtx) return cache;
    cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScatterPlot(cacheCtx, sourcePixels, pointRadius, sourcePointColor, pointOpacity);
    drawScatterPlot(cacheCtx, targetPixels, pointRadius, targetPointColor, pointOpacity);
    return cache;
  }

  function runInitialComputation() {
    if (!isDataValid) return;

    // Top panel = independent (default), bottom = OT (the improvement)
    const top = buildPanelGeometry(sourcePoints, targetPoints, naiveTrajectories);
    topScales = top.scales;
    topSourcePixels = top.sourcePixels;
    topTargetPixels = top.targetPixels;
    topScaledTrajectories = top.scaledTrajectories;

    const bottom = buildPanelGeometry(sourcePoints, targetPoints, otTrajectories);
    bottomScales = bottom.scales;
    bottomSourcePixels = bottom.sourcePixels;
    bottomTargetPixels = bottom.targetPixels;
    bottomScaledTrajectories = bottom.scaledTrajectories;

    // Build offscreen dot caches (once, since dots are static)
    topDotsCache = buildDotsCache(topSourcePixels, topTargetPixels);
    bottomDotsCache = buildDotsCache(bottomSourcePixels, bottomTargetPixels);

    numSegments = Math.max(
      ...topScaledTrajectories.map((t) => t.length - 1),
      ...bottomScaledTrajectories.map((t) => t.length - 1),
      1,
    );
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  async function setupTimeline() {
    if (!topCanvas || !bottomCanvas) return;

    const style = {
      color: trajectoryColor,
      strokeWidth: trajectoryStrokeWidth,
      pointRadius: trajectoryPointRadius,
      opacity: trajectoryOpacity,
    };
    topPathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(
      topScaledTrajectories,
      { style },
    );
    bottomPathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(
      bottomScaledTrajectories,
      { style },
    );
    await Promise.all([
      topPathlineAnimation.init(topCanvas),
      bottomPathlineAnimation.init(bottomCanvas),
    ]);

    // Clip `t` is local to the clip's range, not global timeline time.
    // Convert global thresholds into local fractions inside the coupling clip ([0, couplingFadeEnd]).
    const couplingClipEnd = timing.couplingFadeEnd;
    const localDrawEnd = timing.couplingDrawEnd / couplingClipEnd;
    const localHoldEnd = timing.couplingHoldEnd / couplingClipEnd;

    const couplingClip = {
      name: "Coupling",
      reduce(t: number): Partial<AnimationState> {
        const globalT = t * couplingClipEnd;
        if (t < localDrawEnd) {
          const progress = t / localDrawEnd;
          return {
            time: globalT,
            couplingProgress: progress,
            couplingOpacity: 1,
            inTrajectoryPhase: false,
            segmentIndex: 0,
          };
        } else if (t < localHoldEnd) {
          return {
            time: globalT,
            couplingProgress: 1,
            couplingOpacity: 1,
            inTrajectoryPhase: false,
            segmentIndex: 0,
          };
        } else {
          const fadeT = (t - localHoldEnd) / (1 - localHoldEnd);
          return {
            time: globalT,
            couplingProgress: 1,
            couplingOpacity: Math.max(0, 1 - fadeT),
            inTrajectoryPhase: false,
            segmentIndex: 0,
          };
        }
      },
    };

    const trajectoryClipStart = timing.couplingFadeEnd;
    const trajectoryClipEnd = timing.trajectoryEnd;
    const trajectoryClip = {
      name: "Trajectories",
      reduce(t: number): Partial<AnimationState> {
        const globalT = trajectoryClipStart + t * (trajectoryClipEnd - trajectoryClipStart);
        const segIdx = Math.floor(Math.min(t, 1) * numSegments);
        return {
          time: globalT,
          couplingProgress: 0,
          couplingOpacity: 0,
          inTrajectoryPhase: true,
          segmentIndex: segIdx,
        };
      },
    };

    const tl = Timeline.from<AnimationState>({
      duration: animationDuration / 1000,
      initialState: {},
      clips: [
        { clip: couplingClip, ...{ start: 0, end: timing.couplingFadeEnd } },
        { clip: trajectoryClip, ...{ start: timing.couplingFadeEnd, end: timing.trajectoryEnd } },
        { clip: createPauseClip(), ...{ start: timing.trajectoryEnd, end: timing.pauseEnd } },
      ],
    });
    player = new Player(tl, { looping: true });

    player.onTick((_t, state) => {
      currentState = state as AnimationState;
      drawAll();
    });
  }

  function startAnimation() {
    if (player && !player.isPlaying) player.play();
  }
  function stopAnimation() {
    if (player) player.pause();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawCouplingLines(
    ctx: CanvasRenderingContext2D,
    sourcePixels: number[][],
    targetPixels: number[][],
    matching: number[],
    progress: number,
    opacity: number,
  ) {
    if (!sourcePixels.length || !targetPixels.length || !matching.length) return;
    ctx.strokeStyle = couplingLineColor;
    ctx.lineWidth = couplingLineWidth;
    ctx.globalAlpha = opacity;
    const n = Math.min(sourcePixels.length, matching.length);
    for (let i = 0; i < n; i++) {
      const targetIdx = matching[i];
      if (targetIdx < 0 || targetIdx >= targetPixels.length) continue;
      const [sx, sy] = sourcePixels[i];
      const [tx, ty] = targetPixels[targetIdx];
      const endX = sx + (tx - sx) * progress;
      const endY = sy + (ty - sy) * progress;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawPanel(
    ctx: CanvasRenderingContext2D,
    scales: ReturnType<typeof createSourceTargetScales>,
    sourcePixels: number[][],
    targetPixels: number[][],
    matching: number[],
    pathlineAnimation: PathlineAnimation<AnimationState> | null,
    dotsCache: HTMLCanvasElement | null,
    state: AnimationState,
  ) {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // --- Dynamic Foreground: lines drawn BELOW points ---
    if (!state.inTrajectoryPhase) {
      if (state.couplingProgress > 0 && state.couplingOpacity > 0) {
        drawCouplingLines(
          ctx,
          sourcePixels,
          targetPixels,
          matching,
          state.couplingProgress,
          state.couplingOpacity * couplingLineOpacity,
        );
      }
    } else if (pathlineAnimation) {
      pathlineAnimation.draw(state);
    }

    // --- Static dots cached to offscreen canvas, blitted once per frame (drawn ON TOP) ---
    if (dotsCache) {
      ctx.drawImage(dotsCache, 0, 0, canvasWidth, canvasHeight);
    }
  }

  function drawAll() {
    if (!isInitialized) return;
    if (topCtx && topScales) {
      drawPanel(
        topCtx,
        topScales,
        topSourcePixels,
        topTargetPixels,
        naiveMatching,
        topPathlineAnimation,
        topDotsCache,
        currentState,
      );
    }
    if (bottomCtx && bottomScales) {
      drawPanel(
        bottomCtx,
        bottomScales,
        bottomSourcePixels,
        bottomTargetPixels,
        otMatching,
        bottomPathlineAnimation,
        bottomDotsCache,
        currentState,
      );
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    player?.dispose();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $effect(() => {
    if (isDataValid && topCanvas && bottomCanvas && !isInitialized) {
      runInitialComputation();
      setupTimeline().then(() => {
        isInitialized = true;
        drawAll();
        if (playingByDefault) startAnimation();
      });
    }
  });

  $effect(() => {
    if (figureIsActive && isInitialized) {
      const unsub = figureIsActive.subscribe((active: boolean) => {
        handleVisibilityChange(active);
        if (!active) {
          player?.reset();
        }
      });
      return unsub;
    }
  });
</script>

{#if isDataValid}
  <Figure
    {caption}
    {backgroundVisible}
    bind:isActive={figureIsActive}
  >
    {#snippet children()}
      <div class="stack" style="gap: {gap}px; max-width: {canvasWidth}px;">
        <div class="panel">
          <div class="panel-header" style="color: {labelColor}; opacity: {labelOpacity};">
            <div class="panel-label" style="font-size: {labelFontSize}px;">{topLabel}</div>
            <div class="panel-equation"><Katex math={topEquation} displayMode={true} displayFontSize="2em" color={labelColor} /></div>
          </div>
          <div class="dist-label dist-label-left"><Katex math="p_0" color="#999" /></div>
          <div class="dist-label dist-label-right"><Katex math="p_1" color="#999" /></div>
          <canvas
            bind:this={topCanvas}
            use:topCanvas2d.bindCanvas
            class="panel-canvas"
            style="aspect-ratio: {canvasWidth}/{canvasHeight};"
          ></canvas>
        </div>
        <div class="panel">
          <div class="panel-header" style="color: {labelColor}; opacity: {labelOpacity};">
            <div class="panel-label" style="font-size: {labelFontSize}px;">{bottomLabel}</div>
            <div class="panel-equation"><Katex math={bottomEquation} displayMode={true} displayFontSize="2em" color={labelColor} /></div>
          </div>
          <div class="dist-label dist-label-left"><Katex math="p_0" color="#999" /></div>
          <div class="dist-label dist-label-right"><Katex math="p_1" color="#999" /></div>
          <canvas
            bind:this={bottomCanvas}
            use:bottomCanvas2d.bindCanvas
            class="panel-canvas"
            style="aspect-ratio: {canvasWidth}/{canvasHeight};"
          ></canvas>
        </div>
      </div>
    {/snippet}
  </Figure>
{:else}
  <div class="placeholder">
    <p>Loading coupling data...</p>
  </div>
{/if}

<style>
  .stack {
    width: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 0;
  }
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .panel-header {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    text-align: center;
    font-family: Helvetica, Arial, sans-serif;
    pointer-events: none;
    z-index: 1;
  }
  /* OT panel's header sits a bit higher, overlapping the empty bottom area of the panel above */
  .stack > .panel:nth-of-type(2) .panel-header {
    top: -20px;
  }
  /* Subtle p_0 / p_1 density labels above the source / target distributions */
  .dist-label {
    position: absolute;
    top: 9%;
    font-size: 1.8em;
    opacity: 0.9;
    pointer-events: none;
    z-index: 1;
    transform: translateX(-50%);
  }
  .dist-label-left {
    left: 18%;
  }
  .dist-label-right {
    left: 82%;
  }
  .panel-label {
    font-weight: 450;
    line-height: 1.2;
  }
  .panel-equation {
    margin-top: 4px;
  }
  .panel-canvas {
    width: 100%;
    height: auto;
    display: block;
  }
  .placeholder {
    padding: 2rem;
    text-align: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    color: #666;
  }
</style>
