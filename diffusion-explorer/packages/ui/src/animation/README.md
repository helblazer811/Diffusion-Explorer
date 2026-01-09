# Animation System

A composable animation system built around Timeline, Clip, and Layer abstractions.
Clips are reducer functions that return partial state updates, enabling conflict
resolution through a priority-based layer system.


## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Timeline                             │
│              (single source of truth)                       │
│                                                             │
│   ┌─────────┐                                               │
│   │  Clock  │ (internal - owns RAF loop)                    │
│   └────┬────┘                                               │
│        │ dt                                                 │
│        ▼                                                    │
│   time: 0 ──────────────────────────────────────────► 1    │
│                                                             │
│   Layer 0 (BASE):        │ Clip A      │ Clip B      │     │
│   Layer 10 (INTERACTION):     │ Ephemeral │            │     │
│                                                             │
│   Higher layers override lower for conflicting state keys   │
│                                                             │
│   Methods: play() | pause() | seek(t) | reset()             │
│            startSeeking() | endSeeking()                    │
└─────────────────────────────────────────────────────────────┘
        ▲                           │
        │ seek()                    │ onTick(time, state)
        │ play/pause                │
        │                           ▼
┌───────────────┐           ┌───────────────┐
│  TimeSlider   │           │    Figure     │
│               │           │               │
│ timeline.seek()│          │ draw(state)   │
│ timeline.play()│          │               │
└───────────────┘           └───────────────┘
```


## Core Concepts

### Clip (Reducer Pattern)
Clips are functions that take time and current state, returning partial state updates.
They close over any external values they need (no params argument).

```typescript
const fadeClip: Clip<State> = {
  name: 'fade',
  duration: 0.5,  // 50% of timeline duration
  reduce(t, current) {
    return { opacity: t };  // Partial state update
  }
};
```

### Layer Priority
Higher layer numbers take precedence for conflicting state keys.
Use built-in constants or any number:

```typescript
Layer.BASE = 0         // Default animations
Layer.INTERACTION = 10 // Hover effects, temporary states
Layer.OVERRIDE = 20    // User-triggered animations
```

### Ephemeral Clips
One-shot clips that auto-remove after playing once. Perfect for click animations.

```typescript
timeline.playClip({
  name: 'flash',
  duration: 0.3,
  reduce(t) { return { flash: 1 - t }; }
});
```

### Instant Clips (duration=0)
For immediate state changes that should appear on the timeline for debugging.

```typescript
timeline.setState('click', { clicked: true });
```


## TimeSlider Integration

Pass the timeline directly - TimeSlider handles play/pause, seeking, and
subscribes to time updates internally:

```svelte
<TimeSlider {timeline} />
```

If you need custom rendering, register your own tick callback (multiple
callbacks are supported):

```svelte
<script>
  timeline.onTick((t, state) => draw(state));
</script>

<TimeSlider {timeline} />
```

For multiple independent sliders (like CrownJewel), make slider values
part of state and control them via clips.


## Seeking State

When the user drags the time slider, the timeline enters seeking mode:
- `isSeeking` becomes true
- Time progression pauses (tick skips `dt`)
- `seek()` still updates position normally
- `isPlaying` remains unchanged

This prevents the animation from "fighting" with user scrubbing.

```typescript
// Check if user is currently scrubbing
if (timeline.isSeeking) {
  // e.g., skip expensive computations
}
```

TimeSlider automatically calls `startSeeking()`/`endSeeking()` on drag.


## Code Style Preferences

- Use descriptive names for animation clips (e.g., `EulerSteps`, `FadeInTrajectories` instead of `clip1`, `anim`)


## Usage Examples

### Basic Animation
```typescript
const numSegments = 10;

const timeline = new Timeline<{ segmentIndex: number }>();
timeline.initialState = { segmentIndex: 0 };

timeline.add({
  name: 'segments',
  duration: 0.8,
  reduce(t) {
    return { segmentIndex: Math.floor(t * numSegments) };
  }
}, 0);

timeline.onTick((time, state) => draw(state));
timeline.play();
```

### Hover Override
```typescript
let hoverId: string | null = null;

function onMouseEnter(id: string) {
  hoverId = timeline.add({
    name: 'hover',
    duration: 1,
    reduce() { return { hoveredId: id, hoverOpacity: 1 }; }
  }, 'now', { layer: Layer.INTERACTION });
}

function onMouseLeave() {
  if (hoverId) timeline.remove(hoverId);
}
```


## Timeline Lifecycle

### Cleanup
Always call `timeline.dispose()` before creating a new Timeline instance to prevent memory leaks:

```typescript
function setupTimeline() {
  // Clean up previous timeline
  timeline?.dispose();

  timeline = new Timeline<AnimationState>();
  // ... configure timeline
}
```

### Dynamic Data Updates
When data changes (e.g., during streaming), prefer `replaceClips()` over recreating the timeline:

```typescript
// Instead of calling setupTimeline() on every data change:
timeline.replaceClips([
  { clip: createMainClip(newData), start: 0 }
]);
```

### State Reset
Use `resetState()` to restart an animation from the beginning without rebuilding clips:

```typescript
function handleRestart() {
  timeline.resetState();
  timeline.play();
}
```


## Visibility Handling

Use the `useVisibilityHandler` hook for consistent pause/resume when figures scroll in/out of view:

```svelte
<script lang="ts">
  import { useVisibilityHandler, Timeline } from '@diffusion-explorer/ui';

  let timeline: Timeline<AnimationState> | null = null;
  let figureIsActive;
  let isInitialized = false;

  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure bind:isActive={figureIsActive}>
  <!-- canvas content -->
</Figure>
```

This ensures animations pause when scrolled off-screen, reducing CPU usage.
