<script lang="ts">
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import { FlowModelClient } from "@diffusion-explorer/diffusion";
  import FlowModelLIC from "./FlowModelLIC.svelte";

  // Client state
  let flowModelClient: FlowModelClient | null = $state(null);
  let isLoading = $state(true);
  let error: string | null = $state(null);

  onMount(async () => {
    try {
      // Initialize Flow Model client
      flowModelClient = new FlowModelClient(
        `${base}/flow_model_lic/workers/flow_model.worker.js`,
        `${base}/flow_model_lic/models/model.json`,
        "Flow Matching",
        { dim: 2, hidden: 64 }
      );

      isLoading = false;
    } catch (e) {
      console.error("Failed to initialize FlowModelClient:", e);
      error = e instanceof Error ? e.message : String(e);
      isLoading = false;
    }
  });
</script>

<svelte:head>
  <title>Flow Model LIC Visualization</title>
</svelte:head>

<main>
  <h1>Flow Model LIC Visualization</h1>
  <p class="subtitle">
    Time-varying vector field visualization using Dynamic Line Integral Convolution
  </p>

  {#if isLoading}
    <div class="loading">Loading model...</div>
  {:else if error}
    <div class="error">
      <p>Error: {error}</p>
    </div>
  {:else if flowModelClient}
    <FlowModelLIC
      {flowModelClient}
      canvasWidth={500}
      canvasHeight={500}
      numTimeSteps={200}
      animationDurationMs={6000}
    />
  {/if}
</main>

<style>
  main {
    max-width: 800px;
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
</style>
