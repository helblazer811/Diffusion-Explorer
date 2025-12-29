let mathjaxReady = false;
let mathjaxLoading: Promise<void> | null = null;

declare global {
  interface Window {
    MathJax: any;
  }
}

export interface LatexToSvgOptions {
  width?: number;
  height?: number;
  display?: boolean;
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
 * Renders a LaTeX equation to an SVG string
 * @param latex - The LaTeX equation string
 * @param options - Optional settings { width, height, display }
 * @returns Promise<string> - The SVG element as an HTML string
 */
export async function latexToSvg(latex: string, options: LatexToSvgOptions = {}): Promise<string> {
  await loadMathJax();

  const { width, height, display = false } = options;

  const node = await window.MathJax.tex2svgPromise(latex, { display });
  const svg = node.querySelector('svg');

  if (!svg) {
    throw new Error('Failed to generate SVG');
  }

  // Clean up the SVG
  svg.removeAttribute('style');
  if (width) svg.setAttribute('width', String(width));
  if (height) svg.setAttribute('height', String(height));

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

  const { width, height, display = false } = options;

  const node = await window.MathJax.tex2svgPromise(latex, { display });
  const svg = node.querySelector('svg') as SVGSVGElement;

  if (!svg) {
    throw new Error('Failed to generate SVG');
  }

  // Clean up the SVG
  svg.removeAttribute('style');
  if (width) svg.setAttribute('width', String(width));
  if (height) svg.setAttribute('height', String(height));

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
 */
export function placeMathjaxSVG(
  svgElement: SVGSVGElement,
  parentSvg: SVGSVGElement,
  anchorX: number,
  anchorY: number,
  offsetX = 0,
  offsetY = 0,
  scaleFactor = 50
): void {
  // Append temporarily off-screen to measure
  svgElement.setAttribute("x", "-1000");
  svgElement.setAttribute("y", "-1000");
  parentSvg.appendChild(svgElement);

  // Get bounding box now that it's in the DOM
  const bbox = svgElement.getBBox();
  const scaledWidth = bbox.width / scaleFactor;
  const scaledHeight = bbox.height / scaleFactor;

  // Compute bottom-center translation
  const translateX = anchorX - scaledWidth / 2 + offsetX;
  const translateY = anchorY - scaledHeight + offsetY;

  // Wrap in a <g> at the correct position
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("transform", `translate(${translateX}, ${translateY})`);

  // Move the SVG into the <g> and reset x/y
  parentSvg.removeChild(svgElement);
  svgElement.removeAttribute("x");
  svgElement.removeAttribute("y");
  g.appendChild(svgElement);
  parentSvg.appendChild(g);
}
