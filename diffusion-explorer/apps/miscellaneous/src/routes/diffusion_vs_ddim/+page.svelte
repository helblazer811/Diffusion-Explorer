<script lang="ts">
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import type { DiffusionModelClient } from "@diffusion-explorer/diffusion";
  import DiffusionVsDDIM from "./DiffusionVsDDIM.svelte";

  // Data stores
  let targetDistribution: number[][] = $state([]);
  let ddpmTrajectories: number[][][] = $state([]);
  let ddimTrajectories: number[][][] = $state([]);

  // Client (lazy loaded to avoid TensorFlow.js import)
  let diffusionClient: DiffusionModelClient | null = $state(null);

  // Loading state
  let isLoading = $state(true);
  let error: string | null = $state(null);

  onMount(async () => {
    try {
      // Load all data in parallel first (fast)
      const [targetRes, ddpmRes, ddimRes] = await Promise.all([
        fetch(`${base}/diffusion_vs_ddim/data/smiley_face.json`),
        fetch(`${base}/diffusion_vs_ddim/cached_samples/ddpm_trajectories.json`),
        fetch(`${base}/diffusion_vs_ddim/cached_samples/ddim_trajectories.json`)
      ]);

      if (!targetRes.ok) throw new Error("Failed to load target distribution");
      if (!ddpmRes.ok) throw new Error("Failed to load DDPM trajectories");
      if (!ddimRes.ok) throw new Error("Failed to load DDIM trajectories");

      const [targetData, ddpmData, ddimData] = await Promise.all([
        targetRes.json(),
        ddpmRes.json(),
        ddimRes.json()
      ]);

      targetDistribution = targetData.points;
      ddpmTrajectories = ddpmData;
      ddimTrajectories = ddimData;

      // Show the figure immediately
      isLoading = false;

      // Lazy load client in background (includes TensorFlow.js, takes ~10s)
      const { DiffusionModelClient } = await import("@diffusion-explorer/diffusion");

      diffusionClient = new DiffusionModelClient(
        `${base}/diffusion_vs_ddim/workers/diffusion_model.worker.js`,
        `${base}/diffusion_vs_ddim/models/diffusion_model.json`,
        { dim: 2, hidden: 128, T: 1000 }
      );
    } catch (e) {
      console.error("Failed to initialize:", e);
      error = e instanceof Error ? e.message : String(e);
      isLoading = false;
    }
  });
</script>

<svelte:head>
  <title>DDPM vs DDIM - Diffusion Sampling Comparison</title>
</svelte:head>

<main>
  <h1>DDPM vs DDIM</h1>

  {#if isLoading}
    <div class="loading">Loading...</div>
  {:else if error}
    <div class="error">
      <p>Error: {error}</p>
      <p>Make sure to run the training and sampling scripts first:</p>
      <pre>npm run train:diffusion-vs-ddim
npm run sample:diffusion-vs-ddim</pre>
    </div>
  {:else}
    <DiffusionVsDDIM
      {diffusionClient}
      leftTrajectories={ddpmTrajectories}
      rightTrajectories={ddimTrajectories}
      {targetDistribution}
    >
      {#snippet children()}
        <p class="caption">
          <strong>Figure 1:</strong> Comparison of DDPM (left, stochastic) and DDIM (right, deterministic) sampling.
          Both use the same trained diffusion model and the same number of timesteps, but different sampling strategies.
          DDPM adds noise at each step while DDIM is deterministic.
          Tap anywhere on a canvas to spawn a trajectory from that point.
        </p>
      {/snippet}
    </DiffusionVsDDIM>
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
