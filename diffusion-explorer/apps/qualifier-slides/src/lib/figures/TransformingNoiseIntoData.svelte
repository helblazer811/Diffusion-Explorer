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
  } from '@diffusion-explorer/ui';
  import { generateClippedGaussianSamples, clipSamplesToRadius } from '@diffusion-explorer/diffusion';
  import { Katex } from '@diffusion-explorer/ui';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------
  let {
    width = 1400,
    height = 600,
    animationDuration = 6000,
    trajectoryIndex = 103,
    flowerImageIndices = [89],
  }: {
    width?: number;
    height?: number;
    animationDuration?: number;
    trajectoryIndex?: number;
    flowerImageIndices?: number[];
  } = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(width, height);
  let ctx: CanvasRenderingContext2D | null = $state(null);

  let scales: ReturnType<typeof createSourceTargetScales> | null = $state(null);
  let sourcePixelCoords: number[][] = $state([]);
  let targetPixelCoords: number[][] = $state([]);

  // Raw data
  let sourceDistribution: number[][] = $state([]);
  let targetDistribution: number[][] = $state([]);
  let allTimeSamples: number[][][] = $state([]);
  let singleTrajectory: number[][] = $state([]); // [timestep][x,y] for one sample

  let isInitialized = $state(false);

  // Animation state
  type AnimationState = {
    time: number;
    segmentIndex: number;
    segmentProgress: number;
  };

  // Flower images
  const flowerFiles = [
    'image_00001.jpg', 'image_00100.jpg', 'image_00200.jpg',
    'image_00300.jpg', 'image_00400.jpg', 'image_00500.jpg',
    'image_00600.jpg', 'image_00700.jpg', 'image_00800.jpg',
    'image_00900.jpg', 'image_01000.jpg', 'image_01100.jpg',
    'image_01200.jpg', 'image_01300.jpg', 'image_01400.jpg',
    'image_01500.jpg', 'image_01600.jpg', 'image_01700.jpg',
    'image_01800.jpg', 'image_01900.jpg',
  ];

  // Reactive pixel position for traveling image
  let travelX = $state(0);
  let travelY = $state(0);
  let animTime = $state(0);

  // Noise image data URL for overlay
  let noiseDataUrl: string = $state('');

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

  function getTrajectoryPixelPos(stepIndex: number): { x: number; y: number } {
    if (!scales || singleTrajectory.length === 0) return { x: 0, y: 0 };
    const numSteps = singleTrajectory.length;
    const t = stepIndex / (numSteps - 1);
    const pt = singleTrajectory[stepIndex];
    const meanX = allTimeSamples[stepIndex]?.reduce((s: number, p: number[]) => s + p[0], 0) / (allTimeSamples[stepIndex]?.length || 1);
    return {
      x: getPixelX(pt[0], meanX, t),
      y: scales.yScale(pt[1]),
    };
  }

  function generateNoiseDataUrl(): string {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const nctx = c.getContext('2d')!;
    const imageData = nctx.createImageData(256, 256);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const v = Math.floor(Math.random() * 256);
      imageData.data[i] = v;
      imageData.data[i + 1] = v;
      imageData.data[i + 2] = v;
      imageData.data[i + 3] = 255;
    }
    nctx.putImageData(imageData, 0, 0);
    return c.toDataURL();
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas || sourceDistribution.length === 0 || targetDistribution.length === 0) return;

    scales = createSourceTargetScales(
      sourceDistribution as [number, number][],
      targetDistribution as [number, number][],
      {
        width,
        height,
        marginWidth: 50,
        marginHeight: 30,
        sourceCenterX: 0.22,
        targetCenterX: 0.78,
        yShiftFactor: -0.8,
        distributionScaleFactor: 0.7,
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

    // Extract single trajectory: allTimeSamples is [timestep][sample][dim]
    singleTrajectory = allTimeSamples.map((step) => step[trajectoryIndex] || [0, 0]);
  }

  // ----------------------------------------------------------------
  // Animation
  // ----------------------------------------------------------------

  const timeline = new Timeline<AnimationState>();
  timeline.duration = animationDuration / 1000;
  timeline.looping = true;
  timeline.setEndPause(1.5);
  timeline.initialState = { time: 0, segmentIndex: 0, segmentProgress: 0 };

  let cachedNumSteps = 1;

  function setupTimeline() {
    cachedNumSteps = singleTrajectory.length || 1;

    timeline.add({
      name: 'MainAnimation',
      reduce(t: number) {
        const raw = t * (cachedNumSteps - 1);
        const segIdx = Math.floor(raw);
        const segProg = raw - segIdx;
        return {
          time: t,
          segmentIndex: Math.min(segIdx, cachedNumSteps - 1),
          segmentProgress: segProg,
        };
      },
    }, { start: 0, end: 1 });

    timeline.onTick((_t: number, state: Readonly<AnimationState>) => {
      draw(state);
      // Update traveling image position
      const pos = getTrajectoryPixelPos(state.segmentIndex);
      travelX = pos.x;
      travelY = pos.y;
      animTime = state.time;
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx || !scales || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // --- Static Background ---

    // Source scatter (noise)
    drawScatterPlot(ctx, sourcePixelCoords, 6, '#3b82f6', 0.4);

    // Target scatter (smiley face)
    drawScatterPlot(ctx, targetPixelCoords, 6, '#3b82f6', 0.4);

    // Labels
    const textY = 15;
    drawText(ctx, 'Noise Distribution', scales.sourceCenterPixelX, textY, {
      font: '600 54px Libre Baskerville, Georgia, serif',
      color: '#333',
      opacity: 1.0,
      align: 'center',
      baseline: 'top',
    });
    drawText(ctx, 'Data Distribution', scales.targetCenterPixelX, textY, {
      font: '600 54px Libre Baskerville, Georgia, serif',
      color: '#333',
      opacity: 1.0,
      align: 'center',
      baseline: 'top',
    });

    // LaTeX labels below text
    drawMathjax(ctx, 'p(z)', scales.sourceCenterPixelX, textY + 145, 44, 0, 0, { color: '#333' });
    drawMathjax(ctx, 'p(x)', scales.targetCenterPixelX, textY + 145, 44, 0, 0, { color: '#333' });

    // --- Dynamic Foreground ---

    // Draw single trajectory up to current segment
    if (singleTrajectory.length > 1) {
      // Build pixel trajectory for this single path
      const numSteps = singleTrajectory.length;
      const pixelTrajectory: number[][] = [];
      for (let s = 0; s < numSteps; s++) {
        const t = s / (numSteps - 1);
        const pt = singleTrajectory[s];
        const meanX = allTimeSamples[s]?.reduce((sum: number, p: number[]) => sum + p[0], 0) / (allTimeSamples[s]?.length || 1);
        pixelTrajectory.push([
          getPixelX(pt[0], meanX, t),
          scales.yScale(pt[1]),
        ]);
      }

      // Draw the trajectory line
      drawPartialTrajectory(
        ctx,
        pixelTrajectory,
        state.segmentIndex,
        state.segmentProgress,
        {
          color: '#f17720',
          strokeWidth: 6,
          pointRadius: 8,
          opacity: 0.9,
          xScale: (x: number) => x, // already in pixel coords
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

  onMount(async () => {
    noiseDataUrl = generateNoiseDataUrl();

    try {
      // Load target distribution
      const targetRes = await fetch(`${base}/rf_data/smiley_face.json`);
      if (targetRes.ok) {
        const data = await targetRes.json();
        targetDistribution = data.points;
      }

      // Load flow matching trajectories (smoother than diffusion)
      const trajRes = await fetch(`${base}/rf_cached_samples/flow_matching_trajectories.json`);
      if (trajRes.ok) {
        allTimeSamples = await trajRes.json();
      }

      // Generate proper Gaussian source distribution, clipped tighter
      sourceDistribution = clipSamplesToRadius(generateClippedGaussianSamples(300), 2.0);
    } catch (e) {
      console.warn('Failed to load data:', e);
    }

    // Try to initialize now that data is loaded
    tryInitialize();
  });

  // Set ctx when canvas is bound (Svelte action sets it up)
  $effect(() => {
    if (canvas) {
      ctx = canvas2d.ctx;
      tryInitialize();
    }
  });

  // Initialize once when data + canvas are ready
  function tryInitialize() {
    if (isInitialized || !canvas || sourceDistribution.length === 0 || targetDistribution.length === 0 || allTimeSamples.length === 0) return;
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
    draw(timeline.initialState);
    timeline.play();
  }

  onDestroy(() => {
    timeline.pause();
  });
</script>

<div class="transforming-noise" style="width: {width}px; height: {height}px; position: relative;">
  <!-- Canvas layer -->
  <canvas
    bind:this={canvas}
    use:canvas2d.bindCanvas
    style="width: 100%; height: 100%; position: absolute; top: 0; left: 0;"
  ></canvas>

  <!-- HTML overlay: flower images at target distribution points -->
  <!-- Clean flower image below data distribution (same y level as noise image) -->
  {#if isInitialized && scales && targetPixelCoords.length > 0}
    {@const tgtCx = scales.targetCenterPixelX - 180}
    {@const tgtBottomY = Math.max(...targetPixelCoords.map(p => p[1])) - 50}
    {@const tgtImgCenterY = tgtBottomY + 20 + 80}
    {@const nearestTgtPt = targetPixelCoords.reduce((best, p) => {
      const d = Math.sqrt((p[0] - tgtCx) ** 2 + (p[1] - tgtBottomY) ** 2);
      return d < best.d ? { d, p } : best;
    }, { d: Infinity, p: targetPixelCoords[0] }).p}
    <svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5;">
      <line
        x1={nearestTgtPt[0]}
        y1={nearestTgtPt[1]}
        x2={tgtCx}
        y2={tgtImgCenterY}
        stroke="#666"
        stroke-width="3"
        opacity="0.6"
      />
    </svg>
    <img
      src="{base}/flower_samples/{flowerFiles[0]}"
      alt=""
      style="
        position: absolute;
        left: {tgtCx - 80}px;
        top: {tgtBottomY + 20}px;
        width: 160px;
        height: 160px;
        object-fit: cover;
        border-radius: 4px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        z-index: 6;
        pointer-events: none;
      "
    />
  {/if}

  <!-- Noisy image below source distribution -->
  {#if isInitialized && scales && noiseDataUrl}
    {@const srcCx = scales.sourceCenterPixelX}
    {@const srcBottomY = Math.max(...sourcePixelCoords.map(p => p[1])) - 180}
    {@const noiseImgX = srcCx + 330}
    {@const noiseImgCenterY = srcBottomY + 20 + 80}
    {@const nearestSrcPt = sourcePixelCoords.reduce((best, p) => {
      const d = Math.sqrt((p[0] - noiseImgX) ** 2 + (p[1] - srcBottomY) ** 2);
      return d < best.d ? { d, p } : best;
    }, { d: Infinity, p: sourcePixelCoords[0] }).p}
    <svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5;">
      <line
        x1={nearestSrcPt[0]}
        y1={nearestSrcPt[1]}
        x2={noiseImgX}
        y2={noiseImgCenterY}
        stroke="#666"
        stroke-width="3"
        opacity="0.6"
      />
    </svg>
    <div style="
      position: absolute;
      left: {noiseImgX - 80}px;
      top: {srcBottomY + 20}px;
      width: 160px;
      height: 160px;
      z-index: 6;
      pointer-events: none;
    ">
      <img
        src="{base}/flower_samples/{flowerFiles[2]}"
        alt=""
        style="
          position: absolute;
          top: 0; left: 0;
          width: 100%; height: 100%;
          object-fit: cover;
          border-radius: 4px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
          opacity: 0.15;
        "
      />
      <img
        src={noiseDataUrl}
        alt=""
        style="
          position: absolute;
          top: 0; left: 0;
          width: 100%; height: 100%;
          object-fit: cover;
          border-radius: 4px;
          opacity: 0.85;
        "
      />
    </div>
  {/if}

  <!-- Traveling flower image that follows the trajectory -->
  {#if isInitialized && singleTrajectory.length > 0}
    {@const imgSize = 160}
    <div
      style="
        position: absolute;
        left: {travelX - imgSize / 2}px;
        top: {travelY - imgSize - 40}px;
        width: {imgSize}px;
        height: {imgSize}px;
        z-index: 10;
        pointer-events: none;
      "
    >
      <!-- Clean flower image -->
      <img
        src="{base}/flower_samples/{flowerFiles[2]}"
        alt=""
        style="
          position: absolute;
          top: 0; left: 0;
          width: 100%; height: 100%;
          object-fit: cover;
          border-radius: 6px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
          opacity: {animTime};
        "
      />
      <!-- Noise overlay that fades out as we denoise -->
      {#if noiseDataUrl}
        <img
          src={noiseDataUrl}
          alt=""
          style="
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            object-fit: cover;
            border-radius: 6px;
            opacity: {1 - animTime};
            pointer-events: none;
          "
        />
      {/if}
    </div>
  {/if}
</div>
