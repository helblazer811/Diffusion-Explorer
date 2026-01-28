<script lang="ts">
  import FlowModelDLIC from "./FlowModelDLIC.svelte";
</script>

<svelte:head>
  <title>Flow Model DLIC Visualization</title>
</svelte:head>

<main>
  <h1>Flow Model DLIC Visualization</h1>
  <p class="description">
    This visualization shows a flow model trained on a smiley face distribution.
    The left panel uses Dynamic Line Integral Convolution to visualize the learned
    velocity field, while the right panel shows animated trajectories from noise
    to the target distribution.
  </p>

  <div class="figure-container">
    <FlowModelDLIC />
  </div>
</main>

<style>
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    color: #1a1a1a;
    margin-bottom: 1rem;
    text-align: center;
  }

  .description {
    font-size: 1rem;
    color: #666;
    text-align: center;
    max-width: 800px;
    margin: 0 auto 2rem auto;
    line-height: 1.6;
  }

  .figure-container {
    display: flex;
    justify-content: center;
    width: 100%;
  }
</style>
