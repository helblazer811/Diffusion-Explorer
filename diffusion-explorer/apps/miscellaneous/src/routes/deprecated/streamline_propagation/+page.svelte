<script lang="ts">
  import { onMount } from 'svelte';
  import StreamlinePropagation from './StreamlinePropagation.svelte';
  import type { PropagatedStreamlineData, DiscreteStreamlineData } from '@diffusion-explorer/ui';

  let propagatedData: PropagatedStreamlineData | null = null;
  let discreteData: DiscreteStreamlineData | null = null;
  let isLoading = true;
  let error: string | null = null;

  onMount(async () => {
    try {
      const [propResponse, discResponse] = await Promise.all([
        fetch('/streamline_propagation/cached_samples/propagated_streamlines.json'),
        fetch('/streamline_propagation/cached_samples/discrete_streamlines.json'),
      ]);

      if (!propResponse.ok || !discResponse.ok) {
        throw new Error('Failed to load cached data. Run the propagate script first.');
      }

      propagatedData = await propResponse.json();
      discreteData = await discResponse.json();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load data';
    } finally {
      isLoading = false;
    }
  });
</script>

<svelte:head>
  <title>Streamline Propagation | Miscellaneous</title>
</svelte:head>

<div class="page-container">
  <h1>Streamline Propagation</h1>

  {#if isLoading}
    <div class="loading">Loading visualization data...</div>
  {:else if error}
    <div class="error">
      <p>Error: {error}</p>
      <p>Make sure to run: <code>npm run propagate:streamline-propagation</code></p>
    </div>
  {:else if propagatedData && discreteData}
    <StreamlinePropagation {propagatedData} {discreteData} />
  {/if}
</div>

<style>
  .page-container {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem;
  }

  h1 {
    text-align: center;
    margin-bottom: 1.5rem;
    font-weight: 500;
  }

  .loading {
    text-align: center;
    padding: 3rem;
    color: #666;
  }

  .error {
    text-align: center;
    padding: 2rem;
    background: #fee;
    border-radius: 8px;
    color: #c00;
  }

  .error code {
    background: #fff;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-family: monospace;
  }
</style>
