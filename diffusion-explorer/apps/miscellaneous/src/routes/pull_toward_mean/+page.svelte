<script lang="ts">
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import { FlowModelClient, DiffusionModelClient } from "@diffusion-explorer/diffusion";
  import PullTowardMean from "./PullTowardMean.svelte";

  // Data stores
  let targetDistribution: number[][] = $state([]);
  let flowMatchingTrajectories: number[][][] = $state([]);
  let diffusionTrajectories: number[][][] = $state([]);

  // Clients
  let flowMatchingClient: FlowModelClient | null = $state(null);
  let diffusionClient: DiffusionModelClient | null = $state(null);

  // Loading state
  let isLoading = $state(true);
  let error: string | null = $state(null);

  onMount(async () => {
    try {
      // Initialize Flow Matching client
      flowMatchingClient = new FlowModelClient(
        `${base}/pull_toward_mean/workers/flow_model.worker.js`,
        `${base}/pull_toward_mean/models/flow_matching_model.json`,
        "Flow Matching",
        { dim: 2, hidden: 64 }
      );

      // Initialize Diffusion client
      diffusionClient = new DiffusionModelClient(
        `${base}/pull_toward_mean/workers/diffusion_model.worker.js`,
        `${base}/pull_toward_mean/models/diffusion_model.json`,
        { dim: 2, hidden: 128, T: 1000 }
      );

      // Load target distribution
      const targetRes = await fetch(`${base}/pull_toward_mean/data/smiley_face.json`);
      if (!targetRes.ok) throw new Error("Failed to load target distribution");
      const targetData = await targetRes.json();
      targetDistribution = targetData.points;

      // Load flow matching trajectories
      const fmRes = await fetch(`${base}/pull_toward_mean/cached_samples/flow_matching_trajectories.json`);
      if (!fmRes.ok) throw new Error("Failed to load flow matching trajectories");
      flowMatchingTrajectories = await fmRes.json();

      // Load diffusion trajectories
      const diffRes = await fetch(`${base}/pull_toward_mean/cached_samples/diffusion_trajectories.json`);
      if (!diffRes.ok) throw new Error("Failed to load diffusion trajectories");
      diffusionTrajectories = await diffRes.json();

      isLoading = false;
    } catch (e) {
      console.error("Failed to initialize:", e);
      error = e instanceof Error ? e.message : String(e);
      isLoading = false;
    }
  });
</script>

<svelte:head>
  <title>Pull Toward Mean - Flow Matching vs Diffusion</title>
</svelte:head>

<main>
  <h1>Flow Matching vs Diffusion</h1>

  {#if isLoading}
    <div class="loading">Loading...</div>
  {:else if error}
    <div class="error">
      <p>Error: {error}</p>
      <p>Make sure to run the training and sampling scripts first:</p>
      <pre>npm run train:pull-toward-mean
npm run sample:pull-toward-mean</pre>
    </div>
  {:else}
    <PullTowardMean
      {flowMatchingClient}
      {diffusionClient}
      leftTrajectories={flowMatchingTrajectories}
      rightTrajectories={diffusionTrajectories}
      {targetDistribution}
    >
      {#snippet children()}
        <p class="caption">
          <strong>Figure 1:</strong> Comparison of Flow Matching (left) and DDPM Diffusion (right).
          Both models transform samples from a uniform grid to the target distribution (smiley face).
          Tap anywhere on a canvas to spawn a trajectory from that point.
        </p>
      {/snippet}
    </PullTowardMean>
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
