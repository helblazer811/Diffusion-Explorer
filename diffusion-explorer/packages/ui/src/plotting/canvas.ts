/**
 * Creates a canvas 2D context manager with DPR-aware initialization.
 *
 * Usage with Svelte action:
 *   const canvas2d = useCanvas2D(width, height);
 *   <canvas use:canvas2d.bindCanvas />
 *
 * Usage with bind:this:
 *   const canvas2d = useCanvas2D(width, height);
 *   <canvas bind:this={canvas2d.canvas} />
 *   // Then call canvas2d.init() after mount
 */
export function useCanvas2D(width: number, height: number) {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;

  function resize(w: number = width, h: number = height) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // Svelte action for use:bindCanvas
  function bindCanvas(el: HTMLCanvasElement) {
    canvas = el;
    resize();
    return {
      destroy() {
        canvas = null;
        ctx = null;
      }
    };
  }

  // Manual init for bind:this pattern
  function init(el: HTMLCanvasElement) {
    canvas = el;
    resize();
  }

  return {
    /** Svelte action - use as: <canvas use:canvas2d.bindCanvas /> */
    bindCanvas,
    /** Manual init - call after bind:this */
    init,
    /** Resize canvas (call when dimensions change) */
    resize,
    /** Get the canvas element */
    get canvas() { return canvas; },
    /** Get the 2D rendering context */
    get ctx() { return ctx; }
  };
}

/**
 * Creates a canvas manager for WebGPU rendering.
 * Does NOT get a 2D context - canvas remains pristine for WebGPU.
 *
 * Usage with Svelte action:
 *   const canvasGPU = useCanvasWebGPU(width, height);
 *   <canvas use:canvasGPU.bindCanvas />
 *
 * Usage with bind:this:
 *   const canvasGPU = useCanvasWebGPU(width, height);
 *   <canvas bind:this={canvasGPU.canvas} />
 *   // Then call canvasGPU.init() after mount
 */
export function useCanvasWebGPU(width: number, height: number) {
  let canvas: HTMLCanvasElement | null = null;

  function resize(w: number = width, h: number = height) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    // Do NOT get context - leave pristine for WebGPU
  }

  // Svelte action for use:bindCanvas
  function bindCanvas(el: HTMLCanvasElement) {
    canvas = el;
    resize();
    return {
      destroy() {
        canvas = null;
      }
    };
  }

  // Manual init for bind:this pattern
  function init(el: HTMLCanvasElement) {
    canvas = el;
    resize();
  }

  return {
    /** Svelte action - use as: <canvas use:canvasGPU.bindCanvas /> */
    bindCanvas,
    /** Manual init - call after bind:this */
    init,
    /** Resize canvas (call when dimensions change) */
    resize,
    /** Get the canvas element */
    get canvas() { return canvas; },
  };
}
