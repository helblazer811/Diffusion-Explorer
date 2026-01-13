<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    DoubleFigure,
    TimeSlider,
    Timeline,
    useVisibilityHandler,
    getPropagatedPathIndex,
    getDiscretePathIndex,
    generateStreamlinePath2D,
    type Clip,
    type PropagatedStreamlineData,
    type DiscreteStreamlineData,
  } from "@diffusion-explorer/ui";
  import PropagatedStreamlines from "./PropagatedStreamlines.svelte";
  import DiscreteStreamlines from "./DiscreteStreamlines.svelte";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    propagatedData: PropagatedStreamlineData;
    discreteData: DiscreteStreamlineData;
    canvasWidth?: number;
    canvasHeight?: number;
    gap?: number;
    domainRange?: { xMin: number; xMax: number; yMin: number; yMax: number };
    animationDuration?: number;
    playingByDefault?: boolean;
    heatmapOpacity?: number;
    streamlineColor?: string;
    streamlineWidth?: number;
  }

  let {
    propagatedData,
    discreteData,
    canvasWidth = 350,
    canvasHeight = 350,
    gap = 20,
    domainRange = { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },
    animationDuration = 8000,
    playingByDefault = true,
    heatmapOpacity = 0.3,
    streamlineColor = "#3b82f6",
    streamlineWidth = 2.5,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  type AnimationState = {
    time: number;
    propagatedPathIndex: number;
    discretePathIndex: number;
  };

  let timeline: Timeline<AnimationState> | null = $state(null);
  let currentState: AnimationState | null = $state(null);
  let currentTime = $state(0);
  let discreteSnapshotIndex = $state(0);
  let isInitialized = $state(false);

  // Pre-computed Path2D arrays (computed once at init)
  let propagatedPaths: Path2D[] = $state([]);
  let discretePaths: Path2D[] = $state([]);

  // Visibility
  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function createToPixel(): (p: [number, number]) => [number, number] {
    const { xMin, xMax, yMin, yMax } = domainRange;
    return (p: [number, number]): [number, number] => [
      ((p[0] - xMin) / (xMax - xMin)) * canvasWidth,
      ((p[1] - yMin) / (yMax - yMin)) * canvasHeight,
    ];
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  // Animation constants: 128 frames at 32fps = 4 seconds
  const NUM_FRAMES = 128;
  const FRAMES_PER_SECOND = 32;
  const ANIMATION_DURATION_MS = (NUM_FRAMES / FRAMES_PER_SECOND) * 1000;

  function runInitialComputation() {
    console.log('[StreamlinePropagation] Pre-computing Path2D objects...');
    const toPixel = createToPixel();

    // Pre-compute propagated paths - one per frame
    // Use the stored time steps, selecting nearest for each frame
    propagatedPaths = [];
    for (let frame = 0; frame < NUM_FRAMES; frame++) {
      const t = frame / (NUM_FRAMES - 1);
      const timeIndex = getPropagatedPathIndex(propagatedData, t);
      const curvesAtTime = propagatedData.curves[timeIndex];
      const pixelCurves = curvesAtTime.map((curve) =>
        curve.map((p) => toPixel(p as [number, number]))
      );
      propagatedPaths.push(generateStreamlinePath2D(pixelCurves));
    }

    // Pre-compute discrete paths - one per frame
    // Each frame selects the appropriate discrete snapshot
    discretePaths = [];
    for (let frame = 0; frame < NUM_FRAMES; frame++) {
      const t = frame / (NUM_FRAMES - 1);
      const snapshotIndex = getDiscretePathIndex(discreteData, t);
      const curvesAtSnapshot = discreteData.snapshots[snapshotIndex];
      const pixelCurves = curvesAtSnapshot.map((curve) =>
        curve.map((p) => toPixel(p as [number, number]))
      );
      discretePaths.push(generateStreamlinePath2D(pixelCurves));
    }

    console.log('[StreamlinePropagation] Pre-computed', propagatedPaths.length, 'propagated paths');
    console.log('[StreamlinePropagation] Pre-computed', discretePaths.length, 'discrete paths');

    // Initial state at t=0
    currentState = {
      time: 0,
      propagatedPathIndex: 0,
      discretePathIndex: 0,
    };
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    console.log('[StreamlinePropagation] Setting up timeline');

    timeline = new Timeline<AnimationState>();
    timeline.duration = ANIMATION_DURATION_MS / 1000;  // 4 seconds
    timeline.looping = true;

    timeline.initialState = {
      time: 0,
      propagatedPathIndex: 0,
      discretePathIndex: 0,
    };

    // Main animation clip - just computes frame index from normalized time
    const animationClip: Clip<AnimationState> = {
      name: "streamline-animation",
      reduce: (t: number) => {
        // Map normalized time [0,1] to frame index [0, NUM_FRAMES-1]
        const frameIndex = Math.min(Math.floor(t * NUM_FRAMES), NUM_FRAMES - 1);
        return {
          time: t,
          propagatedPathIndex: frameIndex,
          discretePathIndex: frameIndex,
        };
      },
    };

    timeline.add(animationClip, { start: 0, end: 1 });

    timeline.onTick((_t, state) => {
      // Force reactivity by creating new object
      currentState = { ...state };
      currentTime = state.time;
      // Find which discrete snapshot this frame corresponds to
      const t = state.propagatedPathIndex / (NUM_FRAMES - 1);
      discreteSnapshotIndex = getDiscretePathIndex(discreteData, t);
    });

    console.log('[StreamlinePropagation] Timeline setup complete');
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) {
      timeline.dispose();
    }
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $effect(() => {
    console.log('[StreamlinePropagation] Init effect running, isInitialized:', isInitialized);
    console.log('[StreamlinePropagation] propagatedData exists:', !!propagatedData);
    console.log('[StreamlinePropagation] discreteData exists:', !!discreteData);

    if (!isInitialized && propagatedData && discreteData) {
      console.log('[StreamlinePropagation] Initializing...');
      runInitialComputation();
      setupTimeline();
      isInitialized = true;

      if (playingByDefault && timeline) {
        console.log('[StreamlinePropagation] Starting playback');
        timeline.play();
        console.log('[StreamlinePropagation] timeline.isPlaying:', timeline.isPlaying);
      }
    }
  });

  $effect(() => {
    console.log('[StreamlinePropagation] Visibility effect, figureIsActive:', figureIsActive !== undefined ? $figureIsActive : 'undefined');
    if (figureIsActive !== undefined && isInitialized) {
      console.log('[StreamlinePropagation] Calling handleVisibilityChange with:', $figureIsActive);
      handleVisibilityChange($figureIsActive);
    }
  });
</script>

<DoubleFigure {gap} bind:isActive={figureIsActive}>
  {#snippet left()}
    <div class="canvas-wrapper">
      <div class="canvas-label">Streamline Propagation</div>
      {#if currentState && propagatedPaths.length > 0}
        <PropagatedStreamlines
          path={propagatedPaths[currentState.propagatedPathIndex]}
          {canvasWidth}
          {canvasHeight}
          {streamlineColor}
          {streamlineWidth}
        />
      {/if}
    </div>
  {/snippet}

  {#snippet right()}
    <div class="canvas-wrapper">
      <div class="canvas-label">
        Discrete Streamlines (t={discreteData.timeSnapshots[discreteSnapshotIndex].toFixed(1)})
      </div>
      {#if currentState && discretePaths.length > 0}
        <DiscreteStreamlines
          path={discretePaths[currentState.discretePathIndex]}
          {canvasWidth}
          {canvasHeight}
          {streamlineColor}
          {streamlineWidth}
        />
      {/if}
    </div>
  {/snippet}

  {#snippet footer()}
    {#if timeline}
      <TimeSlider {timeline} color={streamlineColor} />
    {/if}
  {/snippet}

  {#snippet caption()}
    <strong>Comparing streamline visualization for time-varying vector fields.</strong>
    <em>Left:</em> Streamlines computed at t=0 are propagated smoothly through the ODE,
    maintaining visual continuity.
    <em>Right:</em> Streamlines recomputed at discrete intervals (t=0, 0.1, ..., 1.0)
    show discontinuous jumps as the field structure changes.
  {/snippet}
</DoubleFigure>

<style>
  .canvas-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .canvas-label {
    font-size: 0.9rem;
    font-weight: 500;
    color: #333;
  }
</style>
