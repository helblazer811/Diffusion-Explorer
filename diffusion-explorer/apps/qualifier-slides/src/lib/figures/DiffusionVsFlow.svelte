<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { base } from '$app/paths';
  import {
    Timeline,
    useCanvas2D,
    drawScatterPlot,
    drawText,
    drawMathjax,
    createSourceTargetScales,
    drawPartialTrajectory,
    createPauseClip,
  } from '@diffusion-explorer/ui';
  import { generateClippedGaussianSamples, clipSamplesToRadius } from '@diffusion-explorer/diffusion';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------
  let {
    width = 1720,
    height = 400,
    animationDuration = 8000,
  }: {
    width?: number;
    height?: number;
    animationDuration?: number;
  } = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Two canvases — top (diffusion) and bottom (flow)
  let topCanvas: HTMLCanvasElement | null = $state(null);
  let bottomCanvas: HTMLCanvasElement | null = $state(null);
  const topCanvas2d = useCanvas2D(width, height);
  const bottomCanvas2d = useCanvas2D(width, height);
  let topCtx: CanvasRenderingContext2D | null = $state(null);
  let bottomCtx: CanvasRenderingContext2D | null = $state(null);

  let scales: ReturnType<typeof createSourceTargetScales> | null = $state(null);
  let sourcePixelCoords: number[][] = $state([]);
  let targetPixelCoords: number[][] = $state([]);

  // Raw data
  let sourceDistribution: number[][] = $state([]);
  let targetDistribution: number[][] = $state([]);
  let diffusionTimeSamples: number[][][] = $state([]); // DDPM [timestep][sample][dim]
  let flowTimeSamples: number[][][] = $state([]);      // Flow matching [timestep][sample][dim]

  let isInitialized = $state(false);

  const NUM_TRAJECTORIES = 10;

  // Animation state: per-trajectory progress (0 = not started, 1 = complete)
  type AnimationState = Record<string, number>; // traj0..traj9 each 0→1

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function getPixelX(dataX: number, dataMeanX: number, t: number): number {
    if (!scales) return 0;
    const centerPixelX =
      scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - dataMeanX) * scales.xScaleFactor;
  }

  function buildPixelTrajectories(timeSamples: number[][][]): number[][][] {
    if (!scales || timeSamples.length === 0) return [];
    const numSteps = timeSamples.length;
    const numSamples = timeSamples[0].length;
    const margin = 5;
    const result: number[][][] = [];

    for (let s = 0; s < numSamples; s++) {
      const traj: number[][] = [];
      let inBounds = true;
      for (let step = 0; step < numSteps; step++) {
        const t = step / (numSteps - 1);
        const pt = timeSamples[step][s];
        const meanX = timeSamples[step].reduce((sum, p) => sum + p[0], 0) / timeSamples[step].length;
        const px = getPixelX(pt[0], meanX, t);
        const py = scales.yScale(pt[1]);
        if (px < margin || px > width - margin || py < margin || py > height - margin) {
          inBounds = false;
          break;
        }
        traj.push([px, py]);
      }
      if (inBounds) {
        result.push(traj);
      }
    }
    return result;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!topCanvas || !bottomCanvas || sourceDistribution.length === 0 || targetDistribution.length === 0) return;

    scales = createSourceTargetScales(
      sourceDistribution as [number, number][],
      targetDistribution as [number, number][],
      {
        width,
        height,
        marginWidth: 50,
        marginHeight: 30,
        sourceCenterX: 0.18,
        targetCenterX: 0.82,
        yShiftFactor: -0.8,
        distributionScaleFactor: 0.85,
      }
    );

    sourcePixelCoords = sourceDistribution.map((p) => [
      scales!.sourceCenterPixelX + (p[0] - scales!.sourceMeanX) * scales!.xScaleFactor,
      scales!.yScale(p[1]),
    ]);

    targetPixelCoords = targetDistribution.map((p) => [
      scales!.targetCenterPixelX + (p[0] - scales!.targetMeanX) * scales!.xScaleFactor,
      scales!.yScale(p[1]),
    ]);
  }

  // ----------------------------------------------------------------
  // Animation
  // ----------------------------------------------------------------

  const timeline = new Timeline<AnimationState>();
  timeline.duration = animationDuration / 1000;
  timeline.looping = true;
  timeline.setEndPause(1.5);

  let diffusionPixelTrajs: number[][][] = [];
  let flowPixelTrajs: number[][][] = [];
  let selectedDiffusionIndices: number[] = [];
  let selectedFlowIndices: number[] = [];

  // Seeded RNG for consistent random selection
  function seededRandom(seed: number) {
    return function() {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function pickRandomIndices(total: number, count: number, seed: number): number[] {
    const rng = seededRandom(seed);
    const indices = Array.from({ length: total }, (_, i) => i);
    // Fisher-Yates shuffle
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, count);
  }

  function setupTimeline() {
    diffusionPixelTrajs = buildPixelTrajectories(diffusionTimeSamples);
    flowPixelTrajs = buildPixelTrajectories(flowTimeSamples);

    // Pick random trajectories
    selectedDiffusionIndices = pickRandomIndices(diffusionPixelTrajs.length, NUM_TRAJECTORIES, 42);
    selectedFlowIndices = pickRandomIndices(flowPixelTrajs.length, NUM_TRAJECTORIES, 77);

    // Build initial state: all trajectories start at progress 0
    const initState: AnimationState = {};
    for (let i = 0; i < NUM_TRAJECTORIES; i++) {
      initState[`traj${i}`] = 0;
    }
    timeline.initialState = initState;

    // Each trajectory gets a clip: staggered, each takes ~1/NUM_TRAJECTORIES of the timeline
    const animPhase = 0.9; // leave 10% for end pause
    const trajDuration = animPhase / NUM_TRAJECTORIES;

    for (let i = 0; i < NUM_TRAJECTORIES; i++) {
      const start = i * trajDuration;
      const end = start + trajDuration;
      const key = `traj${i}`;

      timeline.add({
        name: `Trajectory_${i}`,
        reduce(t: number) {
          return { [key]: t } as Partial<AnimationState>;
        },
      }, { start, end });
    }

    timeline.add(createPauseClip(), { start: animPhase, end: 1.0 });

    timeline.onTick((_t: number, state: Readonly<AnimationState>) => {
      drawCanvas(topCtx, diffusionPixelTrajs, selectedDiffusionIndices, state, 'Diffusion Models', diffusionTimeSamples.length);
      drawCanvas(bottomCtx, flowPixelTrajs, selectedFlowIndices, state, 'Flow-based Models', flowTimeSamples.length);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawCanvas(
    ctx: CanvasRenderingContext2D | null,
    pixelTrajs: number[][][],
    selectedIndices: number[],
    state: AnimationState,
    label: string,
    numSteps: number,
  ) {
    if (!ctx || !scales) return;
    ctx.clearRect(0, 0, width, height);

    // --- Static Background ---
    drawScatterPlot(ctx, sourcePixelCoords, 5, '#3b82f6', 0.3);
    drawScatterPlot(ctx, targetPixelCoords, 5, '#3b82f6', 0.3);

    // Label centered
    drawText(ctx, label, width / 2, 40, {
      font: '600 63px Libre Baskerville, Georgia, serif',
      color: '#333',
      opacity: 1.0,
      align: 'center',
      baseline: 'top',
    });

    // --- Dynamic Foreground ---
    for (let i = 0; i < selectedIndices.length; i++) {
      const progress = state[`traj${i}`] ?? 0;
      if (progress <= 0) continue;

      const trajIdx = selectedIndices[i];
      if (!pixelTrajs[trajIdx]) continue;
      const traj = pixelTrajs[trajIdx];
      const numSegs = traj.length - 1;
      const raw = progress * numSegs;
      const segIdx = Math.min(Math.floor(raw), numSegs - 1);
      const segProg = raw - Math.floor(raw);

      // Completed trajectories drawn at lower opacity
      const isComplete = progress >= 1;
      const opacity = isComplete ? 0.15 : 0.8;

      drawPartialTrajectory(
        ctx,
        traj,
        segIdx,
        segProg,
        {
          color: '#f17720',
          strokeWidth: 3,
          pointRadius: isComplete ? 0 : 5,
          opacity,
          xScale: (x: number) => x,
          yScale: (y: number) => y,
          headType: 'circle',
        }
      );
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  export function restart() {
    timeline.reset();
    timeline.play();
  }

  export function pause() {
    timeline.pause();
  }

  $effect(() => {
    if (topCanvas) {
      topCtx = topCanvas2d.ctx;
    }
  });

  $effect(() => {
    if (bottomCanvas) {
      bottomCtx = bottomCanvas2d.ctx;
    }
  });

  function tryInitialize() {
    if (isInitialized || !topCanvas || !bottomCanvas || !topCtx || !bottomCtx ||
        sourceDistribution.length === 0 || targetDistribution.length === 0 ||
        diffusionTimeSamples.length === 0 || flowTimeSamples.length === 0) return;
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
  }

  onMount(async () => {
    try {
      const [targetRes, ddpmRes, flowRes] = await Promise.all([
        fetch(`${base}/diffusion_vs_ddim/data/smiley_face.json`),
        fetch(`${base}/diffusion_vs_ddim/cached_samples/ddpm_trajectories.json`),
        fetch(`${base}/rf_cached_samples/flow_matching_grid_trajectories.json`),
      ]);

      if (targetRes.ok) {
        const data = await targetRes.json();
        targetDistribution = data.points || [];
      }
      if (ddpmRes.ok) diffusionTimeSamples = await ddpmRes.json();
      if (flowRes.ok) flowTimeSamples = await flowRes.json();

      sourceDistribution = clipSamplesToRadius(generateClippedGaussianSamples(300), 2.0);

      tryInitialize();
    } catch (e) {
      console.warn('Failed to load data:', e);
    }
  });

  // Retry init when canvases bind
  $effect(() => {
    if (topCanvas && bottomCanvas) tryInitialize();
  });

  onDestroy(() => {
    timeline.pause();
  });
</script>

<div style="width: {width}px; display: flex; flex-direction: column; gap: 0px;">
  <!-- Top: Diffusion -->
  <canvas
    bind:this={topCanvas}
    use:topCanvas2d.bindCanvas
    style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
  ></canvas>

  <!-- Bottom: Flow Matching -->
  <canvas
    bind:this={bottomCanvas}
    use:bottomCanvas2d.bindCanvas
    style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
  ></canvas>
</div>
