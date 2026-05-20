<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Player, Timeline, type Clip } from '@diffusion-explorer/ui';
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
  let player: Player<AnimState> | null = null;
  let animState: AnimState = { d: D_MIN };

  function setupTimeline() {
    const tl = Timeline.from<AnimState>({
      duration: 10,
      initialState: { d: D_MIN },
      clips: [
        { clip: {
      name: 'SweepLog',
      reduce(t: number) {
        const d = Math.exp(LOG_MIN + t * (LOG_MAX - LOG_MIN));
        return { d: Math.min(Math.round(d), D_MAX) };
      },
    }, ...{ start: 0, end: 1 } },
      ],
    });
    player = new Player(tl, { looping: true, endPause: 2 });
    player.onTick((_t: number, state: Readonly<AnimState>) => {
      animState = { d: state.d };
    });
  }

  onMount(() => {
    setupTimeline();
    player!.play();
  });

  onDestroy(() => {
    if (player) player.pause();
  });
</script>

<GaussianConcentration {D_VALUES} {animState} />
<ChiSquaredTheory {D_VALUES} {animState} />
