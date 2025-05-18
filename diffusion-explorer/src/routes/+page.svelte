<script lang="ts">
    import * as tf from '@tensorflow/tfjs';
    // import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
    // setWasmPaths('/tfjs-backend-wasm/');
    // import '@tensorflow/tfjs-backend-wasm'; // Import the WebGL backend for TensorFlow.js

    import {base} from '$app/paths';

    import * as d3 from 'd3';

    import { onMount, onDestroy} from 'svelte';
    import { get } from 'svelte/store';
    // Load up the application config
    import { 
        sourceDistributionSamples,
        targetDistributionSamples,
        currentDistributionSamples,
        allTimeSamples,
        isPlaying,
        datasetName,
        trainingObjective,
        numSamples,
        numberOfSteps,
        sampler,
        isTraining,
        epochValue,
        distributionVisiblity,
        intermediateTrainingSamples,
    } from '$lib/state';
    import { 
        trainingObjectiveToModelConfig,
        trainingObjectiveToModelClass,
        datasetNameToPath,
        trainingConfig,
        pretrainedModelPaths,
        trainingObjectiveToSamplers,
    } from '$lib/settings';
    // Load up the components
    import TitleBar from '$lib/components/TitleBar.svelte';
    import TimeSlider from '$lib/components/time_slider/TimeSlider.svelte';
    import TrainingBar from '$lib/components/training_bar/TrainingBar.svelte';
    import DisplayArea from '$lib/components/display_area/DisplayArea.svelte';
    import StyleBar from '$lib/components/training_bar/StyleBar.svelte';
    // import Explanation from '$lib/components/Explanation.svelte';
    // Import helper tf functions
    import { sampleMultivariateNormal } from '$lib/diffusion/utils';
    import { callSamplingWorkerThread, callTrainingWorkerThread} from '$lib/diffusion/workers/utils';
    import Distribution from '$lib/components/display_area/Distribution.svelte';

    let trainingInitiated = false; // Flag to check if training has ever been initiated
    let trainingWorker: Worker; // Variable to hold the training worker

    let datasetDict: any = {}; // Dictionary to hold the loaded datasets

    function loadDataset(path: string) {
        path = base + path;
        return fetch(path)
            .then(response => response.json())
            .then(data => {
                // Convert the data to a tensor
                const pointsTensor = tf.tensor(data.points);
                return pointsTensor;
            });
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.code === 'Space') {
            event.preventDefault(); // Prevent page scrolling
            // Toggle the play/pause state
            isPlaying.update(state => !state);
        }
    }

    onMount(async () => {
        // Load up each of the datasets
        let datasets = {}
        for (const [name, path] of Object.entries(datasetNameToPath)) {
            const pointsTensor = await loadDataset(path);
            datasets = { ...datasets, [name]: pointsTensor }; // triggers Svelte reactivity
            // console.log(`Loaded dataset ${name} from ${path}`);
            // console.log(`Dataset ${name} shape: `, pointsTensor.shape);
        }
        datasetDict = datasets;
        // Add a listener to the window to handle keydown events
        window.addEventListener('keydown', handleKeydown);
        // Load up the chosen training dataset points as tf tensor
        const pointsTensor = datasetDict[$datasetName];
        // Update the UI state with the training dataset
        targetDistributionSamples.set(pointsTensor);
        // // Draw some gaussian samples to put into the UI state as well
        const multivariateNormalSamples = sampleMultivariateNormal(
            [0, 0],
            [[1, 0], [0, 1]],
            $numSamples
        );
        // Update the UI state with the source distribution samples
        sourceDistributionSamples.set(multivariateNormalSamples);
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('keydown', handleKeydown);
        }
    });

    // Add handler for if datasetName changes or trainingObjective changes
    $: if (
        $datasetName && 
        datasetDict[$datasetName] &&
        typeof window !== 'undefined' // Makes sure this is not run on the server
    ) {
        // Check that there is a trained model for the given dataset
        if (!pretrainedModelPaths[$trainingObjective][$datasetName]) {
            console.error(`No pretrained model found for ${$trainingObjective} on ${$datasetName}`);
        }
        // Check if the sampler is valid for $trainingObjective and if not set it to a valid default
        // NOTE: This is done here to avoid conflicting with the training objective
        if (!trainingObjectiveToSamplers[$trainingObjective].includes($sampler)) {
            // Set the sampler to the first one in the list
            sampler.set(trainingObjectiveToSamplers[$trainingObjective][0]);
        }
        // Pause the animation
        isPlaying.set(false);
        // Load the dataset
        const pointsTensor = datasetDict[$datasetName];
        // Update the UI state with the training dataset
        targetDistributionSamples.set(pointsTensor);
        // Immediately remove the currentDistributionSamples
        currentDistributionSamples.set(tf.zeros([0, 2]));
        // Load up the model corresponding to the dataset
        const defaultTrainingObjective = $trainingObjective;
        const defaultModelPath = base + pretrainedModelPaths[$trainingObjective][$datasetName];
        // Regenerate all of the samples 
        callSamplingWorkerThread(
            defaultModelPath,
            defaultTrainingObjective,
            trainingObjectiveToModelConfig[defaultTrainingObjective],
            get(numSamples),
            get(numberOfSteps),
            (allSamples) => {
                // Convert all samples to tf tensor
                allSamples = tf.tensor(allSamples);
                // Update the UI state with the all time samples
                allTimeSamples.set(allSamples);
                // Compute the range of the points to use for the domain of each contour map
                let flatAllTimeSamples = tf.reshape(allSamples, [get(numSamples) * get(numberOfSteps), 2]); // shape [num_time_steps * num_samples, dim]
                flatAllTimeSamples = flatAllTimeSamples.arraySync();
                const xMin = d3.min(flatAllTimeSamples, d => d[0]);
                const xMax = d3.max(flatAllTimeSamples, d => d[0]);
                const yMin = d3.min(flatAllTimeSamples, d => d[1]);
                const yMax = d3.max(flatAllTimeSamples, d => d[1]);
                const localDomainRange = {
                    xMin: xMin - 0.08 * (xMax - xMin),
                    xMax: xMax + 0.08 * (xMax - xMin),
                    yMin: yMin - 0.08 * (yMax - yMin),
                    yMax: yMax + 0.08 * (yMax - yMin),
                };
                // TODO fix this logic
                // domainRange.set(localDomainRange);
                // Make the UI state play
                isPlaying.set(true);
            }
        )
    }

    // Add a handler for when training is running
    $ : if ($isTraining) {
        trainingInitiated = true; // Set the flag to true
        // Hide the source and current distributions
        distributionVisiblity.set({
            current: false,
            source: false,
            training: true,
            target: true,
        });
        // Pause the playing animation
        isPlaying.set(false);
        // Get the model config and class
        const ModelClass = trainingObjectiveToModelClass[$trainingObjective];
        const modelConfig = trainingObjectiveToModelConfig[$trainingObjective];
        // Call the training worker thread
        trainingWorker = callTrainingWorkerThread(
            $trainingObjective,
            modelConfig,
            base + datasetNameToPath[$datasetName],
            trainingConfig,
            // Callback for when training is done
            (tfModelPath: string) => {
                // Make the model
                const ourModel = new ModelClass(
                    modelConfig.dim,
                    modelConfig.hidden,
                );
                // Load up a model from the given file path
                tf.loadLayersModel(tfModelPath).then((tfModel) => {
                    // console.log("Downloading model from: ", tfModelPath);
                    // Set the model in the model class
                    // ourModel.setModel(tfModel);
                    // Prompt to download the model
                    // ourModel.download();
                });
            },
            // Callback for after each epoch
            (epoch: number, intermediateSamples: number[][]) => {
                // Update the epoch value
                epochValue.set(epoch);
                // Convert the intermediate samples to a tensor
                if (intermediateSamples != null) {
                    intermediateSamples = tf.tensor(intermediateSamples);
                    intermediateTrainingSamples.set(intermediateSamples);
                } 
                // lossValue.set(loss);
                // Update the UI state with the current distribution samples
                // const pointsTensor = datasetDict[$datasetName];
                // const currentSamples = pointsTensor.slice([0, 0], [get(numSamples), 2]);
                // currentDistributionSamples.set(currentSamples);
            }
        );
    }
    // If training stopped, then stop the training thread
    // Becuase it is stopped by default, we need to check if training was ever initiated by the user
    $: if (!$isTraining && trainingInitiated && trainingWorker) {
        // Stop the training thread by posting a "stop_training" message.
        trainingWorker.postMessage({ type: 'stop_training' });
        // Hide the training distribution and unhide the source and current distributions
        distributionVisiblity.set({
            current: true,
            source: true,
            training: false,
            target: true,
        });
    }

</script>

<style>

    .container {
        position: relative;
    }

    .main-area {
        width: 100%;
        height: var(--main-area-height);
        background-color: white;
        display: flex;
        justify-content: center;
        overflow: hidden;
        position: relative;
    }

    .footer {
        height: 10px;
        position: relative;
        box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.2); /* upward shadow */
    }

    @media (max-width: 1100px) {
        .main-area {
            height: auto;
            padding-top: 20px;
        }
    }

</style>

<div class="container">
    <TitleBar/>
    <TrainingBar datasetDict={datasetDict}/>
    <div class="main-area">
        <!-- <DatasetMenu datasetDict={datasetDict}/> -->
        <!-- <StyleBar/> -->
        <DisplayArea/>
        <!-- </div> -->
    </div>
    <TimeSlider /> 
    <div class="footer"></div>
</div>