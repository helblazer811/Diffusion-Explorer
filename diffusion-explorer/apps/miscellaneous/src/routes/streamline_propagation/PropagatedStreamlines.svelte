<script lang="ts">
  import { useCanvas2D, drawStreamlinePath } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    path: Path2D;
    canvasWidth?: number;
    canvasHeight?: number;
    streamlineColor?: string;
    streamlineWidth?: number;
    streamlineOpacity?: number;
  }

  let {
    path,
    canvasWidth = 350,
    canvasHeight = 350,
    streamlineColor = "#3b82f6",
    streamlineWidth = 2.5,
    streamlineOpacity = 0.8,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  let ctx = $derived(canvas && canvas2d.ctx);

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(width: number, height: number) {
    if (!ctx || !path) return;

    ctx.clearRect(0, 0, width, height);

    // Draw pre-computed Path2D (fast - just a single stroke call)
    drawStreamlinePath(ctx, path, {
      color: streamlineColor,
      strokeWidth: streamlineWidth,
      opacity: streamlineOpacity,
    });
  }

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $effect(() => {
    if (ctx && path) {
      draw(canvasWidth, canvasHeight);
    }
  });
</script>

<canvas
  bind:this={canvas}
  use:canvas2d.bindCanvas
  width={canvasWidth}
  height={canvasHeight}
  style="width: {canvasWidth}px; height: {canvasHeight}px;"
></canvas>

<style>
  canvas {
    display: block;
    background: #f9f9f9;
    border-radius: 4px;
  }
</style>
