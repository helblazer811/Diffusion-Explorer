<script lang="ts">
  import StokesTheoremSquare from "./StokesTheoremSquare.svelte";
</script>

<svelte:head>
  <title>Stokes' Theorem (Square Grid)</title>
</svelte:head>

<div class="page-container">
  <h1>Stokes' Theorem: Square Grid</h1>
  <StokesTheoremSquare />
</div>

<style>
  .page-container {
    max-width: 900px;
    margin: 2rem auto;
    padding: 0 1rem;
  }

  h1 {
    text-align: center;
    color: #4b5563;
    margin-bottom: 2rem;
    font-size: 2rem;
    font-weight: 600;
  }
</style>
