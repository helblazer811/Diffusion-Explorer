<script>
    import HyperparameterSelect from '$lib/components/HyperparameterSelect.svelte';
    import { hyperparameterMenuConfig } from '$lib/state';

</script>

<style>
    .training-bar {
        /* height: 110px; */
        padding: 10px 0;
        width: 100%;
        background-color: rgb(243, 243, 243);
        /* Add drop shadow on bottom */
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .training-bar-inner-container {
        display: flex;
        /* align-items: center; */
        height: 100%;
        width: var(--display-area-width);
        /* margin: 0 auto; */
    }  

    .hyperparameter-menu {
        display: flex;
        /* margin-left: 20px; */
        flex-direction: row;
        height: 100%;
    }

    .title {
        margin: 0;
        /* margin-left: 30px; */
        font-size: 3.2em;
        color: var(--dark-blue);
        font-family: var(--font-family);
        vertical-align: middle;
    }
</style>

<div class="training-bar">
    <div class="training-bar-inner-container">
        <p class="title"><b>Diffusion</b>Lab</p>
        <div class="hyperparameter-menu">
            {#each Object.entries(hyperparameterMenuConfig) as [name, entry]}
                <HyperparameterSelect entry={entry} />
            {/each}
        </div>
    </div>
</div>