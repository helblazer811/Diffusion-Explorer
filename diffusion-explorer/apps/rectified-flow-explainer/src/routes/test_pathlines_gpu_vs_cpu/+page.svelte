<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    PathlineAnimation,
    type PathlineAnimationState,
    useCanvas2D,
    useCanvasWebGPU,
  } from "@diffusion-explorer/ui";

  // Add `?nogpu` to the URL to force WebGPU to appear unavailable. Useful for
  // verifying that the explicit `backend: "gpu"` fallback warning fires.
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("nogpu")) {
    try {
      Object.defineProperty(navigator, "gpu", { configurable: true, get: () => undefined });
    } catch {
      // ignore
    }
  }

  // ===== LAYOUT =====
  const canvasWidth = 480;
  const canvasHeight = 480;

  // ===== SYNTHETIC PATHLINE GENERATION =====
  // Identical data fed to both backends so any visual diff is real.
  const numPathlines = 30;
  const numTimesteps = 80;

  function buildSyntheticPathlines(): number[][][] {
    // Each pathline starts on the left edge and sweeps right with a vertical sine wobble.
    // Coordinates are already in pixel space.
    const margin = 30;
    const out: number[][][] = [];
    for (let p = 0; p < numPathlines; p++) {
      const startY = margin + (p / (numPathlines - 1)) * (canvasHeight - 2 * margin);
      const phase = (p / numPathlines) * Math.PI * 2;
      const amplitude = 30 + 15 * Math.sin(phase * 1.7);
      const pathline: number[][] = [];
      for (let t = 0; t < numTimesteps; t++) {
        const u = t / (numTimesteps - 1);
        const x = margin + u * (canvasWidth - 2 * margin);
        const wobble = amplitude * Math.sin(u * Math.PI * 2 + phase);
        const y = startY + wobble;
        pathline.push([x, y]);
      }
      out.push(pathline);
    }
    return out;
  }

  const pathlines = buildSyntheticPathlines();

  // ===== CANVAS HELPERS =====
  const cpuCanvas = useCanvas2D(canvasWidth, canvasHeight);
  const gpuCanvas = useCanvasWebGPU(canvasWidth, canvasHeight);

  // ===== ANIMATION INSTANCES =====
  // Identical configuration — only `backend` differs.
  const sharedStyle = {
    strokeWidth: 2,
    color: "#f17720",
    opacity: 0.85,
    pointRadius: 4,
  };

  const cpuAnim = PathlineAnimation.fromTrajectories<PathlineAnimationState>(
    pathlines,
    { style: sharedStyle, backend: "cpu" }
  );
  const gpuAnim = PathlineAnimation.fromTrajectories<PathlineAnimationState>(
    pathlines,
    { style: sharedStyle, backend: "gpu" }
  );

  // ===== TIMING =====
  const numSegments = numTimesteps - 1;
  const cycleMs = 4000;
  let isPlaying = true;
  let currentSegment = 0;
  let lastTs: number | null = null;
  let accumulator = 0;
  let rafId: number | null = null;

  // Frame-rate measurement
  let cpuMsAvg = 0;
  let gpuMsAvg = 0;
  let cpuMsSamples = 0;
  let gpuMsSamples = 0;

  function tick(ts: number) {
    if (!isPlaying) {
      rafId = null;
      return;
    }
    if (lastTs === null) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;
    const msPerSegment = cycleMs / numSegments;
    accumulator += dt;
    while (accumulator >= msPerSegment) {
      accumulator -= msPerSegment;
      currentSegment = (currentSegment + 1) % numTimesteps;
    }
    drawBoth();
    rafId = requestAnimationFrame(tick);
  }

  function drawBoth() {
    const state: PathlineAnimationState = { segmentIndex: currentSegment };

    // CPU: clear manually then draw
    const ctx = cpuCanvas.ctx;
    if (ctx) {
      const t0 = performance.now();
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      cpuAnim.draw(state);
      const elapsed = performance.now() - t0;
      cpuMsAvg = (cpuMsAvg * cpuMsSamples + elapsed) / (cpuMsSamples + 1);
      cpuMsSamples = Math.min(cpuMsSamples + 1, 120);
    }

    // GPU: drawTrajectories auto-clears (default clearCanvas: true)
    const t1 = performance.now();
    gpuAnim.draw(state);
    const elapsed = performance.now() - t1;
    gpuMsAvg = (gpuMsAvg * gpuMsSamples + elapsed) / (gpuMsSamples + 1);
    gpuMsSamples = Math.min(gpuMsSamples + 1, 120);
  }

  function togglePlay() {
    isPlaying = !isPlaying;
    if (isPlaying && rafId === null) {
      lastTs = null;
      rafId = requestAnimationFrame(tick);
    }
  }

  function resetCounters() {
    cpuMsAvg = 0;
    gpuMsAvg = 0;
    cpuMsSamples = 0;
    gpuMsSamples = 0;
  }

  onMount(async () => {
    // Init CPU side (acquires 2D context inside PathlineAnimation.init)
    if (cpuCanvas.canvas) {
      await cpuAnim.init(cpuCanvas.canvas);
    }
    // Init GPU side (pre-warms GPUTrajectoryRenderer cache)
    if (gpuCanvas.canvas) {
      await gpuAnim.init(gpuCanvas.canvas);
    }
    // Initial draw so the panels aren't blank when paused
    drawBoth();
    rafId = requestAnimationFrame(tick);

    // Debug hook: let test scripts pin the segment from the JS console.
    // Usage: window.__setPathlineSegment(40)
    (window as unknown as { __setPathlineSegment?: (n: number) => void })
      .__setPathlineSegment = (n: number) => {
        isPlaying = false;
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        currentSegment = Math.max(0, Math.min(numSegments, Math.floor(n)));
        drawBoth();
      };
  });

  onDestroy(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    cpuAnim.destroy();
    gpuAnim.destroy();
  });
</script>

<div class="page">
  <h1>Pathline rendering: CPU vs GPU</h1>
  <p class="hint">
    Same synthetic pathlines ({numPathlines} × {numTimesteps} pts), same style, same
    <code>PathlineAnimation</code> API — only the <code>backend</code> option differs.
  </p>

  <div class="controls">
    <button onclick={togglePlay}>{isPlaying ? "Pause" : "Play"}</button>
    <button onclick={resetCounters}>Reset timings</button>
    <span class="seg">segment {currentSegment} / {numSegments}</span>
  </div>

  <div class="panels">
    <div class="panel">
      <div class="label">CPU (<code>backend: "cpu"</code>)</div>
      <canvas
        use:cpuCanvas.bindCanvas
        style="width:{canvasWidth}px; height:{canvasHeight}px"
      ></canvas>
      <div class="metric">
        avg draw: {cpuMsAvg.toFixed(2)} ms <span class="samples">(n={cpuMsSamples})</span>
      </div>
    </div>

    <div class="panel">
      <div class="label">GPU (<code>backend: "gpu"</code>)</div>
      <canvas
        use:gpuCanvas.bindCanvas
        style="width:{canvasWidth}px; height:{canvasHeight}px"
      ></canvas>
      <div class="metric">
        avg draw: {gpuMsAvg.toFixed(2)} ms <span class="samples">(n={gpuMsSamples})</span>
      </div>
    </div>
  </div>
</div>

<style>
  .page {
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
    font-family: system-ui, sans-serif;
  }
  h1 {
    text-align: center;
    margin-bottom: 0.25rem;
  }
  .hint {
    text-align: center;
    color: #555;
    margin-bottom: 1.25rem;
  }
  .controls {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .controls button {
    padding: 0.4rem 0.9rem;
    border: none;
    border-radius: 6px;
    background: #e5e7eb;
    color: #1f2937;
    cursor: pointer;
  }
  .controls button:hover {
    background: #d1d5db;
  }
  .seg {
    color: #6b7280;
    font-variant-numeric: tabular-nums;
  }
  .panels {
    display: flex;
    gap: 1.5rem;
    justify-content: center;
    flex-wrap: wrap;
  }
  .panel {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .label {
    font-weight: 600;
    margin-bottom: 0.5rem;
  }
  canvas {
    display: block;
    background: #fafafa;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
  }
  .metric {
    margin-top: 0.5rem;
    font-variant-numeric: tabular-nums;
    color: #374151;
  }
  .samples {
    color: #9ca3af;
  }
  code {
    background: #f3f4f6;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.9em;
  }
</style>
