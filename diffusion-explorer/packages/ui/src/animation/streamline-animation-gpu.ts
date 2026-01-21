/**
 * @deprecated Use StreamlineAnimation with { backend: 'gpu' } instead.
 *
 * This module is kept for backward compatibility. New code should use
 * the unified StreamlineAnimation class with the backend option.
 *
 * @example
 * // Old (deprecated):
 * import { StreamlineAnimationGPU } from './streamline-animation-gpu';
 * const anim = StreamlineAnimationGPU.create({ ... });
 *
 * // New (recommended):
 * import { StreamlineAnimation } from './streamline-animation';
 * const anim = StreamlineAnimation.create({ backend: 'gpu', ... });
 */

import {
  StreamlineAnimation,
  type StreamlineAnimationState,
} from './streamline-animation';
import type { StreamlineAnimationGPUOptions } from './streamline-animation.types';

// Re-export types with deprecated aliases
export type StreamlineAnimationGPUState = StreamlineAnimationState;
export type { StreamlineAnimationGPUOptions };
export type StreamlineGPUDomain = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};
export type StreamlineGPULengthData = {
  cumulativeLengths: number[];
  totalLength: number;
};
export type StreamlineGPUData = {
  streamlines: number[][][];
  offsets: number[];
  lengthData: StreamlineGPULengthData[];
  maxLength: number;
};

/**
 * @deprecated Use StreamlineAnimation with { backend: 'gpu' } instead.
 *
 * GPU-accelerated animated streamlines for visualizing vector fields.
 * This class is provided for backward compatibility.
 */
export class StreamlineAnimationGPU<TState extends StreamlineAnimationGPUState> {
  private readonly impl: StreamlineAnimation<TState>;

  private constructor(impl: StreamlineAnimation<TState>) {
    this.impl = impl;
  }

  get clip() {
    return this.impl.clip;
  }

  get data(): StreamlineGPUData {
    return this.impl.data;
  }

  get initialized() {
    return this.impl.initialized;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    return this.impl.init(canvas);
  }

  render(
    state: TState,
    clearColor: [number, number, number, number] = [0, 0, 0, 0]
  ): void {
    this.impl.render(state, clearColor);
  }

  draw(_ctx: CanvasRenderingContext2D, _state: TState): void {
    console.warn(
      'StreamlineAnimationGPU.draw() called - use render() for GPU rendering'
    );
  }

  updateOptions(options: Parameters<typeof this.impl.updateOptions>[0]): void {
    this.impl.updateOptions(options);
  }

  resize(width: number, height: number, dpr?: number): void {
    this.impl.resize(width, height, dpr);
  }

  getRenderer() {
    return this.impl.getRenderer();
  }

  destroy(): void {
    this.impl.destroy();
  }

  /**
   * @deprecated Use StreamlineAnimation.create({ backend: 'gpu', ... }) instead.
   */
  static create<TState extends StreamlineAnimationGPUState>(
    options: Omit<StreamlineAnimationGPUOptions, 'backend'>
  ): StreamlineAnimationGPU<TState> {
    console.warn(
      'StreamlineAnimationGPU.create() is deprecated. ' +
      'Use StreamlineAnimation.create({ backend: "gpu", ... }) instead.'
    );
    const impl = StreamlineAnimation.createGPU<TState>({
      ...options,
      backend: 'gpu',
    });
    return new StreamlineAnimationGPU(impl);
  }
}
