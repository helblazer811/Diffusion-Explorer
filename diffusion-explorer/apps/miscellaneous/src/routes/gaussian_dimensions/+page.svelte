<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Timeline, type Clip } from '@diffusion-explorer/ui';
  import GaussianConcentration from './GaussianConcentration.svelte';
  import ChiSquaredTheory from './ChiSquaredTheory.svelte';

  // Precomputed key dimensions (powers of 2)
  const D_VALUES = [64, 128, 256, 512, 1024];
  const D_MIN = D_VALUES[0];
  const D_MAX = D_VALUES[D_VALUES.length - 1];
  const LOG_MIN = Math.log(D_MIN);
  const LOG_MAX = Math.log(D_MAX);

  // Shared animation state: continuous d on log scale
  type AnimState = { d: number };
  let timeline: Timeline<AnimState> | null = null;
  let animState: AnimState = { d: D_MIN };

  function setupTimeline() {
    timeline = new Timeline<AnimState>();
    timeline.initialState = { d: D_MIN };

    timeline.add({
      name: 'SweepLog',
      reduce(t: number) {
        const d = Math.exp(LOG_MIN + t * (LOG_MAX - LOG_MIN));
        return { d: Math.min(Math.round(d), D_MAX) };
      },
    }, { start: 0, end: 1 });

    timeline.duration = 10;
    timeline.looping = true;
    timeline.setEndPause(2);

    timeline.onTick((_t: number, state: Readonly<AnimState>) => {
      animState = { d: state.d };
    });
  }

  onMount(() => {
    setupTimeline();
    timeline!.play();
  });

  onDestroy(() => {
    if (timeline) timeline.pause();
  });
</script>

<GaussianConcentration {D_VALUES} {animState} />
<ChiSquaredTheory {D_VALUES} {animState} />
