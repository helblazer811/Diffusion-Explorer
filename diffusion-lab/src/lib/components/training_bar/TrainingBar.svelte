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
        position: absolute;
        padding: 10px 0;
        display: flex;
        align-items: center;
        width: var(--display-area-width);
        position: relative; /* Added to position the title and logo */
    }

    /* Add beta logo "before" the title */
    #beta-logo {
        position: absolute;
        left: -60px;
        width: 50px;
        height: 50px;
    }

    .title {
        margin: 0;
        font-size: 3.2em;
        color: var(--dark-blue);
        font-family: var(--font-family);
        vertical-align: middle;
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
        <img src="{base}/BetaLogo.svg" id="beta-logo" alt="Beta Logo" />
        <p class="title"><b>Diffusion</b>Lab</p>
        <div class="hyperparameter-menu">
            {#each Object.entries(hyperparameterMenuConfig) as [name, entry]}
                <HyperparameterSelect entry={entry} />
            {/each}
        </div>
    </div>
</div>