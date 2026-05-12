<script lang="ts">
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import OptimalTransportCoupling from "./OptimalTransportCoupling.svelte";

  let sourcePoints: number[][] = $state([]);
  let targetPoints: number[][] = $state([]);
  let otMatching: number[] = $state([]);
  let naiveMatching: number[] = $state([]);
  let otTrajectories: number[][][] = $state([]);
  let naiveTrajectories: number[][][] = $state([]);

  let isLoading = $state(true);
  let error: string | null = $state(null);

  onMount(async () => {
    try {
      const res = await fetch(
        `${base}/optimal_transport_coupling/cached_samples/coupling_data.json`,
      );
      if (!res.ok) throw new Error(`Failed to load coupling data: ${res.status}`);
      const data = await res.json();
      sourcePoints = data.sourcePoints;
      targetPoints = data.targetPoints;
      otMatching = data.otMatching;
      naiveMatching = data.naiveMatching;
      otTrajectories = data.otTrajectories;
      naiveTrajectories = data.naiveTrajectories;
      isLoading = false;
    } catch (e) {
      console.error("Failed to load:", e);
      error = e instanceof Error ? e.message : String(e);
      isLoading = false;
    }
  });
</script>

<svelte:head>
  <title>Optimal Transport Coupling</title>
</svelte:head>

<main>
  <h1>Optimal Transport Coupling</h1>

  {#if isLoading}
    <div class="loading">Loading...</div>
  {:else if error}
    <div class="error">
      <p>Error: {error}</p>
      <p>Make sure to run the training and sampling scripts first:</p>
      <pre>npm run prepare:ot-coupling</pre>
    </div>
  {:else}
    <div class="aspect-frame">
    <OptimalTransportCoupling
      {sourcePoints}
      {targetPoints}
      {otMatching}
      {naiveMatching}
      {otTrajectories}
      {naiveTrajectories}
    />
    </div>
    <p class="caption">
      Flow models are sensitive to the choice of <strong>coupling</strong> — how noise and data points
      are paired. Picking pairings via <strong>minibatch optimal transport</strong> minimises the
      total transport cost; the resulting trajectories are notably less curved than those learned
      under random (independent) pairing, which makes them easier to simulate with few inference
      steps.
    </p>
  {/if}
</main>

<style>
  main {
    max-width: 1700px;
    margin: 0 auto;
    padding: 24px;
  }
  .aspect-frame {
    width: 100%;
    max-width: 1600px;
    aspect-ratio: 16 / 10;
    margin: 0 auto;
    background-color: #ffffff;
    border: 1px solid #e0e0e0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    box-sizing: border-box;
  }
  /* Inside the aspect frame: collapse the figure's own margins/gaps and the empty caption slot */
  .aspect-frame :global(.figure) {
    margin: 0;
    gap: 0;
  }
  .aspect-frame :global(.figure-caption) {
    display: none;
  }
  :global(.page-container:has(main)) {
    max-width: 1700px !important;
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
