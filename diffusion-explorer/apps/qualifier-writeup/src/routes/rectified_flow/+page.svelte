<script lang="ts">
  import { onMount } from "svelte";
  import { writable, type Writable } from "svelte/store";
  import { settings } from "$lib/settings";
  import * as sample from "$lib/flow_matching/sample";
  import { base } from "$app/paths";
  import RectifiedFlowSuperimposed from "$lib/figures/RectifiedFlowSuperimposed.svelte";

  // Data stores
  const targetDistributionSamples: Writable<number[][]> = writable([]);
  const flowMatchingGridTrajectories: Writable<number[][][] | null> = writable(null);
  const rectifiedFlowGridTrajectories: Writable<number[][][][] | null> = writable(null);

  // Loading state
  let isLoading = true;
  let loadError: string | null = null;

  async function loadData() {
    try {
      // Load target distribution
      const targetSamples = await sample.loadTargetDistribution(
        `${base}/${settings.targetDistributionPointsPath}`,
        settings.samplingSettings.numSamples
      );
      if (targetSamples) {
        targetDistributionSamples.set(targetSamples);
      }

      // Load flow matching grid trajectories
      if (settings.cachedFlowMatchingGridTrajectoriesPath) {
        const fmResult = await sample.loadCachedTrajectories(
          `${base}/${settings.cachedFlowMatchingGridTrajectoriesPath}`
        );
        if (fmResult) {
          flowMatchingGridTrajectories.set(fmResult.trajectories);
        }
      }

      // Load rectified flow grid trajectories
      if (settings.cachedRectifiedFlowGridTrajectoriesPath) {
        const rfResult = await sample.loadCachedRectifiedFlowTrajectories(
          `${base}/${settings.cachedRectifiedFlowGridTrajectoriesPath}`
        );
        if (rfResult) {
          rectifiedFlowGridTrajectories.set(rfResult.allRectifiedTrajectories);
        }
      }

      isLoading = false;
    } catch (error) {
      loadError = error instanceof Error ? error.message : "Failed to load data";
      isLoading = false;
    }
  }

  onMount(() => {
    loadData();
  });
</script>

<div class="test-page">
  <h1>RectifiedFlowSuperimposed Test Page</h1>

  {#if isLoading}
    <div class="loading">Loading data...</div>
  {:else if loadError}
    <div class="error">Error: {loadError}</div>
  {:else}
    <div class="figure-container">
      <RectifiedFlowSuperimposed
        leftTrajectories={$flowMatchingGridTrajectories ?? []}
        rightTrajectories={$rectifiedFlowGridTrajectories?.[$rectifiedFlowGridTrajectories.length - 1] ?? []}
        targetDistribution={$targetDistributionSamples}
        playingByDefault={true}
        backgroundVisible={true}
      >
        <div class="caption">
          <span class="figure-number">Test Figure:</span>
          Left: Flow Matching trajectories. Right: Rectified Flow trajectories.
        </div>
      </RectifiedFlowSuperimposed>
    </div>

    <div class="debug-info">
      <h2>Debug Info</h2>
      <ul>
        <li>Target distribution samples: {$targetDistributionSamples.length}</li>
        <li>Flow matching grid trajectories: {$flowMatchingGridTrajectories?.length ?? 0} timesteps</li>
        <li>Rectified flow steps: {$rectifiedFlowGridTrajectories?.length ?? 0}</li>
        {#if $rectifiedFlowGridTrajectories && $rectifiedFlowGridTrajectories.length > 0}
          <li>Last rectified step trajectories: {$rectifiedFlowGridTrajectories[$rectifiedFlowGridTrajectories.length - 1]?.length ?? 0} timesteps</li>
        {/if}
      </ul>
    </div>
  {/if}
</div>

<style>
  .test-page {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem;
  }

  h1 {
    font-size: 1.8rem;
    margin-bottom: 1.5rem;
    color: #333;
  }

  .loading, .error {
    padding: 2rem;
    text-align: center;
    border-radius: 8px;
  }

  .loading {
    background-color: #f0f9ff;
    color: #0369a1;
  }

  .error {
    background-color: #fef2f2;
    color: #dc2626;
  }

  .figure-container {
    margin: 2rem 0;
  }

  .caption {
    font-size: 1rem;
    color: #555;
    margin-top: 0.5rem;
  }

  .figure-number {
    font-weight: 600;
  }

  .debug-info {
    margin-top: 2rem;
    padding: 1rem;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
  }

  .debug-info h2 {
    font-size: 1.2rem;
    margin-bottom: 0.5rem;
    color: #666;
  }

  .debug-info ul {
    margin: 0;
    padding-left: 1.5rem;
  }

  .debug-info li {
    margin: 0.25rem 0;
    color: #555;
  }
</style>
