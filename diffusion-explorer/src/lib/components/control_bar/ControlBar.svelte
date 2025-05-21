<script>
    import { base } from '$app/paths';
    import { derived, get } from 'svelte/store';
    // Import components
    import ToggleButton from '$lib/components/primitives/ToggleButton.svelte';
    import DropDown from '$lib/components/primitives/DropDown.svelte';
    import MiniDistribution from '$lib/components/control_bar/MiniDistribution.svelte';
    // Import settings
    import *  as settings from '$lib/settings';
    import { 
        trainingObjective, 
        sampler, 
        epochValue, 
        isTraining,
        activePlotTypes,
        usePretrained,
        datasetName,
        datasetDict,
        isPlaying,
        targetDistributionSamples,
        currentDistributionSamples,
        allTimeSamples,
        numSamples,
        numberOfSteps
    } from '$lib/state';

    import { convertDataToDisplayCoordinateFrame } from '$lib/utils';
    import { callSamplingWorkerThread } from '$lib/diffusion/workers/utils';
    
    const plotTypeIcons = {
        "Scatter": `${base}/StyleIcons/PointsIcon.svg`,
        "Contour": `${base}/StyleIcons/ContourIcon.svg`,
        "Mesh": `${base}/StyleIcons/MeshIcon.svg`,
        "Path": `${base}/StyleIcons/PathIcon.svg`
    };

    function padEpochValue(value) {
        // Take the epoch value and convert it to a 5 digit number, with leading zeros and a comma
        const paddedValue = String(value).padStart(5, '0');
        return paddedValue.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
    }

    // Make a derived type for updating which plot types are enabled
    const enabledPlotTypes = derived(trainingObjective, $trainingObjective =>
        settings.trainingObjectiveToDisplayOptions[$trainingObjective]?.["Plot Types"] ?? []
    );

</script>

<style>
    .training-bar-container {
        height: 120px;
        width: 100%;
        background-color: rgb(243, 243, 243);
        position: relative;
        box-shadow: rgba(0, 0, 0, 0.2) 0px 2px 4px 0px;
        display: flex;
        justify-content: center;
    }

    .training-bar {
        padding: 5px 0;
        display: flex;
        /* justify-content: center; */
        justify-content: left;
        align-items: center;
        width: calc(var(--display-area-width) - 200px);
        gap: 10px;
    }

    .menu {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .menu-contents {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
    }

    .mini-distribution-container {
        /* height: 60px; */
        display: flex;
        flex-grow: 1;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 10px;
        box-sizing: border-box;
    }

    .label {
        color: #777;
        font-size: 18px;
        display: block;
        font-weight: 300;
        font-family: var(--font-family);
        /* margin: 0px 6px; */
        margin-top: 6px;
        margin-bottom: 6px;
    }

    .training-section-container {
        margin-left: auto; /* Push the training section to the right */
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 20px;
    }

    .train-button-container { 
        height: 100%;
    }

    .dataset-menu {
        margin-left: 20px;
    }

    :global(.train-button) {
        height: 40px;
        width: 140px;
    }

    .epoch-counter-value {
        width: 100px;
        font-family: var(--font-family);
        font-size: 26px;
        font-weight: 300;
        color: #777;
        margin: 0;
        /* margin-top: 14px; */
        /* margin-bottom: 12px; */
    }

    :global(.style-menu-button) {
        height: 22px;
        width: 80px;
    }
    .grid-2x2 {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        /* gap: 8px; */
        row-gap: 0px;
        column-gap: 4px;
        padding: 10px 0;
    }

    :global(.train-button) {
        width: 100px;
    }

    .dataset-menu-container {
        display: flex;
        flex-direction: column;
        align-items: left;
        justify-content: center;
        gap: 8px;
        padding-bottom: 15px;
        padding-top: 5px;
    }

    .dataset-menu-container span {
        font-family: var(--font-family);
        font-size: 12px;
        display: inline-flex;
        align-items: center;
        color: #777;
    }

    .mini-distribution-container {
        width: 100%;
        display: flex;
        flex-direction: row;
        justify-content: left;
    }

    .brush-mini-distribution {
        width: 24px;
        height: 24px;
        margin-left: 10px;
        margin-top: 5px;
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
            <h1 class="label">Training Objective</h1>
            <div class="menu-contents">
                <DropDown
                    bind:value={$trainingObjective}
                    disabled={$isTraining}
                    options={settings.trainingObjectives}
                />
            </div>
        </div>
        <div class="menu sampler-menu">
            <h1 class="label">Sampler</h1>
            <div class="menu-contents">
                <DropDown
                    bind:value={$sampler}
                    disabled={$isTraining}
                    options={settings.trainingObjectiveToSamplers[$trainingObjective]}
                />
            </div>
        </div>
        <div class="menu style-menu">
            <h1 class="label">Plot Types</h1>
            <div class="grid-2x2 menu-contents">
                {#each settings.plotTypes as plotType}
                    <ToggleButton
                        className="style-menu-button"
                        icon={plotTypeIcons[plotType]}
                        disabled={
                            !$enabledPlotTypes.includes(plotType)
                            || $isTraining
                        }
                        label={plotType}
                        active={derived(activePlotTypes, $v => $v.includes(plotType))}
                        toggle={() => {
                            const nextActivePlotTypes = new Set($activePlotTypes);
                            if (nextActivePlotTypes.has(plotType)) {
                                nextActivePlotTypes.delete(plotType);
                            } else {
                                nextActivePlotTypes.add(plotType);
                            }
                            // Update the actual store
                            activePlotTypes.set(Array.from(nextActivePlotTypes));
                        }}
                    />
                {/each}
            </div>
        </div>
        <div class="menu dataset-menu">
            <h1 class="label">Dataset</h1>
            <div class="menu-contents dataset-menu-container">
                <div class="mini-distribution-container">
                    {#each Object.entries($datasetDict) as [name, data]}
                        <MiniDistribution data={data} distributionId={name} />
                    {/each}
                    <MiniDistribution showBrush={true} data={null} distributionId="brush"/>
                </div>
                <span>
                    <input
                        type="checkbox"
                        id="scales"
                        name="scales"
                        style={$datasetName == "brush" ? "pointer-events: none; accent-color: lightgray; color: white;" : ""}
                        bind:checked={$usePretrained}
                    />
                    Use pretrained
                </span>
            </div>
        </div>
        <div class="training-section-container">
            <div class="menu train-button-container">
                <h1 class="label">Run Training</h1>
                <div class="menu-contents">
                    <ToggleButton
                        className="train-button"
                        label="Run Training"
                        activeLabel="Stop Training"
                        active={derived(isTraining, $v => $v)}
                        toggle={() => isTraining.update(v => !v)} 
                    />
                </div>
            </div>
            <div class="menu epoch-counter">
                <h1 class="label">Epoch</h1>
                <div class="menu-contents">
                    <p class="epoch-counter-value">{padEpochValue($epochValue)}</p>
                </div>
            </div>
        </div>
    </div>
</div>