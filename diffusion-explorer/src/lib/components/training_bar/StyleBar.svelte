<script lang="ts">
    import { base } from '$app/paths';
    import { derived, get } from 'svelte/store';
    import { trainingObjectiveToDisplayOptions } from '$lib/settings';
	import { trainingObjective, activePlotTypes } from '$lib/state';
    import ToggleButton from '../primitives/ToggleButton.svelte';

    const plotTypes = ['Scatter', 'Contour', 'Mesh', 'Path'];
    const plotTypeIcons = {
        "Scatter": `${base}/StyleIcons/PointsIcon.svg`,
        "Contour": `${base}/StyleIcons/ContourIcon.svg`,
        "Mesh": `${base}/StyleIcons/MeshIcon.svg`,
        "Path": `${base}/StyleIcons/PathIcon.svg`
    };

    const enabledPlotTypes = derived(trainingObjective, $trainingObjective =>
        trainingObjectiveToDisplayOptions[$trainingObjective]?.["Plot Types"] ?? []
    );

    // Class helper function
    function getButtonClass(plotType: string, enabled: string[], active: string[]) {
        if (!enabled.includes(plotType)) return 'disabled';
        if (active.includes(plotType)) return 'active';
        return 'inactive';
    }

    // // Handler for button click
    // function onClickHandler(event: MouseEvent) {
    //     const plotType = event.currentTarget.querySelector('p').textContent;
    //     const nextActivePlotTypes = new Set(get(activePlotTypes));

    //     if (!get(enabledPlotTypes).includes(plotType)) {
    //         return; // Do nothing if the plot type is not enabled
    //     }
    //     if (nextActivePlotTypes.has(plotType)) {
    //         nextActivePlotTypes.delete(plotType);
    //     } else {
    //         nextActivePlotTypes.add(plotType);
    //     }

    //     activePlotTypes.set(Array.from(nextActivePlotTypes));
    // }

    // Each button has three states: active, inactive, disabled
    // The button is disabled if it is not in trainingObjectiveToDisplayOptions[trainingObjective]["Plot Types"]
    // The button is active if it is in activePlotTypes
    // The button is inactive if it is not in activePlotTypes, and it is not disabled

</script>
<!-- 
<style>
    .style-bar-container {
        position: absolute;
        top: 10px;
        z-index: 3;
    }

    .style-bar {
        width: calc(var(--display-area-width) - 200px);
        display: flex;
        flex-direction: row;
        gap: 10px;
    }

    .style-bar-button {
        cursor: pointer; /* Pointer cursor for hover effect */
        height: 30px;
        display: flex;
        flex-direction: row;
        align-items: center;
        border-radius: 5px;
        padding: 0 10px;
        gap: 5px;
        box-shadow: 0px 0px 2px rgba(0, 0, 0, 0.4);
    }

    .style-bar-button p {
        font-family: Arial, Helvetica, sans-serif;
        font-weight: 500;
        user-select: none;  /* Prevents text from being highlighted */
    }

    .style-bar-button img {
        width: 24px;
        height: 24px;
    }

    /* Implement the styling for each button state.  */

    .style-bar-button.active {
        background-color: #E0ECFE;
        color: #2368B0;
    }

    .style-bar-button.active:hover {
        background-color: #c1daff;
    }

    .style-bar-button.inactive {
        background-color: #ffffff;
        color: #565656;
    }

    .style-bar-button.inactive img {
        filter: grayscale(100%);
    }

    .style-bar-button.inactive:hover {
        background-color: #f0f0f0;
    }

    .style-bar-button.disabled {
        background-color: #f0f0f0;
        color: #b0b0b0;
        cursor: not-allowed; /* Not-allowed cursor for disabled state */
    }

    .style-bar-button.disabled img {
        filter: grayscale(100%);
        opacity: 0.3;
    }

</style>

<div class="style-bar-container">
    <div class="style-bar">
        <div class="style-bar">
            {#each plotTypes as plotType}
                <div
                    class="style-bar-button {getButtonClass(plotType, $enabledPlotTypes, $activePlotTypes)}"
                    on:click={onClickHandler}
                >
                    <img src="{plotTypeIcons[plotType]}" alt="{plotType}" />
                    <p>{plotType}</p>
                </div>
            {/each}
        </div>
    </div>
</div> -->

<div class="style-bar-container">
    <div class="style-bar">
        {#each $enabledPlotTypes as plotType}
            <ToggleButton
                class="style-bar-button"
                icon={plotTypeIcons[plotType]}
                disabled={!$enabledPlotTypes.includes(plotType)}
                label={plotType}
                value={activePlotTypes}
                on:click={onClickHandler}
            />
        {/each}
    </div>
</div>