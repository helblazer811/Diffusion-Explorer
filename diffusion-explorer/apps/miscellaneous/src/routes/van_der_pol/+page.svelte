<script lang="ts">
  import VanDerPolOscillator from "./VanDerPolOscillator.svelte";
</script>

<svelte:head>
  <title>Van der Pol Limit Cycle</title>
</svelte:head>

<main>
  <h1>Van der Pol Limit Cycle</h1>
  <p class="description">
    <strong>A limit cycle is a closed trajectory in phase space</strong> that
    nearby orbits converge to (or diverge from) over time. Unlike the closed
    orbits of a conservative system, a stable limit cycle is an isolated
    attractor: no matter where the system starts, it eventually settles into
    the same periodic motion.
  </p>

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
    color: #1a1a1a;
    margin-bottom: 1.25rem;
    text-align: center;
  }

  .description {
    font-size: 1.35rem;
    color: #444;
    text-align: center;
    max-width: 800px;
    margin: 0 auto 2rem auto;
    line-height: 1.55;
  }

  .description strong {
    color: #1a1a1a;
  }

  .figure-container {
    display: flex;
    justify-content: center;
    width: 100%;
    max-width: 800px;
    margin: 0 auto;
  }
</style>
