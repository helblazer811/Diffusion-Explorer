<script lang="ts">
    import * as tf from '@tensorflow/tfjs';

    import { 
        currentTime, 
        sourceDistributionSamples,
        targetDistributionSamples,
        currentDistributionSamples,
        allTimeSamples,
        activePlotTypes,
        numberOfSteps,
        distributionVisiblity,
        intermediateTrainingSamples,
        isEditing,
    } from '$lib/state';

    import { interfaceSettings } from '$lib/settings';

    // Import components
    import Distribution from '$lib/components/display_area/Distribution.svelte';
    import DistributionEditWindow from './DistributionEditWindow.svelte';

    let sharedSVGElement: SVGSVGElement; // Shared SVG element for all distributions

    // If the currentTime changes then update the current distribution samples in the UI state
    $: if ($currentTime && $allTimeSamples) {
        // Convert current time to index
        let currentTimeIndex = Math.floor($currentTime * $numberOfSteps);
        // Avoid going out of bounds
        if (currentTimeIndex >= $numberOfSteps) {
            currentTimeIndex = $numberOfSteps - 1;
        }
        // Pull out the current time samples from the all time samples
        const currentSamples = tf.tidy(() => $allTimeSamples.gather(currentTimeIndex));
        // Update the current distribution samples in the UI state
        currentDistributionSamples.set(currentSamples);
    }

</script>

<style>
    .display-area {
        width: var(--display-area-width);
        transform-origin: top left;
        aspect-ratio: calc(var(--display-area-width) / var(--display-area-height));
        position: relative;
    }

    @media (max-width: var(--display-area-width)) {
        .display-area {
            transform: scale(calc(100vw / var(--display-area-width)));
        }
    }
</style>

<div 
    class="display-area" 
>
    <svg
        bind:this={sharedSVGElement}
        viewBox="0 0 {interfaceSettings.displayAreaWidth} {interfaceSettings.displayAreaHeight}"
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height="100%"
    >
        {#if sharedSVGElement}
            <Distribution
                svgElement={sharedSVGElement}
                visible={$distributionVisiblity.source}
                time={0}
                data={$sourceDistributionSamples}
                opacity={0.7}
                label=""
                distributionId="source"
                showBorder={false}
                fillColor="rgba(25, 131, 255, 0.2)"
                borderColor="rgba(25, 131, 255, 1)"
            />
            <Distribution
                svgElement={sharedSVGElement}
                visible={$distributionVisiblity.target}
                time={1.0}
                data={$targetDistributionSamples}
                opacity={0.7}
                label=""
                distributionId="target"
                showBorder={false}
                fillColor="rgba(25, 131, 255, 0.2)"
                borderColor="rgba(25, 131, 255, 1)"
            />
            <Distribution
                svgElement={sharedSVGElement}
                visible={$distributionVisiblity.current}
                time={$currentTime}
                data={$currentDistributionSamples}
                allTimeSamples={$allTimeSamples}
                opacity={0.8}
                label=""
                fillColor="rgba(255, 100, 0, 0.5)"
                borderColor="rgba(255, 100, 0, 1)"
                labelIsLatex={true}
                showBorder={false}
                distributionId="current"
                activePlotTypes={$activePlotTypes}
            />
            <Distribution
                svgElement={sharedSVGElement}
                visible={$distributionVisiblity.training}
                time={1.0}
                data={$intermediateTrainingSamples}
                opacity={0.8}
                label=""
                fillColor="rgba(255, 100, 0, 0.5)"
                borderColor="rgba(255, 100, 0, 1)"
                labelIsLatex={true}
                showBorder={false}
                distributionId="training"
                activePlotTypes={["Contour"]}
            />
        {/if}
        <DistributionEditWindow
            svgElement={sharedSVGElement}
            active={$isEditing}
        />
    </svg>
</div>