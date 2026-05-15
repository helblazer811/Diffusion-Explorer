<script lang="ts">
  import TopographicContours from './TopographicContours.svelte';
  import EnergyViews from './EnergyViews.svelte';
</script>

<svelte:head>
  <title>Energy Based Models</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@100;300&display=swap" rel="stylesheet" />
</svelte:head>

<TopographicContours />

<div style="height: 32px;"></div>

<EnergyViews />

<style>
  :global(html), :global(body) {
    background-color: #0F0E13;
    margin: 0;
    padding: 0;
  }
</style>
