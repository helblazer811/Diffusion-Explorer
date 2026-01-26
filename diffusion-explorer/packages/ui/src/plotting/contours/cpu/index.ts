/**
 * CPU-based contour computation and rendering using D3.
 *
 * @module contours/cpu
 */

export {
  computeContours,
  plotContours,
  plotSegments,
  type ContourOptions,
  type ComputedContours,
  type PlotContourOptions,
  type PlotSegmentsOptions,
  type ContourSegmentData,
} from './contours';

export { CPUContourRenderer, type CPUContourRendererOptions } from './renderer';
