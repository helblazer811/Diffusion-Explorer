<script>
    import MiniDistribution from '$lib/components/dataset_menu/MiniDistribution.svelte';

    export let datasetDict = {}; // TODO should this be a prop?
</script>

<style>
    .dataset-menu {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: left; 
        justify-content: center;
        gap: 20px;                /* Add space between items */
        margin-left: 20px;
        padding-bottom: 100px;
        box-sizing: border-box;
    }

    .dataset-menu-title {
        font-size: 1.2em;
        color: var(--dark-blue);
        font-family: var(--font-family);
        font-weight: 400;
        margin: 0;
    }

</style>

<div class="dataset-menu">
    <h1 class="dataset-menu-title">Datasets</h1>
    {#each Object.entries(datasetDict) as [name, data]}
        <MiniDistribution data={data} distributionId={name}/>
    {/each}
</div>
