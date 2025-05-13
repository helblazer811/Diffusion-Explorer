<script lang="ts">
    import * as tf from '@tensorflow/tfjs';

    import { 
        UIState, 
        currentTime, 
        sourceDistributionSamples,
        targetDistributionSamples,
        currentDistributionSamples,
        allTimeSamples
    } from '$lib/state';

    import {
        interfaceSettings, 
        domainRange 
    } from '$lib/state';

    import Distribution from '$lib/components/display_area/Distribution.svelte';
    import { onMount } from 'svelte';

    let sharedSVGElement: SVGSVGElement; // Shared SVG element for all distributions

    // If the currentTime changes then update the current distribution samples in the UI state
    $: if ($currentTime) {
        // Convert current time to index
        let currentTimeIndex = Math.floor($currentTime * $UIState.numberOfSteps);
        // Avoid going out of bounds
        if (currentTimeIndex >= $UIState.numberOfSteps) {
            currentTimeIndex = $UIState.numberOfSteps - 1;
        }
        // Pull out the current time samples from the all time samples
        const currentSamples = tf.tidy(() => $allTimeSamples.gather(currentTimeIndex));
        // Update the current distribution samples in the UI state
        currentDistributionSamples.set(currentSamples);
    }

</script>

<style>
    .display-area {
        /* position: relative; */
        /* left: -200px; */
        /* height: 100%; */
        /* left: 0; */
        /* topL: 0; */
        /* z-index: 5; */
        /* width: 1100px; */
        /* position: relative; */
        /* margin: 0 auto; */
        /* transform: translateX(-100px); */
        /* transform: translateX(-50%); */
        /* width: 100%; */
        width: var(--display-area-width);
        transform-origin: top left;
        /* max-width: var(--display-area-width); */
        /* max-height: var(--display-area-height); */
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
    ></svg>

    {#if sharedSVGElement}
        <Distribution
            svgElement={sharedSVGElement}
            time={0}
            data={$sourceDistributionSamples}
            opacity={0.25}
            label="Source Distribution"
            distributionId="source"
            showBorder={true}
            fillColor="rgba(25, 131, 255, 0.2)"
            borderColor="rgba(25, 131, 255, 1)"
        />
        <Distribution
            svgElement={sharedSVGElement}
            time={1.0}
            data={$targetDistributionSamples}
            opacity={0.25}
            label="Data Distribution"
            distributionId="target"
            showBorder={true}
            fillColor="rgba(25, 131, 255, 0.2)"
            borderColor="rgba(25, 131, 255, 1)"
        />
        <Distribution
            svgElement={sharedSVGElement}
            time={$currentTime}
            data={$currentDistributionSamples}
            opacity={0.8}
            label=""
            fillColor="rgba(255, 100, 0, 0.3)"
            borderColor="rgba(255, 100, 0, 1)"
            labelIsLatex={true}
            showBorder={true}
            distributionId="current"
        />
    {/if}
</div>