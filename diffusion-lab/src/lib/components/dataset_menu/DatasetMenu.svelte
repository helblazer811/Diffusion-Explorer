<script>
    import MiniDistribution from '$lib/components/dataset_menu/MiniDistribution.svelte';

    export let datasetDict = {}; // TODO should this be a prop?
</script>

<style>
    .dataset-menu {
        height: 100%;
        width: 100px;
        display: flex;
        flex-direction: column;
        align-items: right; 
        justify-content: center;
        gap: 20px;                  
        padding-bottom: 100px;
        box-sizing: border-box;
        position: absolute;
        left: -150px;
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
