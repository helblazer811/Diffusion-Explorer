/**
 * Base interface for all animations that integrate with Timeline.
 *
 * Animations encapsulate:
 * - A Clip that updates animation state over time
 * - A draw function that renders based on the current state
 *
 * @example
 * class MyAnimation implements Animation<MyState> {
 *   readonly clip: Clip<MyState>;
 *
 *   draw(ctx: CanvasRenderingContext2D, state: MyState): void {
 *     // Render using state
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
 * @typeParam TState - The animation state type that extends from a base state
 */
export interface Animation<TState> {
  /** Clip for use with Timeline - updates animation state */
  readonly clip: Clip<TState>;

  /** Draw the animation at the current state */
  draw(ctx: CanvasRenderingContext2D, state: TState): void;
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
