let mathjaxReady = false;
let mathjaxLoading: Promise<void> | null = null;

// Reference character for font size calibration (fontSize = height of this char)
const REFERENCE_CHAR = 'M';
let referenceViewBoxHeight: number | null = null;

// Cache for rendered MathJax images: key -> { img, aspectRatio, vbHeight }
const mathjaxCache = new Map<string, { img: HTMLImageElement; aspectRatio: number; vbHeight: number }>();

// Track formulas currently being rendered
const pendingRenders = new Set<string>();

// Style options type
export type MathjaxStyleOptions = {
  color?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
};

declare global {
  interface Window {
    MathJax: any;
  }
}

export interface LatexToSvgOptions {
  width?: number;
  height?: number;
  display?: boolean;
  // Styling options
  color?: string;           // Fill color (e.g., "#333", "red")
  stroke?: string;          // Outline color
  strokeWidth?: number;     // Outline width in pixels
  strokeOpacity?: number;   // Outline opacity (0-1)
}

/**
 * Loads MathJax library. Safe to call multiple times - will only load once.
 * @returns Promise that resolves when MathJax is ready
 */
export async function loadMathJax(): Promise<void> {
  if (mathjaxReady) return;
  if (mathjaxLoading) return mathjaxLoading;

  mathjaxLoading = new Promise((resolve, reject) => {
    window.MathJax = {
      loader: { load: ['input/tex', 'output/svg'] },
      tex: { packages: ['base', 'ams'] },
      svg: { fontCache: 'none' },
      startup: { typeset: false }
    };

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js';
    script.async = true;
    script.onload = async () => {
      await window.MathJax.startup.promise;
      mathjaxReady = true;
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return mathjaxLoading;
}

/**
 * Get the viewBox height of the reference character (cached).
 * This is used to calibrate font sizes so that fontSize = height of "M".
 */
async function getReferenceViewBoxHeight(): Promise<number> {
  if (referenceViewBoxHeight !== null) {
    return referenceViewBoxHeight;
  }

  await loadMathJax();
  const node = await window.MathJax.tex2svgPromise(REFERENCE_CHAR, { display: false });
  const svg = node.querySelector('svg') as SVGSVGElement;

  if (!svg) {
    console.warn('Failed to get reference character, using fallback');
    return 680; // Approximate fallback
  }

  const viewBox = svg.getAttribute('viewBox')?.split(' ').map(Number);
  if (!viewBox || viewBox.length !== 4) {
    return 680;
  }

  referenceViewBoxHeight = viewBox[3]; // vbHeight
  return referenceViewBoxHeight;
}

// Auto-initialize MathJax when module is imported in browser
// Export promise so consumers can await initialization before drawing
export const mathjaxInitialized: Promise<void> = typeof window !== 'undefined'
  ? getReferenceViewBoxHeight().then(() => {})
  : Promise.resolve();

/**
 * Build cache key from latex string and styling options
 */
function buildCacheKey(latex: string, options: MathjaxStyleOptions): string {
  return `${latex}|${options.color ?? ''}|${options.stroke ?? ''}|${options.strokeWidth ?? ''}|${options.strokeOpacity ?? ''}`;
}

/**
 * Render a formula to the cache (async, called in background)
 */
async function renderToCache(latex: string, options: MathjaxStyleOptions): Promise<void> {
  const cacheKey = buildCacheKey(latex, options);
  if (mathjaxCache.has(cacheKey)) return;

  // Render LaTeX to SVG
  const svg = await latexToSvgElement(latex, options);

  // Get aspect ratio from viewBox
  const viewBox = svg.getAttribute('viewBox')?.split(' ').map(Number);
  if (!viewBox || viewBox.length !== 4) {
    console.warn('MathJax SVG missing viewBox');
    return;
  }

  const [, , vbWidth, vbHeight] = viewBox;
  const aspectRatio = vbWidth / vbHeight;

  // Render at a base size for caching (we'll scale when drawing)
  const baseHeight = 100;
  const baseWidth = baseHeight * aspectRatio;

  svg.setAttribute('width', String(baseWidth));
  svg.setAttribute('height', String(baseHeight));

  // Convert to image
  const svgString = new XMLSerializer().serializeToString(svg);
  const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = dataUrl;
  });

  mathjaxCache.set(cacheKey, { img, aspectRatio, vbHeight });
}

/**
 * Applies fill and stroke styles to all paths in an SVG element
 */
function applyStylesToSvg(
  svg: SVGSVGElement,
  options: { color?: string; stroke?: string; strokeWidth?: number; strokeOpacity?: number }
): void {
  const { color, stroke, strokeWidth, strokeOpacity } = options;

  // MathJax renders text as <path> elements
  const paths = svg.querySelectorAll('path');
  paths.forEach(path => {
    if (color) {
      path.setAttribute('fill', color);
    }
    if (stroke) {
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', String(strokeWidth ?? 1));
      if (strokeOpacity !== undefined) {
        path.setAttribute('stroke-opacity', String(strokeOpacity));
      }
      // Ensure stroke is painted behind fill
      path.setAttribute('paint-order', 'stroke fill');
    }
  });
}

/**
 * Renders a LaTeX equation to an SVG string
 * @param latex - The LaTeX equation string
 * @param options - Optional settings { width, height, display }
 * @returns Promise<string> - The SVG element as an HTML string
 */
export async function latexToSvg(latex: string, options: LatexToSvgOptions = {}): Promise<string> {
  await loadMathJax();

  const { width, height, display = false, color, stroke, strokeWidth } = options;

  const node = await window.MathJax.tex2svgPromise(latex, { display });
  const svg = node.querySelector('svg');

  if (!svg) {
    throw new Error('Failed to generate SVG');
  }

  // Clean up the SVG
  svg.removeAttribute('style');
  if (width) svg.setAttribute('width', String(width));
  if (height) svg.setAttribute('height', String(height));

  // Apply styling
  applyStylesToSvg(svg, { color, stroke, strokeWidth });

  return svg.outerHTML;
}

/**
 * Renders a LaTeX equation to an SVG element
 * @param latex - The LaTeX equation string
 * @param options - Optional settings { width, height, display }
 * @returns Promise<SVGElement> - The SVG element
 */
export async function latexToSvgElement(latex: string, options: LatexToSvgOptions = {}): Promise<SVGSVGElement> {
  await loadMathJax();

  const { width, height, display = false, color, stroke, strokeWidth } = options;

  const node = await window.MathJax.tex2svgPromise(latex, { display });
  const svg = node.querySelector('svg') as SVGSVGElement;

  if (!svg) {
    throw new Error('Failed to generate SVG');
  }

  // Clean up the SVG
  svg.removeAttribute('style');
  if (width) svg.setAttribute('width', String(width));
  if (height) svg.setAttribute('height', String(height));

  // Apply styling
  applyStylesToSvg(svg, { color, stroke, strokeWidth });

  return svg;
}

/**
 * Draws a LaTeX formula onto a canvas synchronously.
 * MathJax auto-initializes on module import. If a formula isn't cached yet,
 * it queues background rendering and skips this frame.
 *
 * @param ctx - Canvas 2D rendering context
 * @param latex - LaTeX formula string
 * @param x - X coordinate of the anchor point (bottom-center)
 * @param y - Y coordinate of the anchor point (bottom-center)
 * @param fontSize - Height of uppercase "M" in pixels (other chars scale proportionally)
 * @param offsetX - Optional horizontal offset (default 0)
 * @param offsetY - Optional vertical offset (default 0)
 * @param options - Optional styling { color, stroke, strokeWidth, strokeOpacity }
 * @param requestRedraw - Optional callback invoked when background rendering completes
 */
export function drawMathjax(
  ctx: CanvasRenderingContext2D,
  latex: string,
  x: number,
  y: number,
  fontSize: number,
  offsetX = 0,
  offsetY = 0,
  options: MathjaxStyleOptions = {},
  requestRedraw?: () => void
): void {
  // If MathJax not ready yet, skip silently (it's loading)
  if (referenceViewBoxHeight === null) {
    return;
  }

  const cacheKey = buildCacheKey(latex, options);
  const cached = mathjaxCache.get(cacheKey);

  if (!cached) {
    // Not cached yet - queue background render and skip this frame
    if (!pendingRenders.has(cacheKey)) {
      pendingRenders.add(cacheKey);
      renderToCache(latex, options).then(() => {
        pendingRenders.delete(cacheKey);
        if (requestRedraw) requestRedraw();
      });
    }
    return;
  }

  // Synchronous drawing
  const scale = cached.vbHeight / referenceViewBoxHeight;
  const height = fontSize * scale;
  const width = height * cached.aspectRatio;
  const drawX = x - width / 2 + offsetX;
  const drawY = y - height + offsetY;
  ctx.drawImage(cached.img, drawX, drawY, width, height);
}
