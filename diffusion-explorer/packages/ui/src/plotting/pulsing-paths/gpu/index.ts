/**
 * GPU pulsing paths rendering module.
 */

export { PulsingPathsRenderer, preparePathData } from './renderer';
export type {
  PulsingPathsRendererOptions,
  PulsingPathsRenderStyle,
  PulsingPathsGPUData,
  PulsingPathsUniforms,
  PathSegment,
  WebGPUContext,
  RGBAColor,
} from './types';
export { parseColor } from './types';
