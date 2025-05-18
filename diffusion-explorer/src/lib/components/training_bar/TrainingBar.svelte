<script>
    import { base } from '$app/paths';
    // Import components
    import ToggleButton from '$lib/components/ToggleButton.svelte';
    import HyperparameterSelect from '$lib/components/training_bar/HyperparameterSelect.svelte';
    import MiniDistribution from '$lib/components/training_bar/MiniDistribution.svelte';
    // Import settings
    import * as settings from '$lib/settings';
    import { trainingObjective, sampler, epochValue, isTraining } from '$lib/state';
    
    export let datasetDict = {};

    function padEpochValue(value) {
        // Take the epoch value and convert it to a 5 digit number, with leading zeros and a comma
        const paddedValue = String(value).padStart(5, '0');
        return paddedValue.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
    }

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
    }

    .training-bar {
        padding: 10px 0;
        display: flex;
        /* justify-content: center; */
        justify-content: left;
        align-items: center;
        width: calc(var(--display-area-width) - 200px);
        gap: 20px;
    }

    .menu {
        height: 100%;
    }

    .reset-training-button {
        margin-left: 50px;
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

    :global(.train-button) {
        height: 40px;
        width: 140px;
    }

    .epoch-counter-value {
        font-family: var(--font-family);
        font-size: 26px;
        font-weight: 300;
        color: #777;
        margin: 0;
        margin-top: 16px;
        margin-bottom: 12px;
    }

    /* If the screen becomes less than 700 wide then change the flex direction */
    @media (max-width: 800px) {
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
    /* If width becomes below 400 then make the hyperparameter menu flex column */
    @media (max-width: 400px) {
        .menu {
            flex-direction: column;
            align-items: left;
            width: 100%;
            margin-bottom: 10px;
        }

        .training-bar-container {
            padding-left: 20px;
        }
    }

</style>

<div class="training-bar-container">
    <div class="training-bar">
        <div class="menu training-objective-menu">
            <HyperparameterSelect 
                name="Training Objective"
                bind:current={$trainingObjective}
                options={settings.trainingObjectives}
            />
        </div>
        <div class="menu sampler-menu">
            <HyperparameterSelect
                name="Sampler"
                bind:current={$sampler}
                options={settings.trainingObjectiveToSamplers[$trainingObjective]}
            />
        </div>
        <div class="menu dataset-menu">
            <h1 class="label">Dataset</h1>
            <div class="mini-distribution-container">
                {#each Object.entries(datasetDict) as [name, data]}
                    <MiniDistribution data={data} distributionId={name} />
                {/each}
            </div>
        </div>
        <div class="menu reset-training-button">
            <!-- Reset icon -->
            <h1 class="label">&#8203;</h1>
            <img src="{base}/ResetIcon.svg" alt="Reset" width="34" height="34" />
        </div>
        <div class="menu train-button-container">
            <h1 class="label">Run Training</h1>
            <ToggleButton
                className="train-button"
                label="Run Training"
                activeLabel="Pause Training"
                value={isTraining}
            />
        </div>
        <div class="menu epoch-counter">
            <h1 class="label">Epoch</h1>
            <p class="epoch-counter-value">{padEpochValue($epochValue)}</p>
        </div>
    </div>
</div>