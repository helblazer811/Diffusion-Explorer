<script lang="ts">
  let {
    d,
    dValues,
  }: {
    d: number;
    dValues: number[];
  } = $props();

  const SLOT_WIDTH = 80;
  const VIEWPORT_WIDTH = 400;
  const LOG_MIN = Math.log(dValues[0]);
  const LOG_MAX = Math.log(dValues[dValues.length - 1]);
  const LOG_RANGE = LOG_MAX - LOG_MIN;

  // Total strip width: each tick spaced proportionally on log scale
  const STRIP_WIDTH = SLOT_WIDTH * (dValues.length - 1);

  /** Log-scale position of a value, mapped to strip pixels */
  function logPos(val: number): number {
    const t = (Math.log(Math.max(val, dValues[0])) - LOG_MIN) / LOG_RANGE;
    return t * STRIP_WIDTH;
  }

  // Offset so current d is centered
  let offset = $derived(
    -logPos(d) + VIEWPORT_WIDTH / 2
  );

  // Find nearest tick value for highlighting
  let nearestTick = $derived(() => {
    let best = dValues[0];
    let bestDist = Infinity;
    for (const v of dValues) {
      const dist = Math.abs(Math.log(d) - Math.log(v));
      if (dist < bestDist) {
        bestDist = dist;
        best = v;
      }
    }
    return best;
  });
</script>

<div class="ticker-wrapper">
  <div class="ticker-viewport">
    <div class="ticker-strip" style="transform: translateX({offset}px);">
      {#each dValues as val}
        {@const active = val === nearestTick()}
        <div
          class="ticker-slot"
          style="left: {logPos(val)}px;"
          class:active
        >
          <span class="ticker-value" class:active>
            {val}
          </span>
          <div class="tick" class:tick-active={active}></div>
        </div>
      {/each}
    </div>
  </div>
  <span class="ticker-label">Dimension</span>
</div>

<style>
  .ticker-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .ticker-viewport {
    width: 400px;
    height: 54px;
    overflow: hidden;
    position: relative;
    mask-image: linear-gradient(
      to right,
      transparent 0%,
      black 20%,
      black 80%,
      transparent 100%
    );
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0%,
      black 20%,
      black 80%,
      transparent 100%
    );
  }

  .ticker-strip {
    position: relative;
    height: 100%;
  }

  .ticker-slot {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    height: 100%;
    gap: 3px;
  }

  .tick {
    width: 1.5px;
    height: 8px;
    background: #ccc;
    border-radius: 1px;
  }

  .tick-active {
    width: 2px;
    height: 14px;
    background: #333;
  }

  .ticker-value {
    text-align: center;
    font-size: 16px;
    color: #ccc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    transition: color 0.15s, font-size 0.15s, font-weight 0.15s;
  }

  .ticker-value.active {
    color: #333;
    font-weight: 600;
    font-size: 22px;
  }

  .ticker-label {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 22px;
    color: #888;
    text-align: center;
  }
</style>
