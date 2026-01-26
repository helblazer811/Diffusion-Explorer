<script lang="ts">
  import { onMount } from 'svelte';
  import {
    computeContours,
    plotContours,
    plotSegments,
    ContourRenderer,
    useCanvas2D,
  } from '@diffusion-explorer/ui';
  import * as d3 from 'd3';

  // Configuration
  let pointCount = 5000;
  let gridSize = 100;
  let numLevels = 10;
  let bandwidth = 20;  // Same scale as D3's contourDensity

  // Density visualization mode
  let showDensityGrid = false;
  let densityMetrics = { compute: 0, render: 0 };

  // Metrics
  let cpuMetrics = { compute: 0, render: 0, total: 0 };
  let gpuMetrics = { compute: 0, render: 0, total: 0 };
  let isRunning = false;
  let gpuSupported = false;
  let gpuError = '';

  // Canvas refs
  let cpuCanvas: HTMLCanvasElement;
  let gpuCanvas: HTMLCanvasElement;
  let densityCanvas: HTMLCanvasElement;
  let cpuCtx: CanvasRenderingContext2D | null = null;

  // GPU renderer
  let gpuRenderer: ContourRenderer | null = null;

  // Test data
  let points: Float32Array | null = null;

  const canvasWidth = 400;
  const canvasHeight = 400;

  /**
   * Generate random 2D points from a mixture of 5 Gaussians arranged in a star pattern.
   */
  function generatePoints(count: number): Float32Array {
    const data = new Float32Array(count * 2);

    // 5 Gaussian clusters arranged in a star pattern
    // Center at (0.5, 0.5), with 5 points on a circle
    const centerX = 0.5;
    const centerY = 0.5;
    const radius = 0.25;
    const numClusters = 5;

    const centers: { x: number; y: number }[] = [];
    for (let i = 0; i < numClusters; i++) {
      // Start from top (-90 degrees) and go clockwise
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / numClusters;
      centers.push({
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    }

    const stdDev = 0.08;

    for (let i = 0; i < count; i++) {
      const center = centers[Math.floor(Math.random() * centers.length)];

      // Box-Muller transform for Gaussian
      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);

      data[i * 2] = center.x + z0 * stdDev;
      data[i * 2 + 1] = center.y + z1 * stdDev;
    }

    return data;
  }

  /**
   * Run CPU benchmark.
   */
  async function runCPUBenchmark() {
    if (!cpuCtx || !points) {
      console.log('[CPU Benchmark] Skipped: cpuCtx=', cpuCtx, 'points=', points);
      return;
    }

    console.log('[CPU Benchmark] Starting with', points.length / 2, 'points');

    // Convert to array format for CPU API (not timed - data prep)
    const pointsArray: [number, number][] = [];
    for (let i = 0; i < points.length; i += 2) {
      pointsArray.push([points[i], points[i + 1]]);
    }

    console.log('[CPU Benchmark] Converted points, sample:', pointsArray.slice(0, 3));

    // Compute contours
    const computeStart = performance.now();
    const contours = computeContours(pointsArray, {
      gridSize,
      bandwidth,
      thresholds: numLevels,
      domain: [0, 1, 0, 1],
    });
    const computeEnd = performance.now();

    console.log('[CPU Benchmark] Computed contours:', contours.contours.length, 'contours');
    console.log('[CPU Benchmark] Value range:', contours.minValue, '-', contours.maxValue);

    // Render contours
    const renderStart = performance.now();
    cpuCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    plotContours(cpuCtx, contours, {
      xScale: (x) => x * canvasWidth,
      yScale: (y) => (1 - y) * canvasHeight,  // Flip Y
      fill: true,
      opacity: 0.9,
      // Use a color scale that starts darker for better visibility
      colorScale: (t) => d3.interpolateBlues(0.3 + t * 0.7),
    });
    const renderEnd = performance.now();

    console.log('[CPU Benchmark] Rendered contours');

    cpuMetrics = {
      compute: computeEnd - computeStart,
      render: renderEnd - renderStart,
      total: (computeEnd - computeStart) + (renderEnd - renderStart),
    };
  }

  /**
   * Run GPU benchmark.
   */
  async function runGPUBenchmark() {
    if (!gpuRenderer || !points) {
      console.log('[GPU Benchmark] Skipped: gpuRenderer=', gpuRenderer, 'points=', points);
      return;
    }

    try {
      // Set points (data upload + compute pipeline)
      const computeStart = performance.now();
      console.log('[GPU Benchmark] Setting points...');
      gpuRenderer.setPoints(points, { xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
      const computeEnd = performance.now();

      // Render (threshold fill)
      console.log('[GPU Benchmark] Rendering...');
      const renderStart = performance.now();
      gpuRenderer.render();
      const renderEnd = performance.now();

      gpuMetrics = {
        compute: computeEnd - computeStart,
        render: renderEnd - renderStart,
        total: (computeEnd - computeStart) + (renderEnd - renderStart),
      };
      console.log('[GPU Benchmark] Complete:', gpuMetrics);
    } catch (e) {
      console.error('[GPU Benchmark] Error:', e);
    }
  }

  /**
   * Run density grid visualization.
   */
  async function runDensityBenchmark() {
    if (!gpuRenderer || !points) {
      console.log('[Density Benchmark] Skipped: no renderer or points');
      return;
    }

    // Wait a tick for the canvas to be rendered if showDensityGrid just became true
    await new Promise(resolve => setTimeout(resolve, 0));

    if (!densityCanvas) {
      console.log('[Density Benchmark] Skipped: no density canvas');
      return;
    }

    // Initialize canvas size
    densityCanvas.width = canvasWidth;
    densityCanvas.height = canvasHeight;

    try {
      // Ensure points are set (this runs the compute pipeline)
      const computeStart = performance.now();
      gpuRenderer.setPoints(points, { xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
      const computeEnd = performance.now();

      // Read back density grid
      const renderStart = performance.now();
      const { data, width, height } = await gpuRenderer.getDensityGrid();
      console.log('[Density Benchmark] Got density grid:', width, 'x', height, 'max:', Math.max(...data));

      // Render density as grayscale image
      const ctx = densityCanvas.getContext('2d')!;
      const imageData = ctx.createImageData(width, height);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcIdx = y * width + x;
          // Flip Y for canvas (GPU has Y=0 at bottom)
          const dstIdx = ((height - 1 - y) * width + x) * 4;
          const value = Math.min(1, data[srcIdx]);
          const color = Math.floor(value * 255);
          imageData.data[dstIdx] = color;     // R
          imageData.data[dstIdx + 1] = color; // G
          imageData.data[dstIdx + 2] = color; // B
          imageData.data[dstIdx + 3] = 255;   // A
        }
      }

      // Scale up to canvas size
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      tempCanvas.getContext('2d')!.putImageData(imageData, 0, 0);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tempCanvas, 0, 0, canvasWidth, canvasHeight);
      const renderEnd = performance.now();

      densityMetrics = {
        compute: computeEnd - computeStart,
        render: renderEnd - renderStart,
      };
      console.log('[Density Benchmark] Complete:', densityMetrics);
    } catch (e) {
      console.error('[Density Benchmark] Error:', e);
    }
  }

  /**
   * Run all benchmarks.
   */
  async function runBenchmarks() {
    if (isRunning) return;
    isRunning = true;

    try {
      // Generate fresh points
      console.log('[Benchmark] Generating', pointCount, 'points...');
      points = generatePoints(pointCount);
      console.log('[Benchmark] Points generated');

      // Run CPU benchmark
      console.log('[Benchmark] Running CPU benchmark...');
      await runCPUBenchmark();
      console.log('[Benchmark] CPU benchmark complete');

      // Run GPU benchmark if supported
      if (gpuRenderer) {
        console.log('[Benchmark] Running GPU benchmark...');
        await runGPUBenchmark();
        console.log('[Benchmark] GPU benchmark complete');

        // Run density visualization if enabled
        if (showDensityGrid) {
          console.log('[Benchmark] Running density benchmark...');
          await runDensityBenchmark();
          console.log('[Benchmark] Density benchmark complete');
        }
      } else {
        console.log('[Benchmark] Skipping GPU benchmark (no renderer)');
      }
    } catch (e) {
      console.error('[Benchmark] Error:', e);
    }

    isRunning = false;
  }

  /**
   * Initialize GPU renderer.
   */
  async function initGPU() {
    try {
      if (!navigator.gpu) {
        gpuError = 'WebGPU not supported in this browser';
        console.log('[GPU Init] WebGPU not supported');
        return;
      }

      console.log('[GPU Init] Creating ContourRenderer...');
      gpuRenderer = await ContourRenderer.create(gpuCanvas, {
        gridSize,
        bandwidth,
        numLevels,
        dpr: window.devicePixelRatio,
        opacity: 0.9,
      });
      console.log('[GPU Init] ContourRenderer created successfully');

      gpuSupported = true;
    } catch (e) {
      gpuError = e instanceof Error ? e.message : 'Unknown error';
      console.error('[GPU Init] Error:', e);
    }
  }

  onMount(async () => {
    // Initialize CPU canvas
    const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
    canvas2d.init(cpuCanvas);
    cpuCtx = canvas2d.ctx;
    cpuCanvas.style.width = `${canvasWidth}px`;
    cpuCanvas.style.height = `${canvasHeight}px`;

    // Initialize GPU canvas
    gpuCanvas.width = canvasWidth * window.devicePixelRatio;
    gpuCanvas.height = canvasHeight * window.devicePixelRatio;
    gpuCanvas.style.width = `${canvasWidth}px`;
    gpuCanvas.style.height = `${canvasHeight}px`;

    await initGPU();

    // Initial benchmark
    await runBenchmarks();
  });

  // Reactively update GPU renderer options
  $: if (gpuRenderer) {
    gpuRenderer.updateOptions({ gridSize, bandwidth, numLevels });
  }
</script>

<svelte:head>
  <title>Contour Benchmark | Diffusion Explorer</title>
</svelte:head>

<div class="container">
  <h1>GPU vs CPU Contour Rendering Benchmark</h1>

  <div class="controls">
    <label>
      Point Count:
      <input type="range" bind:value={pointCount} min={100} max={100000} step={100} />
      <span>{pointCount.toLocaleString()}</span>
    </label>

    <label>
      Grid Size:
      <input type="range" bind:value={gridSize} min={50} max={500} step={10} />
      <span>{gridSize}</span>
    </label>

    <label>
      Contour Levels:
      <input type="range" bind:value={numLevels} min={3} max={20} step={1} />
      <span>{numLevels}</span>
    </label>

    <label>
      Bandwidth:
      <input type="range" bind:value={bandwidth} min={5} max={50} step={1} />
      <span>{bandwidth}</span>
    </label>

    <label class="checkbox-label">
      <input type="checkbox" bind:checked={showDensityGrid} />
      Show density grid
    </label>

    <button on:click={runBenchmarks} disabled={isRunning}>
      {isRunning ? 'Running...' : 'Run Benchmark'}
    </button>
  </div>

  <div class="canvases">
    <div class="canvas-container">
      <h3>CPU (D3 + Canvas 2D)</h3>
      <canvas bind:this={cpuCanvas}></canvas>
      <div class="metrics">
        <p>Compute: {cpuMetrics.compute.toFixed(2)} ms</p>
        <p>Render: {cpuMetrics.render.toFixed(2)} ms</p>
        <p><strong>Total: {cpuMetrics.total.toFixed(2)} ms</strong></p>
      </div>
    </div>

    <div class="canvas-container">
      <h3>GPU (WebGPU)</h3>
      <div class="canvas-wrapper">
        <canvas bind:this={gpuCanvas}></canvas>
      </div>
      {#if gpuSupported}
        <div class="metrics">
          <p>Compute: {gpuMetrics.compute.toFixed(2)} ms</p>
          <p>Render: {gpuMetrics.render.toFixed(2)} ms</p>
          <p><strong>Total: {gpuMetrics.total.toFixed(2)} ms</strong></p>
        </div>
      {:else}
        <div class="error">
          <p>GPU not available</p>
          <p class="error-detail">{gpuError}</p>
        </div>
      {/if}
    </div>

    {#if showDensityGrid}
      <div class="canvas-container">
        <h3>GPU Density Grid</h3>
        <canvas bind:this={densityCanvas}></canvas>
        <div class="metrics">
          <p>Compute: {densityMetrics.compute.toFixed(2)} ms</p>
          <p>Render (readback): {densityMetrics.render.toFixed(2)} ms</p>
        </div>
      </div>
    {/if}
  </div>

  {#if gpuSupported && cpuMetrics.total > 0 && gpuMetrics.total > 0}
    <div class="speedup">
      <p>
        GPU Speedup: <strong>{(cpuMetrics.total / gpuMetrics.total).toFixed(1)}x</strong>
      </p>
    </div>
  {/if}
</div>

<style>
  .container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem;
    font-family: system-ui, -apple-system, sans-serif;
  }

  h1 {
    text-align: center;
    margin-bottom: 2rem;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    margin-bottom: 2rem;
    padding: 1rem;
    background: #f5f5f5;
    border-radius: 8px;
  }

  .controls label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
  }

  .controls input[type="range"] {
    width: 120px;
  }

  .controls span {
    min-width: 60px;
    font-weight: bold;
  }

  .controls button {
    padding: 0.5rem 1rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .controls button:disabled {
    background: #94a3b8;
    cursor: not-allowed;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .checkbox-label input[type="checkbox"] {
    width: 1.2rem;
    height: 1.2rem;
    cursor: pointer;
  }

  .canvases {
    display: flex;
    flex-wrap: wrap;
    gap: 2rem;
    justify-content: center;
  }

  .canvas-container {
    text-align: center;
  }

  .canvas-container h3 {
    margin-bottom: 0.5rem;
  }

  .canvas-wrapper {
    position: relative;
    display: inline-block;
  }

  canvas {
    border: 1px solid #ccc;
    border-radius: 4px;
  }

  .metrics {
    margin-top: 1rem;
    text-align: left;
    font-size: 0.9rem;
  }

  .metrics p {
    margin: 0.25rem 0;
  }

  .error {
    margin-top: 1rem;
    color: #dc2626;
  }

  .error-detail {
    font-size: 0.8rem;
    color: #666;
  }

  .speedup {
    text-align: center;
    margin-top: 2rem;
    padding: 1rem;
    background: #ecfdf5;
    border-radius: 8px;
    font-size: 1.2rem;
  }

  .speedup strong {
    color: #059669;
  }
</style>
