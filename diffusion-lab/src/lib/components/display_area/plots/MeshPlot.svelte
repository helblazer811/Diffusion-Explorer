<script lang="ts"> 
    import * as tf from '@tensorflow/tfjs';

    import { onMount } from 'svelte';
    import { 
        domainRange, 
        UIState, 
        trainingObjectiveToModelConfig, 
        trainingObjective,
        pretrainedModelPaths,
        datasetName

    } from '$lib/state';

    import { callSamplingWorkerThread } from '$lib/diffusion/workers/utils';

    export let svgElement; // Shared SVG element for all distributions
    export let gridResolution: number = 10; // Resolution of the grid

    let trajectories: number[][] = []; // Array to hold the trajectories [time, 2]

    function plotMesh(
        time: number
    ) {
        // Get the points for the current time from the trajectories
        const points = trajectories[time];
        // Plot the mesh grid as a graph for the current time
    }

    onMount(() => {
        // Run sampling for a uniform grid of points
        console.log("Running sampling for a uniform grid of points");
        // First uniformly sample the x and y coordinates
        const x = tf.linspace($domainRange.xMin, $domainRange.xMax, gridResolution);
        const y = tf.linspace($domainRange.yMin, $domainRange.yMax, gridResolution);
        const points = tf.stack(tf.meshgrid(x, y), 2);
        // Now call the sampling web worker
        callSamplingWorkerThread(
            pretrainedModelPaths[$trainingObjective][$datasetName],
            $trainingObjective,
            trainingObjectiveToModelConfig[$trainingObjective],
            get(UIState).numSamples,
            get(UIState).numberOfSteps,
            (allSamples: number[][]) => {
                // Save the samples to the trajectories
                console.log("All samples: ", allSamples);
                trajectories = allSamples;
            }
        )
    });

</script>
