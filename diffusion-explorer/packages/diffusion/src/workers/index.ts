/**
 * Workers for diffusion and flow matching models.
 *
 * These workers are designed to be loaded by URL in browser environments.
 * They handle sampling and training operations off the main thread.
 *
 * Available workers:
 * - flow_model.worker.ts: Handles flow matching model operations
 *   - Message types: sample, sample_from_initial_points, sample_grid, vector_field_grid, train, train_rectified, stop
 *
 * - diffusion_model.worker.ts: Handles diffusion model operations
 *   - Message types: sample, sample_from_initial_points, sample_grid, train, stop
 *
 * Usage example (with bundler):
 * ```typescript
 * // In SvelteKit/Vite
 * import FlowWorker from '@diffusion-explorer/diffusion/workers/flow_model.worker?worker';
 * const worker = new FlowWorker();
 *
 * // Or with URL
 * const worker = new Worker('/workers/diffusion_model.worker.js', { type: 'module' });
 * ```
 */

// Worker message types (for reference)
export type FlowWorkerMessageType =
  | 'sample'
  | 'sample_from_initial_points'
  | 'sample_grid'
  | 'vector_field_grid'
  | 'train'
  | 'train_rectified'
  | 'stop'
  | 'stop_training';

export type DiffusionWorkerMessageType =
  | 'sample'
  | 'sample_from_initial_points'
  | 'sample_grid'
  | 'train'
  | 'stop'
  | 'stop_training';

// Response message types
export type WorkerResponseType =
  | 'step'
  | 'epoch_chunk'
  | 'rectified_step_complete'
  | 'result'
  | 'cancelled'
  | 'error'
  | 'status';
