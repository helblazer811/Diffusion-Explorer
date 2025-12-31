import katex from 'katex';

/**
 * Render LaTeX to an SVG string using KaTeX with embedded style
 * @param latex - The LaTeX string
 * @returns SVG string
 */
export function latexToSVG(latex: string): string {
  const result = katex.renderToString(latex, {
    output: 'html',
    throwOnError: false,
    trust: true
  });
  console.log("KaTeX output:", result.substring(0, 300));
  return result;
}

/**
 * Render an SVG string onto a canvas context, preserving KaTeX appearance
 * @param ctx - Canvas 2D context
 * @param svgString - SVG string
 * @param scale - Optional scale factor
 */
export function drawSVGOnContext(
  ctx: CanvasRenderingContext2D,
  svgString: string,
  scale: number = 1
): void {
  const img = new Image();
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  img.onload = () => {
    // Parse viewBox from SVG to get exact width/height
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
    const viewBox = svgDoc.documentElement.getAttribute('viewBox')?.split(' ').map(Number);
    let width = img.width;
    let height = img.height;

    if (viewBox && viewBox.length === 4) {
      width = viewBox[2];
      height = viewBox[3];
    }

    const canvas = ctx.canvas;
    canvas.width = width * scale;
    canvas.height = height * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0); // scale drawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, width, height);

    URL.revokeObjectURL(url); // free memory
  };

  img.src = url;
}

/**
 * Convenience function: render LaTeX directly onto a canvas context
 * @param ctx - Canvas 2D context
 * @param latex - LaTeX string
 * @param scale - Optional scale factor
 */
export function renderLatexToContext(
  ctx: CanvasRenderingContext2D,
  latex: string,
  scale: number = 1
): void {
  const svgString = latexToSVG(latex);
  drawSVGOnContext(ctx, svgString, scale);
}

export interface KatexImageInfo {
  img: HTMLImageElement;
  width: number;
  height: number;
}

/**
 * Pre-render a LaTeX string to an Image that can be drawn on canvas.
 * @param latex - The LaTeX string
 * @param scale - Scale factor (default: 1)
 * @returns Promise resolving to image info with dimensions
 */
export async function renderLatexToImage(
  latex: string,
  scale: number = 1
): Promise<KatexImageInfo> {
  const svgString = latexToSVG(latex);

  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl = svgDoc.documentElement;

  // Get dimensions from viewBox or width/height attributes
  const viewBox = svgEl.getAttribute('viewBox');
  let width = 100, height = 30; // fallback
  if (viewBox) {
    const parts = viewBox.split(' ').map(parseFloat);
    if (parts.length === 4) {
      width = parts[2] * scale;
      height = parts[3] * scale;
    }
  }

  // Set explicit width/height on SVG for proper image sizing
  svgEl.setAttribute('width', `${width}px`);
  svgEl.setAttribute('height', `${height}px`);

  const updatedSvg = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([updatedSvg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ img, width, height });
    };
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Draw a pre-rendered KaTeX image on canvas at the specified position.
 * @param ctx - Canvas 2D context
 * @param imageInfo - Pre-rendered KaTeX image info
 * @param x - X position (center of label)
 * @param y - Y position (bottom of label)
 * @param options - Drawing options
 */
export function drawKatexLabel(
  ctx: CanvasRenderingContext2D,
  imageInfo: KatexImageInfo,
  x: number,
  y: number,
  options: { offsetY?: number } = {}
): void {
  const { offsetY = -5 } = options;
  const drawX = x - imageInfo.width / 2;
  const drawY = y + offsetY - imageInfo.height;

  ctx.drawImage(
    imageInfo.img,
    drawX,
    drawY,
    imageInfo.width,
    imageInfo.height
  );
}
