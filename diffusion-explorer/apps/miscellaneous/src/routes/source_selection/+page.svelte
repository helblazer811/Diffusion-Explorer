<script lang="ts">
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import SourceSelection from "./SourceSelection.svelte";

  // Source type definitions
  type SourceType = 'gaussian' | 'uniform' | 'ring';

  // Data for each source type
  interface SourceData {
    sourceDistribution: number[][];
    miniDistribution: number[][];
    trajectories: number[][][];
  }

  // Data stores
  let targetDistribution: number[][] = [];
  let sourceData: Record<SourceType, SourceData> = {
    gaussian: { sourceDistribution: [], miniDistribution: [], trajectories: [] },
    uniform: { sourceDistribution: [], miniDistribution: [], trajectories: [] },
    ring: { sourceDistribution: [], miniDistribution: [], trajectories: [] }
  };

  // Active source type selection
  let activeSourceType: SourceType = 'gaussian';

  // Derived data based on selection
  $: currentSourceDistribution = sourceData[activeSourceType].sourceDistribution;
  $: currentTrajectories = sourceData[activeSourceType].trajectories;

  // Loading state
  let isLoading = true;
  let error: string | null = null;

  onMount(async () => {
    try {
      // Load all data in parallel
      const [targetRes, gaussianRes, uniformRes, ringRes] = await Promise.all([
        fetch(`${base}/source_selection/data/smiley_face.json`),
        fetch(`${base}/source_selection/cached_samples/gaussian_trajectories.json`),
        fetch(`${base}/source_selection/cached_samples/uniform_trajectories.json`),
        fetch(`${base}/source_selection/cached_samples/ring_trajectories.json`)
      ]);

      if (!targetRes.ok) throw new Error("Failed to load target distribution");
      if (!gaussianRes.ok) throw new Error("Failed to load Gaussian trajectories");
      if (!uniformRes.ok) throw new Error("Failed to load Uniform trajectories");
      if (!ringRes.ok) throw new Error("Failed to load Ring trajectories");

      const [targetData, gaussianData, uniformData, ringData] = await Promise.all([
        targetRes.json(),
        gaussianRes.json(),
        uniformRes.json(),
        ringRes.json()
      ]);

      targetDistribution = targetData.points;
      sourceData = {
        gaussian: gaussianData,
        uniform: uniformData,
        ring: ringData
      };

      isLoading = false;

    } catch (e) {
      console.error("Failed to load data:", e);
      error = e instanceof Error ? e.message : String(e);
      isLoading = false;
    }
  });

  function handleSourceChange(type: SourceType) {
    activeSourceType = type;
  }
</script>

<svelte:head>
  <title>Source Selection - Flow Matching with Arbitrary Sources</title>
</svelte:head>

<main>
  <h1>Source Selection</h1>
  <p class="description">
    Flow models can use arbitrary source distributions, not just Gaussian noise.
    Select different source distributions below to see how the learned flow transforms each to the target.
  </p>

  {#if isLoading}
    <div class="loading">Loading...</div>
  {:else if error}
    <div class="error">
      <p>Error: {error}</p>
      <p>Make sure to run the training and sampling scripts first:</p>
      <pre>npm run train:source-selection
npm run sample:source-selection</pre>
    </div>
  {:else}
    <SourceSelection
      {targetDistribution}
      sourceDistribution={currentSourceDistribution}
      trajectories={currentTrajectories}
      {activeSourceType}
      allSourceData={sourceData}
      onSourceChange={handleSourceChange}
      width={1000}
    />
  {/if}
</main>

<style>
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px;
  }

  h1 {
    text-align: center;
    font-size: 2rem;
    margin-bottom: 12px;
    color: #333;
  }

  .description {
    text-align: center;
    color: #666;
    font-size: 1rem;
    margin-bottom: 24px;
    line-height: 1.5;
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
</style>
