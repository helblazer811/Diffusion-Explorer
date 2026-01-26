<script lang="ts">
  import { onMount } from 'svelte';
  import { ContourRenderer } from '@diffusion-explorer/ui';

  const canvasSize = 400;
  const numLevels = 10;
  const gridSize = 100;
  const bandwidth = 20;
  const pointCount = 5000;

  let densityCanvas: HTMLCanvasElement;
  let gpuCanvas: HTMLCanvasElement;
  let gpuRenderer: ContourRenderer | null = null;

  let diagnostics = {
    densityRange: { min: 0, max: 0 },
    thresholds: [] as number[],
  };

  function generatePoints(count: number): Float32Array {
    const data = new Float32Array(count * 2);
    const centers = [
      { x: 0.5, y: 0.75 },
      { x: 0.3, y: 0.4 },
      { x: 0.7, y: 0.4 },
    ];
    const stdDev = 0.08;

    for (let i = 0; i < count; i++) {
      const center = centers[Math.floor(Math.random() * centers.length)];
      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
      data[i * 2] = center.x + z0 * stdDev;
      data[i * 2 + 1] = center.y + z1 * stdDev;
    }
    return data;
  }

  async function runTest() {
    if (!gpuRenderer) return;

    const points = generatePoints(pointCount);
    gpuRenderer.setPoints(points, { xMin: 0, xMax: 1, yMin: 0, yMax: 1 });

    // Render the contours
    gpuRenderer.render();

    // Get thresholds
    diagnostics.thresholds = [];
    for (let i = 0; i < numLevels; i++) {
      diagnostics.thresholds.push((i + 1) / (numLevels + 1));
    }

    // Get density range
    const { data } = await gpuRenderer.getDensityGrid();
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    diagnostics.densityRange.min = min;
    diagnostics.densityRange.max = max;

    console.log('[ContourLevelTest] Density range:', min, '-', max);
    console.log('[ContourLevelTest] Thresholds:', diagnostics.thresholds);

    // Render density heatmap
    const dCtx = densityCanvas.getContext('2d')!;
    const imageData = dCtx.createImageData(gridSize, gridSize);
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const srcIdx = y * gridSize + x;
        const dstIdx = ((gridSize - 1 - y) * gridSize + x) * 4;
        const normalized = diagnostics.densityRange.max > 0
          ? data[srcIdx] / diagnostics.densityRange.max
          : 0;
        const gray = Math.floor(normalized * 255);
        imageData.data[dstIdx] = gray;
        imageData.data[dstIdx + 1] = gray;
        imageData.data[dstIdx + 2] = gray;
        imageData.data[dstIdx + 3] = 255;
      }
    }
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = gridSize;
    tempCanvas.height = gridSize;
    tempCanvas.getContext('2d')!.putImageData(imageData, 0, 0);
    dCtx.imageSmoothingEnabled = false;
    dCtx.drawImage(tempCanvas, 0, 0, canvasSize, canvasSize);

    diagnostics = diagnostics;
  }

  onMount(async () => {
    try {
      gpuRenderer = await ContourRenderer.create(gpuCanvas, {
        gridSize,
        bandwidth,
        numLevels,
        dpr: window.devicePixelRatio,
      });
      gpuCanvas.style.width = `${canvasSize}px`;
      gpuCanvas.style.height = `${canvasSize}px`;
      console.log('[ContourLevelTest] GPU renderer created');
      await runTest();
    } catch (e) {
      console.error('[ContourLevelTest] Failed to create GPU renderer:', e);
    }
  });
</script>

<svelte:head>
  <title>Contour Level Test | Diffusion Explorer</title>
</svelte:head>

<div class="container">
  <h1>Contour Level Test</h1>
  <p>This test visualizes the GPU threshold-based contour rendering alongside the density grid.</p>

  <button on:click={runTest}>Re-run Test</button>

  <div class="diagnostics">
    <h3>Diagnostics</h3>
    <p><strong>Density range:</strong> {diagnostics.densityRange.min.toFixed(6)} - {diagnostics.densityRange.max.toFixed(6)}</p>
    <p><strong>Thresholds:</strong> {diagnostics.thresholds.map(t => t.toFixed(3)).join(', ')}</p>
  </div>

  <div class="canvases">
    <div class="canvas-box">
      <h4>GPU Contours</h4>
      <p class="info">{numLevels} levels, threshold-based fill</p>
      <canvas bind:this={gpuCanvas} width={canvasSize * window.devicePixelRatio} height={canvasSize * window.devicePixelRatio}></canvas>
    </div>
    <div class="canvas-box">
      <h4>Density Grid</h4>
      <p class="info">range: {diagnostics.densityRange.min.toFixed(4)} - {diagnostics.densityRange.max.toFixed(4)}</p>
      <canvas bind:this={densityCanvas} width={canvasSize} height={canvasSize}></canvas>
    </div>
  </div>
</div>

<style>
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
    font-family: system-ui, -apple-system, sans-serif;
  }

  h1 {
    margin-bottom: 0.5rem;
  }

  .diagnostics {
    background: #f5f5f5;
    padding: 1rem;
    border-radius: 8px;
    margin: 1rem 0;
  }

  .canvases {
    display: flex;
    flex-wrap: wrap;
    gap: 2rem;
    margin-top: 1rem;
  }

  .canvas-box {
    text-align: center;
  }

  .canvas-box h4 {
    margin: 0 0 0.25rem 0;
  }

  .canvas-box .info {
    font-size: 0.85rem;
    color: #666;
    margin: 0 0 0.5rem 0;
  }

  canvas {
    border: 1px solid #ccc;
    border-radius: 4px;
  }

  button {
    padding: 0.5rem 1rem;
    margin: 1rem 0;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  button:hover {
    background: #2563eb;
  }
</style>
