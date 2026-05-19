<script lang="ts">
  import LorenzAttractor from "./LorenzAttractor.svelte";
</script>

<svelte:head>
  <title>The Lorenz Attractor</title>
</svelte:head>

<main>
  <h1>The Lorenz Attractor</h1>

  <div class="figure-container">
    <LorenzAttractor />
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
    max-width: 1280px;
    margin: 0 auto;
  }
</style>
