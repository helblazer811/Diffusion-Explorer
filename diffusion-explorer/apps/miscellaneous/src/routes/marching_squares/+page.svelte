<script lang="ts">
  import MarchingSquares from './MarchingSquares.svelte';
  import TopographicMap from './TopographicMap.svelte';
</script>

<div class="page">
  <MarchingSquares />
  <TopographicMap />
</div>

<style>
  :global(html), :global(body) {
    background-color: #1a1a1a;
    margin: 0;
    padding: 0;
  }

  .page {
    background-color: #1a1a1a;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 40px;
    padding: 40px 0;
  }
</style>
