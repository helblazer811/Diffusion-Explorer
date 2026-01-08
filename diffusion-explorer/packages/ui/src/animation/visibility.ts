import type { Timeline } from './timeline';

export type VisibilityState = {
  wasPlayingBeforeHidden: boolean;
};

/**
 * Creates a visibility handler for a Timeline.
 * Pauses animation when figure becomes invisible, resumes when visible again.
 *
 * Usage in Svelte component:
 * ```svelte
 * <script lang="ts">
 *   import { createVisibilityHandler } from '@diffusion-explorer/ui';
 *
 *   let timeline: Timeline<AnimationState> | null = null;
 *   let figureIsActive;
 *
 *   const { handleVisibilityChange } = createVisibilityHandler(() => timeline);
 *
 *   $: if (figureIsActive !== undefined && isInitialized) {
 *     handleVisibilityChange($figureIsActive);
 *   }
 * </script>
 *
 * <Figure bind:isActive={figureIsActive}>
 *   ...
 * </Figure>
 * ```
 *
 * @param getTimeline - Function that returns the timeline instance (or null if not yet created)
 * @returns Object containing visibility state and handler function
 */
export function createVisibilityHandler<TState>(
  getTimeline: () => Timeline<TState> | null
): {
  state: VisibilityState;
  handleVisibilityChange: (isActive: boolean) => void;
} {
  const state: VisibilityState = { wasPlayingBeforeHidden: false };

  function handleVisibilityChange(isActive: boolean) {
    const timeline = getTimeline();
    if (!timeline) return;

    if (!isActive && timeline.isPlaying) {
      state.wasPlayingBeforeHidden = true;
      timeline.pause();
    } else if (isActive && state.wasPlayingBeforeHidden) {
      state.wasPlayingBeforeHidden = false;
      timeline.play();
    }
  }

  return { state, handleVisibilityChange };
}
