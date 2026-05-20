# Animation System

Tempus splits an animation into three pieces with sharp boundaries:

1. **`TimelineBuilder<S>`** — the only mutable surface. Imperative,
   chainable; you `.add(...)` clips and pauses, then `.build()`.
2. **`Timeline<S>`** — frozen structure. `clips`, `duration`,
   `initialState`, and a pure `stateAt(t): S`. This is the artifact an
   agent or test or screenshot tool reasons about.
3. **`Player<S>`** — the transport over a `Timeline`. Owns the
   playhead, the RAF clock, `looping`, `endPause`, and the **overlay**
   (a tiny mutable clip list for ephemeral interaction effects).

`TimeSlider`, `TimelineInspector`, and `useVisibilityHandler` all take
either a `Player` (new shape) or a legacy mutable `Timeline` (from
`tempus/legacy`, kept around for figures that haven't migrated yet).

## Why split

The pre-refactor `Timeline` conflated three responsibilities — authored
structure, playback state, and runtime mutation — which made it
impossible to reason about an animation as a pure function of `t`. The
split is what lets `timeline.stateAt(0.5)` answer "what does the
animation look like at this point?" identically to playing through to
that point. That property is the foundation for agent introspection,
screenshot testing, and the inspector's hover/scrub determinism.

See [`packages/tempus/docs/timeline.md`](../../../tempus/docs/timeline.md)
and [`packages/tempus/docs/player.md`](../../../tempus/docs/player.md)
for the full API reference.

## Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│                  TimelineBuilder<S>                         │
│   (mutable scratch space; cursor model; .build())           │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Timeline<S> (frozen)                     │
│   clips, duration, initialState, stateAt(t): S              │
│   (introspection surface for agents/tests)                  │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Player<S>                                │
│   t, time, state, isPlaying, looping, endPause              │
│   play/pause/seek/reset/attach                              │
│   overlay (ephemeral interaction clips)                     │
│   onTick(cb)                                                │
└────────────────────────────┬────────────────────────────────┘
                             │ onTick(t, state)
                             ▼
                ┌──────────────────────┐
                │   Figure / Canvas    │
                │     draw(state)      │
                └──────────────────────┘
```

## Core concepts

### Clip (pure reducer)

Clips are pure functions of *local* time and return partial state
updates. They close over any external values they need.

```typescript
const fadeClip: Clip<State> = {
  name: 'fade',
  reduce(t) {
    return { opacity: t };
  }
};
```

The reducer receives `t ∈ [0, 1]` (0 at clip start, 1 at clip end).
Return a `Partial<State>` to write keys, or `null` to write nothing
(prior contributions are preserved).

### Insertion-order merge

State at time `t` is computed by walking every clip in **insertion
order**, evaluating each active clip at its local `t` (or `1` if the
clip has ended), and merging partial updates last-wins. Tracks are
purely visual — they do **not** affect state precedence.

This is the model: later-added clips override earlier ones on the
same state keys.

### Overlay (ephemeral interaction clips)

The Player owns an `overlay` — a minimal mutable clip list for hover
effects, click flashes, and other transient state injections that
shouldn't be part of the authored Timeline. Overlay clips are merged
**after** the authored Timeline, so they always win on conflicting keys.
They auto-remove after one play.

```typescript
player.overlay.add(
  { name: 'hover', reduce: () => ({ hoveredId: id, hoverOpacity: 1 }) },
  { start: player.t, durationFraction: 1 },
);

// Click flash:
player.overlay.add(
  { name: 'flash', reduce: (t) => ({ flash: 1 - t }) },
  { start: player.t, durationMs: 300 },
);
```

Replaces the old `timeline.playClip(...)` and `timeline.setState(...)`
patterns.

## Basic usage (new shape)

```typescript
import { TimelineBuilder, Player } from '@diffusion-explorer/ui';

const timeline = new TimelineBuilder<{ segmentIndex: number }>()
  .setInitialState({ segmentIndex: 0 })
  .add(
    {
      name: 'segments',
      reduce: (t) => ({ segmentIndex: Math.floor(t * 10) }),
    },
    { durationMs: 800 },
  )
  .build();

const player = new Player(timeline, { looping: true });
player.onTick((t, state) => draw(state));
player.play();
```

## TimeSlider integration

`TimeSlider` accepts either a `Player` or a legacy `Timeline` directly
via its `timeline` prop:

```svelte
<TimeSlider {timeline} />     <!-- timeline can be a Player too -->
```

It handles `seek`, `play/pause`, and snapshot-then-restore on drag
internally. (The pre-refactor `isSeeking` / `startSeeking` /
`endSeeking` transport leak is gone in the new Player; the legacy
Timeline still has it, and TimeSlider's duck-typed handler calls it
if present so figures that haven't migrated keep their old behavior.)

For multiple independent sliders (like `CrownJewel`), make slider
values part of state and control them via clips.

## Legacy Timeline (compatibility path)

Figures predating this refactor instantiate a mutable `Timeline`
directly:

```typescript
import { Timeline } from '@diffusion-explorer/ui';

const timeline = new Timeline<S>();
timeline.initialState = {...};
timeline.duration = 2;
timeline.looping = true;
timeline.add(clip, { start: 0, end: 1 });
timeline.onTick((t, s) => draw(s));
timeline.play();
```

This keeps working — the `Timeline` re-exported from
`@diffusion-explorer/ui` is the **legacy mutable class**, backed by
`tempus/legacy`. New figures should prefer the `TimelineBuilder + Player`
shape; the legacy path is for incremental migration only.

Legacy Timeline exposes a Player-shaped surface (`.t`, `.timeline`)
so it can also be passed to `<TimelineInspector {player} />` without
migration. (The inspector reads `player.timeline.clips`,
`player.onTick`, `player.t`, `player.isPlaying`, `player.play/pause/seek`
— all available on both classes.)

## Timeline lifecycle

### Cleanup

Call `player.dispose()` (new) or `timeline.dispose()` (legacy) before
discarding to stop the clock and clear subscribers.

### Dynamic data updates

When data changes (e.g., during streaming), rebuild the Timeline and
swap it on the Player:

```typescript
// New shape:
const newTimeline = buildTimelineFromData(newData);
player.attach(newTimeline);   // preserves t and isPlaying
```

`attach()` is the replacement for the legacy `replaceClips([...])`
pattern.

### State reset

`player.reset()` (or legacy `timeline.resetState()`) seeks to `t=0` and
pauses. State is pure, so there's nothing to "reset" beyond the
playhead.

## Visibility handling

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

Pauses animations when scrolled off-screen, resumes when scrolled back.
Works with either a Player or a legacy Timeline.

## Code style

- Use descriptive names for animation clips (e.g., `EulerSteps`,
  `FadeInTrajectories` instead of `clip1`, `anim`).
- Prefer the `TimelineBuilder + Player` shape for new figures.
- Keep the authored Timeline frozen; for runtime mutation use the
  `Player`'s `overlay` (transient) or rebuild + `attach()` (structural).
