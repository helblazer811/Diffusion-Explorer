<script>
    import * as tf from '@tensorflow/tfjs';

    import { 
        UIState, 
        currentTime, 
        sourceDistributionSamples,
        targetDistributionSamples,
        currentDistributionSamples,
        allTimeSamples
    } from '$lib/state';
    import { interfaceSettings } from '$lib/state';

    import Distribution from '$lib/components/display_area/Distribution.svelte';
    
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
        position: relative;
    }
</style>

<div 
    class="display-area" 
    style="width: {interfaceSettings.displayAreaWidth}px; height: {interfaceSettings.displayAreaHeight}px;"
>
    <Distribution
        data={$sourceDistributionSamples}
        xLocation={0}
        opacity={0.25}
        label="Source Distribution"
        distributionId="source"
        colorMap="Blues"
        showBorder={true}
        fillColor="rgba(0, 0, 255, 0.2)"
        borderColor="rgba(0, 0, 255, 1)"
    />
    <Distribution
        data={$targetDistributionSamples}
        xLocation={interfaceSettings.displayAreaWidth - interfaceSettings.distributionWidth}
        opacity={0.25}
        label="Data Distribution"
        distributionId="target"
        colorMap="Blues"
        showBorder={true}
        fillColor="rgba(0, 0, 255, 0.2)"
        borderColor="rgba(0, 0, 255, 1)"
    />
    <Distribution
        data={$currentDistributionSamples}
        xLocation={$currentTime * (interfaceSettings.displayAreaWidth - interfaceSettings.distributionWidth)}
        opacity={0.8}
        label=""
        colorMap="Oranges"
        fillColor="rgba(255, 92, 0, 0.5)"
        borderColor="rgba(255, 92, 0, 1)"
        labelIsLatex={true}
        showBorder={true}
        distributionId="current"
    />
</div>