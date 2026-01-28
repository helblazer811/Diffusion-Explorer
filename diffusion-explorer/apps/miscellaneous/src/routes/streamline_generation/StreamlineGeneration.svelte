<!--
  Streamline Generation Visualization

  Compares naive pathline integration (left, crowded) vs.
  streamline generation with spatial filtering (right, clean).
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    DoubleFigure,
    TimelineBuilder,
    createPauseClip,
    useCanvas2D,
    useVisibilityHandler,
    type Clip,
    type Timeline,
  } from "@diffusion-explorer/ui";
  import {
    divergingSpiral,
    precomputeWithCollisions,
    generateSeedPoints,
    computeBoundingBox,
    type Domain,
    type CollisionEvent,
  } from "./generation";
  import {
    drawGrid,
    drawPathline,
    drawCompletedPathline,
    FlashFadeAnimation,
    type FlashFadeAnimationState,
  } from "./animations";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface TimingProps {
    msPerStep?: number;
    numFlashes?: number;
    msPerFlash?: number;
    fadeMs?: number;
    pauseAfterTrajectoryMs?: number;
    gridFadeMs?: number;
    endPauseMs?: number;
  }

  interface Props {
    canvasWidth?: number;
    canvasHeight?: number;
    gap?: number;
    numSeedPoints?: number;
    gridNx?: number;
    gridNy?: number;
    numIntegrationSteps?: number;
    integrationDt?: number;
    timing?: TimingProps;
    playingByDefault?: boolean;
    pathlineColor?: string;
    pathlineStrokeWidth?: number;
    collisionColor?: string;
  }

  const defaultTiming: Required<TimingProps> = {
    msPerStep: 10,
    numFlashes: 3,
    msPerFlash: 200,
    fadeMs: 500,
    pauseAfterTrajectoryMs: 100,
    gridFadeMs: 1000,
    endPauseMs: 1500,
  };

  let {
    canvasWidth = 450,
    canvasHeight = 450,
    gap = 20,
    numSeedPoints = 100,
    gridNx = 14,
    gridNy = 14,
    numIntegrationSteps = 240,
    integrationDt = 0.015,
    timing: timingProp = {},
    playingByDefault = true,
    pathlineColor = "#3b82f6",
    pathlineStrokeWidth = 3,
    collisionColor = "#ef4444",
  }: Props = $props();

  // Merge timing with defaults
  const timing = { ...defaultTiming, ...timingProp };

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Animation state type
  type AnimationState = FlashFadeAnimationState & {
    // Left panel
    leftCurrentPathline: number;
    leftSegmentIndex: number;
    leftCompletedPathlines: Set<number>;

    // Right panel
    rightCurrentPathline: number;
    rightSegmentIndex: number;
    rightCompletedPathlines: Set<number>;
    rightRemovedPathlines: Set<number>;

    // Collision animation
    collisionActive: boolean;
    collisionPathlineIndex: number | null;
    collisionGridCell: [number, number] | null;

    // Grid fade out
    gridOpacity: number;
  };

  // Seed domain (where seed points are generated) - constant
  const seedDomain: Domain = { xMin: -3.0, xMax: 3.0, yMin: -3.0, yMax: 3.0 };

  // Large integration domain (for unbounded integration)
  const integrationDomain: Domain = { xMin: -100, xMax: 100, yMin: -100, yMax: 100 };

  // Render domain - computed from trajectories
  let domain: Domain = $state({ xMin: -3.5, xMax: 3.5, yMin: -3.5, yMax: 3.5 });

  // Canvas contexts
  let canvasLeft: HTMLCanvasElement | null = $state(null);
  let canvasRight: HTMLCanvasElement | null = $state(null);
  const canvas2dLeft = useCanvas2D(canvasWidth, canvasHeight);
  const canvas2dRight = useCanvas2D(canvasWidth, canvasHeight);
  let ctxLeft = $derived(canvasLeft ? canvas2dLeft.ctx : null);
  let ctxRight = $derived(canvasRight ? canvas2dRight.ctx : null);

  // Timeline and animation
  let timeline: Timeline<AnimationState> | null = $state(null);
  let currentState: AnimationState | null = $state(null);
  let isInitialized = $state(false);

  // Precomputed data
  let fullPathlinesPixel: number[][][] = $state([]);
  let truncatedPathlinesPixel: number[][][] = $state([]);
  let collisionEvents: CollisionEvent[] = $state([]);
  let collisionMap: Map<number, CollisionEvent> = $state(new Map());

  // Flash fade animations (one per collision)
  let flashFadeAnimations: Map<
    number,
    FlashFadeAnimation<AnimationState>
  > = $state(new Map());

  // Visibility
  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // Margin for grid and trajectories (0 = grid fills entire canvas/domain)
  const gridMargin = 15;

  function toPixel(p: [number, number]): [number, number] {
    const gridWidth = canvasWidth - 2 * gridMargin;
    const gridHeight = canvasHeight - 2 * gridMargin;
    return [
      gridMargin +
        ((p[0] - domain.xMin) / (domain.xMax - domain.xMin)) * gridWidth,
      gridMargin +
        ((p[1] - domain.yMin) / (domain.yMax - domain.yMin)) * gridHeight,
    ];
  }

  function createVectorField(x: number, y: number): [number, number] {
    return divergingSpiral(x, y, 1.0, 0.3);
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    console.log("[StreamlineGeneration] Running initial computation...");

    // Generate seed points
    const seedPoints = generateSeedPoints(numSeedPoints, seedDomain, 0);

    // Step 1: Integrate pathlines with large domain (no early truncation)
    const initialPrecomputed = precomputeWithCollisions(
      createVectorField,
      seedPoints,
      gridNx,
      gridNy,
      integrationDomain,
      numIntegrationSteps,
      integrationDt
    );

    // Step 2: Compute render domain from full pathlines
    domain = computeBoundingBox(initialPrecomputed.fullPathlines, 0.1);
    console.log(`[StreamlineGeneration] Computed domain: [${domain.xMin.toFixed(2)}, ${domain.xMax.toFixed(2)}] x [${domain.yMin.toFixed(2)}, ${domain.yMax.toFixed(2)}]`);

    // Step 3: Re-run with computed domain for proper collision grid mapping
    const precomputed = precomputeWithCollisions(
      createVectorField,
      seedPoints,
      gridNx,
      gridNy,
      domain,
      numIntegrationSteps,
      integrationDt
    );

    // Convert to pixel coordinates
    fullPathlinesPixel = precomputed.fullPathlines.map((pathline) =>
      pathline.map((p) => toPixel(p as [number, number]))
    );
    truncatedPathlinesPixel = precomputed.truncatedPathlines.map((pathline) =>
      pathline.map((p) => toPixel(p as [number, number]))
    );

    collisionEvents = precomputed.collisionEvents;

    // Build collision map for quick lookup
    collisionMap = new Map();
    for (const event of collisionEvents) {
      collisionMap.set(event.pathlineIndex, event);
    }

    // Compute flash animation timing
    const totalFlashDurationMs =
      timing.numFlashes * timing.msPerFlash + timing.fadeMs;
    const flashPhaseRatio =
      (timing.numFlashes * timing.msPerFlash) / totalFlashDurationMs;

    // Create flash fade animations for each collision (will init later)
    flashFadeAnimations = new Map();
    for (const event of collisionEvents) {
      const pixelPathline = truncatedPathlinesPixel[event.pathlineIndex];
      const animation = FlashFadeAnimation.create<AnimationState>(
        event.gridCell,
        pixelPathline,
        {
          gridNx,
          gridNy,
          canvasWidth,
          canvasHeight,
          margin: gridMargin,
          numFlashes: timing.numFlashes,
          flashPhaseRatio,
          rectangleColor: collisionColor,
          pathlineColor: collisionColor,
          pathlineStrokeWidth,
        }
      );
      flashFadeAnimations.set(event.pathlineIndex, animation);
    }

    console.log(
      `[StreamlineGeneration] Generated ${fullPathlinesPixel.length} pathlines, ${collisionEvents.length} collisions`
    );
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  async function setupTimeline() {
    console.log("[StreamlineGeneration] Setting up timeline...");

    // Initialize all flash fade animations with the right canvas
    if (canvasRight) {
      const initPromises: Promise<void>[] = [];
      for (const animation of flashFadeAnimations.values()) {
        initPromises.push(animation.init(canvasRight));
      }
      await Promise.all(initPromises);
    }

    // Initial state
    const initialState: AnimationState = {
      leftCurrentPathline: 0,
      leftSegmentIndex: 0,
      leftCompletedPathlines: new Set(),
      rightCurrentPathline: 0,
      rightSegmentIndex: 0,
      rightCompletedPathlines: new Set(),
      rightRemovedPathlines: new Set(),
      collisionActive: false,
      collisionPathlineIndex: null,
      collisionGridCell: null,
      flashFadeProgress: 0,
      gridOpacity: 1,
    };

    // Use TimelineBuilder for incremental construction with ms durations
    const builder = new TimelineBuilder<AnimationState>()
      .setInitialState(initialState)
      .setLooping(true)
      .setEndPause(timing.endPauseMs);

    // Total duration for flash+fade animation
    const totalFlashDurationMs =
      timing.numFlashes * timing.msPerFlash + timing.fadeMs;

    const numPathlines = fullPathlinesPixel.length;

    for (let i = 0; i < numPathlines; i++) {
      const leftPathline = fullPathlinesPixel[i];
      const rightPathline = truncatedPathlinesPixel[i];
      const collision = collisionMap.get(i);

      const leftNumSegments = Math.max(1, leftPathline.length - 1);
      const rightNumSegments = Math.max(1, rightPathline.length - 1);

      const leftDurationMs = leftNumSegments * timing.msPerStep;
      const rightDurationMs = rightNumSegments * timing.msPerStep;
      const rightTotalMs =
        rightDurationMs + (collision ? totalFlashDurationMs : 0);

      // Max of left and right determines trajectory duration (for synchronization)
      const trajectoryDurationMs = Math.max(leftDurationMs, rightTotalMs);
      const trajectoryStartMs = builder.currentTimeMs;

      // Left panel integration clip
      const leftClip: Clip<AnimationState> = {
        name: `left-integration-${i}`,
        reduce: (t: number, current: Readonly<AnimationState>) => {
          const segmentIndex = Math.min(
            Math.floor(t * leftNumSegments),
            leftNumSegments - 1
          );
          const newCompleted = new Set(current.leftCompletedPathlines);
          for (let j = 0; j < i; j++) {
            newCompleted.add(j);
          }
          return {
            leftCurrentPathline: i,
            leftSegmentIndex: segmentIndex,
            leftCompletedPathlines: newCompleted,
          };
        },
      };
      builder.addAt(leftClip, {
        startMs: trajectoryStartMs,
        durationMs: leftDurationMs,
      });

      // Right panel integration clip
      const rightClip: Clip<AnimationState> = {
        name: `right-integration-${i}`,
        reduce: (t: number, current: Readonly<AnimationState>) => {
          const segmentIndex = Math.min(
            Math.floor(t * rightNumSegments),
            rightNumSegments - 1
          );
          const newCompleted = new Set(current.rightCompletedPathlines);
          const newRemoved = new Set(current.rightRemovedPathlines);
          for (let j = 0; j < i; j++) {
            if (collisionMap.has(j)) {
              newRemoved.add(j);
            } else {
              newCompleted.add(j);
            }
          }
          return {
            rightCurrentPathline: i,
            rightSegmentIndex: segmentIndex,
            rightCompletedPathlines: newCompleted,
            rightRemovedPathlines: newRemoved,
            collisionActive: false,
            collisionPathlineIndex: null,
            collisionGridCell: null,
            flashFadeProgress: 0,
          };
        },
      };
      builder.addAt(rightClip, {
        startMs: trajectoryStartMs,
        durationMs: rightDurationMs,
      });

      // If collision occurred, add flash+fade clip after right integration
      if (collision) {
        const flashStartMs = trajectoryStartMs + rightDurationMs;

        const flashFadeClip: Clip<AnimationState> = {
          name: `flash-fade-${i}`,
          reduce: (t: number, current: Readonly<AnimationState>) => {
            const newCompleted = new Set(current.rightCompletedPathlines);
            const newRemoved = new Set(current.rightRemovedPathlines);
            for (let j = 0; j < i; j++) {
              if (collisionMap.has(j)) {
                newRemoved.add(j);
              } else {
                newCompleted.add(j);
              }
            }
            return {
              rightCurrentPathline: i,
              rightSegmentIndex: rightNumSegments - 1,
              rightCompletedPathlines: newCompleted,
              rightRemovedPathlines: newRemoved,
              collisionActive: true,
              collisionPathlineIndex: i,
              collisionGridCell: collision.gridCell,
              flashFadeProgress: t,
            };
          },
        };
        builder.addAt(flashFadeClip, {
          startMs: flashStartMs,
          durationMs: totalFlashDurationMs,
        });
      }

      // Advance cursor to end of trajectory (both sides now aligned)
      builder.currentTimeMs = trajectoryStartMs + trajectoryDurationMs;

      // Add shared pause after each trajectory
      if (timing.pauseAfterTrajectoryMs > 0) {
        builder.add(createPauseClip<AnimationState>(), {
          durationMs: timing.pauseAfterTrajectoryMs,
        });
      }
    }

    // Add grid fade-out at the end
    if (timing.gridFadeMs > 0) {
      const gridFadeClip: Clip<AnimationState> = {
        name: "grid-fade-out",
        reduce: (t: number) => ({
          gridOpacity: 1 - t,
        }),
      };
      builder.add(gridFadeClip, { durationMs: timing.gridFadeMs });
    }

    // Build timeline (duration auto-computed from accumulated clips)
    timeline = builder.build();
    currentState = initialState;

    // On tick callback
    timeline.onTick((_t, state) => {
      currentState = { ...state };
      draw(state);
    });

    console.log(
      `[StreamlineGeneration] Timeline setup complete, duration: ${builder.totalDurationMs}ms`
    );
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctxLeft || !ctxRight) return;

    const {
      leftCurrentPathline,
      leftSegmentIndex,
      leftCompletedPathlines,
      rightCurrentPathline,
      rightSegmentIndex,
      rightCompletedPathlines,
      rightRemovedPathlines,
      collisionActive,
      collisionPathlineIndex,
      gridOpacity,
    } = state;

    // --- Clear canvases ---
    ctxLeft.clearRect(0, 0, canvasWidth, canvasHeight);
    ctxRight.clearRect(0, 0, canvasWidth, canvasHeight);

    // --- Static Background (right panel only) ---
    ctxRight.save();
    ctxRight.globalAlpha = gridOpacity;
    drawGrid(ctxRight, canvasWidth, canvasHeight, gridNx, gridNy, {
      lineColor: "#c0c0c0",
      lineWidth: 1,
      margin: gridMargin,
    });
    ctxRight.restore();

    // --- Dynamic Foreground: Left Panel ---
    // Draw completed pathlines
    for (const idx of leftCompletedPathlines) {
      if (idx < fullPathlinesPixel.length) {
        drawCompletedPathline(ctxLeft, fullPathlinesPixel[idx], {
          color: pathlineColor,
          strokeWidth: pathlineStrokeWidth,
          opacity: 0.6,
        });
      }
    }
    // Draw current pathline in progress
    if (leftCurrentPathline < fullPathlinesPixel.length) {
      drawPathline(
        ctxLeft,
        fullPathlinesPixel[leftCurrentPathline],
        leftSegmentIndex,
        {
          color: pathlineColor,
          strokeWidth: pathlineStrokeWidth,
          opacity: 0.9,
          showHeadMarker: true,
          headMarkerRadius: 4,
        }
      );
    }

    // --- Dynamic Foreground: Right Panel ---
    // Draw completed (surviving) pathlines
    for (const idx of rightCompletedPathlines) {
      if (idx < truncatedPathlinesPixel.length) {
        drawCompletedPathline(ctxRight, truncatedPathlinesPixel[idx], {
          color: pathlineColor,
          strokeWidth: pathlineStrokeWidth,
          opacity: 0.6,
        });
      }
    }

    // Draw current pathline in progress (if not in collision animation)
    if (
      rightCurrentPathline < truncatedPathlinesPixel.length &&
      (!collisionActive || collisionPathlineIndex !== rightCurrentPathline)
    ) {
      drawPathline(
        ctxRight,
        truncatedPathlinesPixel[rightCurrentPathline],
        rightSegmentIndex,
        {
          color: pathlineColor,
          strokeWidth: pathlineStrokeWidth,
          opacity: 0.9,
          showHeadMarker: true,
          headMarkerRadius: 4,
        }
      );
    }

    // Draw collision animation if active
    if (collisionActive && collisionPathlineIndex !== null) {
      const animation = flashFadeAnimations.get(collisionPathlineIndex);
      if (animation) {
        animation.draw(state);
      }
    }
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
    if (!isInitialized && ctxLeft && ctxRight) {
      isInitialized = true;
      runInitialComputation();
      setupTimeline().then(() => {
        if (playingByDefault && timeline) {
          draw(timeline.initialState);
          timeline.play();
        }
      });
    }
  });

  $effect(() => {
    if (figureIsActive !== undefined && isInitialized) {
      handleVisibilityChange($figureIsActive);
    }
  });
</script>

<DoubleFigure {gap} bind:isActive={figureIsActive} backgroundVisible={false}>
  {#snippet left()}
    <div class="canvas-wrapper">
      <div class="canvas-label">Pathlines Lead to Crowding</div>
      <canvas
        bind:this={canvasLeft}
        use:canvas2dLeft.bindCanvas
        style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
      ></canvas>
    </div>
  {/snippet}

  {#snippet right()}
    <div class="canvas-wrapper">
      <div class="canvas-label">Streamlines Have Better Spacing</div>
      <canvas
        bind:this={canvasRight}
        use:canvas2dRight.bindCanvas
        style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
      ></canvas>
    </div>
  {/snippet}

  {#snippet caption()}
    <strong>Streamline generation with density-based culling.</strong>
    <em>Left:</em> All pathlines integrated without filtering, showing crowding.
    <em>Right:</em> Pathlines that enter an already-occupied grid cell are removed
    (shown with collision animation), resulting in evenly-spaced streamlines.
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
    font-size: 1.5rem;
    font-weight: 600;
    color: #666;
  }
</style>
