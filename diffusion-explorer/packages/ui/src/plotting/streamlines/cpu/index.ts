/**
 * CPU-based streamline rendering module.
 *
 * Provides Canvas 2D rendering of streamlines with:
 * - Static streamline drawing with optional chevron markers
 * - Animated pulse effects using precomputed alpha LUTs
 * - Path2D generation for efficient repeated draws
 */

export {
  createAlphaLUT,
  precomputePatternIndices,
  computeAlphaTrail,
} from './alpha';

export {
  drawStreamlines,
  generateStreamlinePath2D,
  drawStreamlinePath,
  type ChevronStyle,
  type DrawStreamlinesOptions,
  type DrawStreamlinePathOptions,
} from './drawing';
