let mathjaxReady = false;
let mathjaxLoading: Promise<void> | null = null;

// Reference character for font size calibration (fontSize = height of this char)
const REFERENCE_CHAR = 'M';
let referenceViewBoxHeight: number | null = null;

// Cache for rendered MathJax images: key -> { img, aspectRatio, vbHeight }
const mathjaxCache = new Map<string, { img: HTMLImageElement; aspectRatio: number; vbHeight: number }>();

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

/**
 * Applies fill and stroke styles to all paths in an SVG element
 */
function applyStylesToSvg(
  svg: SVGSVGElement,
  options: { color?: string; stroke?: string; strokeWidth?: number }
): void {
  const { color, stroke, strokeWidth } = options;

  // MathJax renders text as <path> elements
  const paths = svg.querySelectorAll('path');
  paths.forEach(path => {
    if (color) {
      path.setAttribute('fill', color);
    }
    if (stroke) {
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', String(strokeWidth ?? 1));
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
 * Places a MathJax SVG element with bottom-center anchor point
 * @param svgElement - The SVG element to place (will be cloned)
 * @param parentSvg - The parent SVG to append to
 * @param anchorX - X coordinate of anchor point
 * @param anchorY - Y coordinate of anchor point
 * @param offsetX - Optional horizontal offset
 * @param offsetY - Optional vertical offset
 * @param scaleFactor - Scale factor for the SVG dimensions (default 50)
 * @param sizeMultiplier - Visual scale multiplier (default 1, e.g., 1.5 = 50% larger)
 */
export function placeMathjaxSVG(
  svgElement: SVGSVGElement,
  parentSvg: SVGSVGElement,
  anchorX: number,
  anchorY: number,
  offsetX = 0,
  offsetY = 0,
  scaleFactor = 50,
  sizeMultiplier = 1
): void {
  // Get dimensions from viewBox (consistent across browsers)
  const viewBox = svgElement.getAttribute('viewBox')?.split(' ').map(Number);

  let scaledWidth: number;
  let scaledHeight: number;

  if (viewBox && viewBox.length === 4) {
    const [, , vbWidth, vbHeight] = viewBox;
    scaledWidth = (vbWidth / scaleFactor) * sizeMultiplier;
    scaledHeight = (vbHeight / scaleFactor) * sizeMultiplier;
  } else {
    // Fallback: append to DOM and measure (old behavior)
    svgElement.setAttribute("x", "-1000");
    svgElement.setAttribute("y", "-1000");
    parentSvg.appendChild(svgElement);
    const bboxFallback = svgElement.getBBox();
    parentSvg.removeChild(svgElement);
    scaledWidth = (bboxFallback.width / scaleFactor) * sizeMultiplier;
    scaledHeight = (bboxFallback.height / scaleFactor) * sizeMultiplier;
  }

  // Compute bottom-center translation
  const translateX = anchorX - scaledWidth / 2 + offsetX;
  const translateY = anchorY - scaledHeight + offsetY;

  // Wrap in a <g> at the correct position
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("transform", `translate(${translateX}, ${translateY})`);

  // Reset x/y attributes if they were set
  svgElement.removeAttribute("x");
  svgElement.removeAttribute("y");

  // Apply visual scale transform
  if (sizeMultiplier !== 1) {
    svgElement.setAttribute("transform-origin", "0 0");
    svgElement.setAttribute("transform", `scale(${sizeMultiplier})`);
  }

  g.appendChild(svgElement);
  parentSvg.appendChild(g);
}

/**
 * Draws an SVG onto a canvas at the specified position.
 * @param ctx - Canvas 2D rendering context
 * @param svgElement - The SVG element to draw
 * @param x - X coordinate of the anchor point (bottom-center)
 * @param y - Y coordinate of the anchor point (bottom-center)
 * @param fontSize - Height of the rendered SVG in pixels
 * @param offsetX - Optional horizontal offset (default 0)
 * @param offsetY - Optional vertical offset (default 0)
 * @returns Promise that resolves when drawing is complete
 */
export async function drawSVGOnCanvas(
  ctx: CanvasRenderingContext2D,
  svgElement: SVGSVGElement,
  x: number,
  y: number,
  fontSize: number,
  offsetX = 0,
  offsetY = 0
): Promise<void> {
  // Get viewBox for aspect ratio
  const viewBox = svgElement.getAttribute('viewBox')?.split(' ').map(Number);
  if (!viewBox || viewBox.length !== 4) {
    console.warn('SVG missing viewBox');
    return;
  }

  const [, , vbWidth, vbHeight] = viewBox;
  const aspectRatio = vbWidth / vbHeight;
  const height = fontSize;
  const width = height * aspectRatio;

  // Set dimensions on SVG clone
  const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
  svgClone.setAttribute('width', String(width));
  svgClone.setAttribute('height', String(height));

  // Convert to data URL and draw
  const svgString = new XMLSerializer().serializeToString(svgClone);
  const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => {
      const drawX = x - width / 2 + offsetX;
      const drawY = y - height + offsetY;
      ctx.drawImage(img, drawX, drawY, width, height);
      resolve();
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Draws a LaTeX formula onto a canvas. Caches rendered formulas for performance.
 * Font size is calibrated so that "M" renders at exactly fontSize pixels.
 * Other characters scale proportionally (e.g., "x" will be smaller than "M").
 * @param ctx - Canvas 2D rendering context
 * @param latex - LaTeX formula string
 * @param x - X coordinate of the anchor point (bottom-center)
 * @param y - Y coordinate of the anchor point (bottom-center)
 * @param fontSize - Height of uppercase "M" in pixels (other chars scale proportionally)
 * @param offsetX - Optional horizontal offset (default 0)
 * @param offsetY - Optional vertical offset (default 0)
 * @param options - Optional styling { color, stroke, strokeWidth }
 * @returns Promise that resolves when drawing is complete
 */
export async function drawMathjaxOnCanvas(
  ctx: CanvasRenderingContext2D,
  latex: string,
  x: number,
  y: number,
  fontSize: number,
  offsetX = 0,
  offsetY = 0,
  options: { color?: string; stroke?: string; strokeWidth?: number } = {}
): Promise<void> {
  // Create cache key from latex + styling options
  const cacheKey = `${latex}|${options.color ?? ''}|${options.stroke ?? ''}|${options.strokeWidth ?? ''}`;

  let cached = mathjaxCache.get(cacheKey);

  if (!cached) {
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
    const baseHeight = 100; // Large enough for quality
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

    cached = { img, aspectRatio, vbHeight };
    mathjaxCache.set(cacheKey, cached);
  }

  // Get reference height for calibration
  const refHeight = await getReferenceViewBoxHeight();

  // Calculate actual pixel height based on ratio to reference
  // fontSize is the height of "M", scale other chars proportionally
  const scale = cached.vbHeight / refHeight;
  const height = fontSize * scale;
  const width = height * cached.aspectRatio;

  const drawX = x - width / 2 + offsetX;
  const drawY = y - height + offsetY;

  ctx.drawImage(cached.img, drawX, drawY, width, height);
}
