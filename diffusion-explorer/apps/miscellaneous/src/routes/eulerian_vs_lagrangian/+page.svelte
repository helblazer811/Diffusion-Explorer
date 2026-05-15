<script lang="ts">
  import EulerianVsLagrangian from "./EulerianVsLagrangian.svelte";
</script>

<svelte:head>
  <title>Eulerian vs Lagrangian</title>
</svelte:head>

<main>
  <h1>Eulerian vs Lagrangian</h1>
  <p class="description">
    Two perspectives on the same flow transporting a Gaussian to a smiley-face
    distribution. The Eulerian view shows the velocity field at each point in
    space; the Lagrangian view follows individual particles along their
    trajectories.
  </p>

  <div class="figure-container">
    <EulerianVsLagrangian />
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
    max-width: 800px;
    margin: 0 auto;
  }
</style>
