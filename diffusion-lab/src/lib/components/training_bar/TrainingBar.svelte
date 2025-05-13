<script>
    import HyperparameterSelect from '$lib/components/training_bar/HyperparameterSelect.svelte';

    import { hyperparameterMenuConfig } from '$lib/state';
    import { base } from '$app/paths';

</script>

<style>
    .training-bar-container {
        width: 100%;
        background-color: rgb(243, 243, 243);
        position: relative;
        box-shadow: rgba(0, 0, 0, 0.2) 0px 2px 4px 0px;
        display: flex;
        justify-content: center;
    }

    .training-bar {
        padding: 10px 0;
        display: flex;
        /* justify-content: center; */
        align-items: center;
        width: calc(var(--display-area-width) - 200px);
    }

    .hyperparameter-menu {
        display: flex;
        /* margin-left: 20px; */
        flex-direction: row;
        height: 100%;
    }

</style>

<div class="training-bar-container">
    <div class="training-bar">
        <div class="hyperparameter-menu">
            {#each Object.entries(hyperparameterMenuConfig) as [name, entry]}
                <HyperparameterSelect entry={entry} />
            {/each}
        </div>
    </div>
</div>