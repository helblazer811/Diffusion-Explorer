/**
 * Node.js-compatible exports for scripts.
 * This excludes Svelte components which can't be loaded in Node.js.
 */

// Plotting utilities (no Svelte)
export * from './plotting/streamlines/index';

// Animation utilities (no Svelte)
export {
  propagateStreamlines,
  generateDiscreteStreamlines,
  interpolateCurves,
  getDiscreteSnapshot,
  sampleStreamlineUniformly,
  type PropagatedStreamlineData,
  type DiscreteStreamlineData,
  type PropagateOptions,
  type TimeVaryingVectorFieldFn,
} from './animation/streamline-propagation';
