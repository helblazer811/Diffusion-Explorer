/**
 * Shared type definitions for streamline generation and rendering.
 *
 * These types are used by both CPU and GPU backends.
 */

/**
 * Vector field function that returns velocity at a given position.
 */
export type VectorFieldFn = (x: number, y: number) => [number, number];

/**
 * Domain bounds for streamline generation and animation.
 */
export type StreamlineDomain = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

/**
 * Options for streamline generation.
 */
export interface StreamlineOptions {
  domainMin: [number, number];                 // Domain bounds [xMin, yMin]
  domainMax: [number, number];                 // Domain bounds [xMax, yMax]
  density?: number | [number, number];         // Default: 1.0 -> 30x30 mask grid
  integrationDirection?: 'forward' | 'backward' | 'both';  // Default: 'both'
  maxlength?: number;                          // Max streamline length in domain units
  minlength?: number;                          // Min length to keep (reject shorter)
  startPoints?: [number, number][];            // User-specified seeds (optional)
  brokenStreamlines?: boolean;                 // Stop at collisions (default: true)
  maxerror?: number;                           // RK12 error tolerance (default: 0.003)
  segmentLength?: number;                      // If provided, resample to equal-length segments
}

/**
 * Per-streamline length data for animation.
 */
export type StreamlineLengthData = {
  cumulativeLengths: number[];
  totalLength: number;
  /** Precomputed LUT indices for alpha computation (CPU only) */
  patternIndices?: Uint16Array;
};

/**
 * Options for selecting trajectories with a density mask.
 */
export interface SelectTrajectoriesOptions {
  /** Domain bounds [xMin, yMin] */
  domainMin: [number, number];
  /** Domain bounds [xMax, yMax] */
  domainMax: [number, number];
  /** Controls grid density (default 1.0 -> 30x30 grid) */
  density?: number;
  /** Maximum number of trajectories to select */
  maxCount?: number;
}
