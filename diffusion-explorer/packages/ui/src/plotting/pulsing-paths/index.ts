/**
 * Pulsing paths rendering module.
 *
 * Provides GPU-accelerated rendering of animated pulses along arbitrary paths.
 */

export {
  PulsingPathsRenderer,
  preparePathData,
  parseColor,
} from './gpu';

export type {
  PulsingPathsRendererOptions,
  PulsingPathsRenderStyle,
  PulsingPathsGPUData,
  PulsingPathsUniforms,
  PathSegment,
  WebGPUContext,
  RGBAColor,
} from './gpu';
