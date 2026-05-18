<script lang="ts">
  import VanDerPolOscillator from "./VanDerPolOscillator.svelte";
</script>

<svelte:head>
  <title>Van der Pol Limit Cycle</title>
</svelte:head>

<main>
  <h1>Van der Pol Limit Cycle</h1>

  <div class="figure-container">
    <VanDerPolOscillator />
  </div>
</main>

<style>
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  h1 {
    font-size: 2.75rem;
    font-weight: 700;
    color: #666;
    margin-bottom: 1.25rem;
    text-align: center;
  }

  .figure-container {
    display: flex;
    justify-content: center;
    width: 100%;
    max-width: 800px;
    margin: 0 auto;
  }
</style>
