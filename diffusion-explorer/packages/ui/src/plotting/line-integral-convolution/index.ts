/**
 * Line Integral Convolution (LIC) module for vector field visualization.
 *
 * LIC produces a texture-like visualization that shows flow direction
 * by convolving a noise texture along streamlines of the vector field.
 *
 * @example
 * ```typescript
 * import { computeLIC, isWebGPUAvailable } from '@diffusion-explorer/ui';
 *
 * if (await isWebGPUAvailable()) {
 *   const result = await computeLIC({
 *     vectorField: (x, y) => [y, -x],
 *     domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *     width: 512,
 *     height: 512,
 *   });
 *   ctx.putImageData(result.toImageData(), 0, 0);
 * }
 * ```
 */

export type {
  LICDomain,
  LICOptions,
  LICResult,
  LICColorOptions,
  ColorPalette,
  RGBColor,
  WebGPUContext,
  VectorFieldFn,
  // DLIC types
  DLICOptions,
  DLICResult,
  TimeVaryingVectorFieldFn
} from './types';

export {
  isWebGPUAvailable,
  initWebGPUContext,
  computeLIC,
  drawLIC,
  // Color palettes
  viridis,
  plasma,
  inferno,
  coolwarm,
  turbo
} from './line-integral-convolution';

export {
  computeDLIC,
  drawDLIC
} from './dynamic-line-integral-convolution';
