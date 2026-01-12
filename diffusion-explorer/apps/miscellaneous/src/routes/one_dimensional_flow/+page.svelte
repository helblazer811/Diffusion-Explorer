<script lang="ts">
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import OneDimensionalFlow from "./OneDimensionalFlow.svelte";

  // Data store - using plain variables instead of $state
  let trajectories: number[][][] = [];

  // Loading state
  let isLoading = true;
  let error: string | null = null;

  onMount(async () => {
    console.log("[Page] onMount started");
    try {
      const url = `${base}/one_dimensional_flow/cached_samples/trajectories.json`;
      console.log("[Page] Fetching:", url);
      const res = await fetch(url);
      console.log("[Page] Response status:", res.status);
      if (!res.ok) throw new Error("Failed to load trajectories");

      const data = await res.json();
      console.log("[Page] Loaded trajectories:", data.length, "steps");

      trajectories = data;
      isLoading = false;
      console.log("[Page] Loading complete, isLoading:", isLoading);
    } catch (e) {
      console.error("[Page] Failed to load data:", e);
      error = e instanceof Error ? e.message : String(e);
      isLoading = false;
    }
  });
</script>

<svelte:head>
  <title>One-Dimensional Flow</title>
</svelte:head>

<main>
  <h1>One-Dimensional Flow</h1>
  <p class="subtitle">Flow matching transforming Gaussian noise into a 3-mode mixture</p>

  {#if isLoading}
    <div class="loading">Loading...</div>
  {:else if error}
    <div class="error">
      <p>Error: {error}</p>
      <p>Make sure to run the training and sampling scripts first:</p>
      <pre>npm run train:one-dimensional-flow
npm run sample:one-dimensional-flow</pre>
    </div>
  {:else}
    <OneDimensionalFlow {trajectories} width={900} height={350} />
    <p class="caption">
      <strong>Figure:</strong> Density evolution of a 1D flow model over time. The heatmap shows
      the probability density at each value (y-axis) as time progresses (x-axis). Pathlines
      trace individual sample trajectories from Gaussian noise (t=0) to the learned 3-mode
      Gaussian mixture (t=1).
    </p>
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
    margin-bottom: 8px;
    color: #333;
  }

  .subtitle {
    text-align: center;
    color: #666;
    margin-bottom: 24px;
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
    max-width: 700px;
    margin-left: auto;
    margin-right: auto;
  }
</style>
