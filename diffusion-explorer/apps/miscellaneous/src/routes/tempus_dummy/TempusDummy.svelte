<!-- Minimal tempus CLI test figure: a dot slides right, grows, then turns red. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import { Figure, useCanvas2D } from "@diffusion-explorer/ui";
  import { TimelineBuilder, Player, type Clip } from "tempus";

  export let width = 400;
  export let height = 200;

  type DotState = {
    x: number;
    y: number;
    radius: number;
    color: string;
  };

  const initialState: DotState = { x: 0, y: 100, radius: 5, color: "#3b82f6" };

  const clips: { clip: Clip<DotState>; durationMs: number }[] = [
    { clip: { name: "slide-right", intent: "blue dot moves from left edge to the right", reduce: (t) => ({ x: t * 360 }) }, durationMs: 1000 },
    { clip: { name: "grow",        intent: "blue dot grows from small to large",         reduce: (t) => ({ radius: 5 + t * 25 }) }, durationMs: 500 },
    { clip: { name: "recolor",     intent: "dot turns from blue to red",                  reduce: () => ({ color: "#ef4444" }) }, durationMs: 500 },
  ];

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  let player: Player<DotState> | null = null;
  let figureIsActive: Writable<boolean> | undefined;
  let isInitialized = false;

  function draw(state: DotState) {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = state.color;
    ctx.beginPath();
    ctx.arc(state.x + 20, state.y, state.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function setupTimeline() {
    const builder = new TimelineBuilder<DotState>().setInitialState({ ...initialState });
    for (const { clip, durationMs } of clips) builder.add(clip, { durationMs });
    player = new Player(builder.build(), { looping: true });
    player.onTick((_t, state) => draw(state));
  }

  onDestroy(() => player?.pause());

  $: if (canvas && ctx && !isInitialized) {
    isInitialized = true;
    setupTimeline();
    draw(player?.state ?? initialState);
    player?.play();
  }
</script>

<div class="wrap" style="max-width:{width}px;">
  <h2>Tempus Dummy</h2>
  <Figure bind:isActive={figureIsActive} {player} devMode={true}>
    {#snippet children()}
      <div style="width:100%;max-width:{width}px;">
        <canvas
          bind:this={canvas}
          use:canvas2d.bindCanvas
          style="width:100%;height:auto;aspect-ratio:{width}/{height};"
        ></canvas>
      </div>
    {/snippet}
  </Figure>
</div>

<style>
  .wrap { margin: 2rem auto 0; display: flex; flex-direction: column; align-items: center; }
  h2 { text-align: center; font-weight: 500; color: #777; margin: 0 0 0.4rem 0; }
</style>
