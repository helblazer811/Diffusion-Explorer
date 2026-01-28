/**
 * Base interface for all animations that integrate with Timeline.
 *
 * Animations encapsulate:
 * - A Clip that updates animation state over time
 * - An init function to bind the animation to a canvas
 * - A draw function that renders based on the current state
 * - A destroy function for cleanup
 *
 * @example
 * class MyAnimation implements Animation<MyState> {
 *   readonly clip: Clip<MyState>;
 *   private ctx: CanvasRenderingContext2D | null = null;
 *   private _initialized = false;
 *
 *   async init(canvas: HTMLCanvasElement): Promise<void> {
 *     const ctx = canvas.getContext('2d');
 *     if (!ctx) throw new Error('Failed to get 2D context');
 *     this.ctx = ctx;
 *     this._initialized = true;
 *   }
 *
 *   get initialized(): boolean { return this._initialized; }
 *
 *   draw(state: MyState): void {
 *     if (!this.ctx) return;
 *     // Render using state and this.ctx
 *   }
 *
 *   destroy(): void {
 *     this.ctx = null;
 *     this._initialized = false;
 *   }
 *
 *   static create(options: MyOptions): MyAnimation {
 *     return new MyAnimation(options);
 *   }
 * }
 */

import type { Clip } from './timeline';

/**
 * Base animation interface.
 *
 * All animations follow a consistent lifecycle:
 * 1. create() - Create the animation instance
 * 2. init(canvas) - Bind to a canvas and store context
 * 3. draw(state) - Render using stored context
 * 4. destroy() - Clean up resources
 *
 * @typeParam TState - The animation state type that extends from a base state
 */
export interface Animation<TState> {
  /** Clip for use with Timeline - updates animation state */
  readonly clip: Clip<TState>;

  /** Initialize with a canvas element. Stores context internally. */
  init(canvas: HTMLCanvasElement): Promise<void>;

  /** Check if the animation has been initialized */
  readonly initialized: boolean;

  /** Draw the animation at the current state using stored context */
  draw(state: TState): void;

  /** Clean up resources */
  destroy(): void;
}

/**
 * Extended animation interface with additional data access.
 *
 * Use this when the animation exposes computed data that consumers
 * might need to access (e.g., generated streamlines, trajectories).
 *
 * @typeParam TState - The animation state type
 * @typeParam TData - The type of data exposed by the animation
 */
export interface AnimationWithData<TState, TData> extends Animation<TState> {
  /** Access to underlying computed data */
  readonly data: TData;
}
