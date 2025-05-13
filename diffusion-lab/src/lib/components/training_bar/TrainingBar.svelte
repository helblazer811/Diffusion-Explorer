<script>
    import { base } from '$app/paths';
    // Import components
    import HyperparameterSelect from '$lib/components/training_bar/HyperparameterSelect.svelte';
    import MiniDistribution from '$lib/components/training_bar/MiniDistribution.svelte';

    import { hyperparameterMenuConfig } from '$lib/state';

    
    export let datasetDict = {};

</script>

<style>
    .training-bar-container {
        height: 110px;
        width: 100%;
        background-color: rgb(243, 243, 243);
        position: relative;
        box-shadow: rgba(0, 0, 0, 0.2) 0px 2px 4px 0px;
        display: flex;
        justify-content: center;
        padding: 0 10px;
    }

    .training-bar {
        padding: 10px 0;
        display: flex;
        /* justify-content: center; */
        justify-content: left;
        align-items: center;
        width: calc(var(--display-area-width) - 200px);
    }

    .hyperparameter-menu {
        display: flex;
        /* margin-left: 20px; */
        flex-direction: row;
        height: 100%;
    }

    .dataset-menu {
        /* margin-left: 20px; */
        height: 100%;
    }
   
    .mini-distribution-container {
        /* height: 60px; */
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 20px;
        box-sizing: border-box;
    }

    .label {
        color: #777;
        font-size: 18px;
        display: block;
        font-weight: 300;
        font-family: var(--font-family);
        margin: 0;
        margin-top: 6px;
        margin-bottom: 12px;
    }

    /* If the screen becomes less than 700 wide then change the flex direction */
    @media (max-width: 700px) {
        .training-bar-container {
            height: auto;
        }

        .training-bar {
            flex-direction: column;
            align-items: left;
            justify-content: left;
            width: 100%;
            padding: 10px 0;
        }

        .mini-distribution-container {
            width: 100%;
            display: flex;
            flex-direction: row;
            justify-content: left;
        }

    }
    /* IF width becomes below 400 then make the hyperparameter menu flex column */
    @media (max-width: 400px) {
        .hyperparameter-menu {
            flex-direction: column;
            align-items: left;
            width: 100%;
            margin-bottom: 10px;
        }

        .dataset-menu {
            flex-direction: column;
            align-items: left;
            width: 100%;
            margin-bottom: 10px;
        }
    }

</style>

<div class="training-bar-container">
    <div class="training-bar">
        <div class="hyperparameter-menu">
            {#each Object.entries(hyperparameterMenuConfig) as [name, entry]}
                <HyperparameterSelect entry={entry} />
            {/each}
        </div>
        <div class="dataset-menu">
            <h1 class="label">Dataset</h1>
            <div class="mini-distribution-container">
                {#each Object.entries(datasetDict) as [name, data]}
                    <MiniDistribution data={data} distributionId={name} />
                {/each}
            </div>
        </div>
    </div>
</div>