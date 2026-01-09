# Figure Component Design Pattern

## Section Order

Figures should organize code in the following section order, each separated by a wide comment:

```svelte
<script lang="ts">
// ----------------------------------------------------------------
// Props
// ----------------------------------------------------------------
// Component interface - data, layout, styling, animation props

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------
// Local variables: canvas, ctx, scales, flags, animation state type

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
// Pure utility functions (lerp, coordinate transforms, etc.)

// ----------------------------------------------------------------
// Setup
// ----------------------------------------------------------------
// runInitialComputation() - compute data depending on props

// ----------------------------------------------------------------
// Animations
// ----------------------------------------------------------------
// setupTimeline() - configure timeline, clips, onTick

// ----------------------------------------------------------------
// Drawing
// ----------------------------------------------------------------
// Draw helpers + main draw(state) function

// ----------------------------------------------------------------
// Event Handlers
// ----------------------------------------------------------------
// Canvas clicks, slider input, visibility changes

// ----------------------------------------------------------------
// Lifecycle
// ----------------------------------------------------------------
// onMount, onDestroy

// ----------------------------------------------------------------
// Reactive Blocks
// ----------------------------------------------------------------
// $: statements that tie everything together
</script>
```

## Standard Function Names

| Function | Purpose |
|----------|---------|
| `draw(state)` | Main draw function. Takes animation state, NOT time. |
| `setupTimeline()` | Configure timeline, add clips, register onTick callback |
| `runInitialComputation()` | Compute data that depends on props (scales, pixel coords) |

## Draw Function Structure

Organize `draw(state)` into two logical sub-sections:

1. **Static Background** - Elements that don't depend on animation state
2. **Dynamic Foreground** - Elements that change with animation state

```typescript
function draw(state: AnimationState) {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  // --- Static Background ---
  // Target distribution, labels, axes, grid lines
  drawScatterPlot(ctx, scaledTargetDistribution, ...);
  drawLabels(ctx);

  // --- Dynamic Foreground ---
  // Trajectories, animated points, time-dependent elements
  const { segmentIndex } = state;
  drawTrajectories(ctx, trajectories, segmentIndex, ...);
  drawAnimatedPoint(ctx, currentPosition);
}
```

This separation makes it clear which elements are animated and helps identify opportunities for optimization (e.g., caching static elements to an offscreen canvas).

## Animation State Type

Use `AnimationState` as the standard type name for animation state:

```typescript
type AnimationState = {
  time: number;  // WARNING: Using time in draw() is an antipattern. Prefer derived state.
  segmentIndex: number;
  // ... other component-specific derived state
};
```

The state should contain derived values computed from time (e.g., `segmentIndex`), not just raw time. Including `time` is acceptable but discouraged - prefer computing all needed state in the clip's `reduce()` function.

## Key Principles

- **`draw()` depends on state, not time.** Time updates animation state via clips; `draw()` renders that state.
- **Clips are reducers.** They take time `t` and return partial state updates.
- **`onTick` bridges Timeline to Svelte.** The callback updates local variables and calls `draw()`.

## Visibility Handling

All animated figures **MUST** handle visibility to prevent background CPU usage when scrolled off-screen.

Use the `useVisibilityHandler` hook:

```typescript
import { useVisibilityHandler } from '@diffusion-explorer/ui';

let figureIsActive;
const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

// In reactive blocks section:
$: if (figureIsActive !== undefined && isInitialized) {
  handleVisibilityChange($figureIsActive);
}
```

And bind the visibility store in the template:

```svelte
<Figure bind:isActive={figureIsActive}>
  <!-- canvas content -->
</Figure>
```

This pauses animations when the figure scrolls out of view and resumes when it returns.
