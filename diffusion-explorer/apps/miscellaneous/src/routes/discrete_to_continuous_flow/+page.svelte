<script lang="ts">
  import DiscreteToContFlow from './DiscreteToContFlow.svelte';
</script>

<svelte:head>
  <title>Discrete to Continuous Normalizing Flow</title>
</svelte:head>

<main>
  <DiscreteToContFlow width={1600} />
</main>

<style>
  main {
    max-width: 1800px;
    margin: 0 auto;
    padding: 24px;
  }
</style>
