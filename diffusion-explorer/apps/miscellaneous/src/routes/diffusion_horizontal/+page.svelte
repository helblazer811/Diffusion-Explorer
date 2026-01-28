<script lang="ts">
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import { writable } from "svelte/store";
  import DiffusionHorizontal from "./DiffusionHorizontal.svelte";

  // Data stores (matching DiffusionHorizontal props)
  let sourceDistributionSamples: number[][] = $state([]);
  let targetDistributionSamples: number[][] = $state([]);
  const allTimeSamples = writable<number[][][]>([]);

  // Loading state
  let isLoading = $state(true);
  let error: string | null = $state(null);

  onMount(async () => {
    try {
      // Load target distribution
      const targetRes = await fetch(`${base}/diffusion_horizontal/data/smiley_face.json`);
      if (!targetRes.ok) throw new Error("Failed to load target distribution");
      const targetData = await targetRes.json();
      targetDistributionSamples = targetData.points;

      // Load DDPM trajectories
      const trajRes = await fetch(`${base}/diffusion_horizontal/cached_samples/ddpm_trajectories.json`);
      if (!trajRes.ok) throw new Error("Failed to load DDPM trajectories");
      const trajectories: number[][][] = await trajRes.json();

      // Trajectories are [timestep][sample][dim]
      // allTimeSamples expects the same format
      allTimeSamples.set(trajectories);

      // Source distribution = first timestep samples (noise)
      sourceDistributionSamples = trajectories[0];

      isLoading = false;
    } catch (e) {
      console.error("Failed to initialize:", e);
      error = e instanceof Error ? e.message : String(e);
      isLoading = false;
    }
  });
</script>

<svelte:head>
  <title>Diffusion Horizontal - Probability Path Visualization</title>
</svelte:head>

<main>
  <h1>Diffusion Probability Path</h1>

  {#if isLoading}
    <div class="loading">Loading...</div>
  {:else if error}
    <div class="error">
      <p>Error: {error}</p>
      <p>Make sure to run the training and sampling scripts first:</p>
      <pre>npm run train:diffusion-horizontal
npm run sample:diffusion-horizontal</pre>
    </div>
  {:else}
    <DiffusionHorizontal
      {sourceDistributionSamples}
      {targetDistributionSamples}
      {allTimeSamples}
    >
      {#snippet children()}
        <p class="caption">
          <strong>Figure:</strong> Diffusion model probability path from noise (x_T) to data (x_0).
          The animation shows how samples evolve through the reverse diffusion process using DDPM sampling.
        </p>
      {/snippet}
    </DiffusionHorizontal>
  {/if}
</main>

<style>
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
  }

  h1 {
    text-align: center;
    font-size: 2rem;
    margin-bottom: 24px;
    color: #333;
  }

  .loading {
    text-align: center;
    padding: 48px;
    color: #666;
  }

  .error {
    background-color: #fee;
    border: 1px solid #fcc;
    border-radius: 8px;
    padding: 24px;
    text-align: center;
    color: #c00;
  }

  .error pre {
    background-color: #f5f5f5;
    padding: 12px;
    border-radius: 4px;
    text-align: left;
    display: inline-block;
    margin-top: 12px;
  }

  .caption {
    text-align: center;
    color: #666;
    font-size: 0.95rem;
    margin-top: 16px;
    line-height: 1.5;
  }
</style>
