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
        currentTime,
        cachedModelPaths,
        domainRange
    } from '$lib/state';
    import { 
        trainingObjectiveToModelConfig,
        trainingObjectiveToModelClass,
        datasetNameToPath,
        trainingConfig,
        pretrainedModelPaths,
        trainingObjectiveToSamplers,
        cachedSamplesPaths,
        interfaceSettings,
    } from '$lib/settings';
    // Load up the components
    import TitleBar from '$lib/components/TitleBar.svelte';
    import TimeSlider from '$lib/components/time_slider/TimeSlider.svelte';
    import TrainingBar from '$lib/components/training_bar/TrainingBar.svelte';
    import DisplayArea from '$lib/components/display_area/DisplayArea.svelte';
    // import Explanation from '$lib/components/Explanation.svelte';
    // Import helper tf functions
    import { sampleMultivariateNormal } from '$lib/diffusion/utils';
    import { callSamplingWorkerThread, callTrainingWorkerThread} from '$lib/diffusion/workers/utils';
    import { convertDataToDisplayCoordinateFrame } from '$lib/components/display_area/plots/utils';

    let trainingInitiated = false; // Flag to check if training has ever been initiated
    let trainingWorker: Worker; // Variable to hold the training worker

    let datasetDict: any = {}; // Dictionary to hold the loaded datasets

    function loadDataset(path: string) {
        path = base + path;
        return fetch(path)
            .then(response => response.json())
            .then(data => {
                // Convert the data to a tensor
                // const pointsTensor = tf.tensor(data.points);
                return data.points;
            });
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.code === 'Space') {
            event.preventDefault(); // Prevent page scrolling
            // Toggle the play/pause state
            isPlaying.update(state => !state);
        }
    }

    function downloadJSON(data, filename = 'data.json') {
        const jsonStr = JSON.stringify(data, null, 2); // pretty-print
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();

        URL.revokeObjectURL(url); // Clean up
    }

    onMount(async () => {
        // Load up each of the datasets
        let datasets = {}
        for (const [name, path] of Object.entries(datasetNameToPath)) {
            const pointData = await loadDataset(path);
            datasets = { ...datasets, [name]: pointData }; // triggers Svelte reactivity
            // console.log(`Loaded dataset ${name} from ${path}`);
            // console.log(`Dataset ${name} shape: `, pointsTensor.shape);
        }
        datasetDict = datasets;
        // Add a listener to the window to handle keydown events
        window.addEventListener('keydown', handleKeydown);
        // Load up the chosen training dataset points as tf tensor
        const pointData = datasetDict[$datasetName];
        // Convert the points to the correct coordinate frame
        const translatedData = convertDataToDisplayCoordinateFrame(
            pointData,
            1.0, // Time of target distribution
            interfaceSettings.distributionWidth,
            interfaceSettings.displayAreaWidth,
            get(domainRange)
        );
        // Update the UI state with the training dataset
        targetDistributionSamples.set(translatedData);
        // // Draw some gaussian samples to put into the UI state as well
        const multivariateNormalSamples = sampleMultivariateNormal(
            [0, 0],
            [[1, 0], [0, 1]],
            $numSamples
        );
        // Convert to array
        const multivariateNormalSamplesArray = multivariateNormalSamples.arraySync() as number[][];
        // Convert the points to the correct coordinate frame
        const translatedSamples = convertDataToDisplayCoordinateFrame(
            multivariateNormalSamplesArray,
            0.0, // Time of source distribution
            interfaceSettings.distributionWidth,
            interfaceSettings.displayAreaWidth,
            get(domainRange)
        );
        // Update the UI state with the source distribution samples
        sourceDistributionSamples.set(translatedSamples);
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
        console.log("Loading dataset: ", $datasetName);
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
        const pointsData = datasetDict[$datasetName];
        // Convert the points to the correct coordinate frame
        const translatedData = convertDataToDisplayCoordinateFrame(
            pointsData,
            1.0, // Time of target distribution
            interfaceSettings.distributionWidth,
            interfaceSettings.displayAreaWidth,
            get(domainRange)
        );
        // Update the UI state with the training dataset
        targetDistributionSamples.set(translatedData);
        // Immediately remove the currentDistributionSamples
        currentDistributionSamples.set([[]]);
        // Check if there are cached samples for the given dataset and model
        if (cachedSamplesPaths[$trainingObjective] && cachedSamplesPaths[$trainingObjective][$datasetName]) {
            // Load the cached samples
            // concole log time when start loading
            const cachedSamplesPath = base + cachedSamplesPaths[$trainingObjective][$datasetName];
            fetch(cachedSamplesPath)
                .then(response => response.json())
                .then(data => {
                    // Update the UI state with the cached samples
                    allTimeSamples.set(data);
                    // Start playing
                    isPlaying.set(true);
                    // console log time when done loading
                });
        } else {
            // Load up the model corresponding to the dataset
            const defaultTrainingObjective = $trainingObjective;
            const defaultModelPath = base + pretrainedModelPaths[$trainingObjective][$datasetName];
            // Regenerate all of the samples 
            console.log("Calling sampling worker thread");
            callSamplingWorkerThread(
                defaultModelPath,
                defaultTrainingObjective,
                trainingObjectiveToModelConfig[defaultTrainingObjective],
                get(numSamples),
                get(numberOfSteps),
                get(domainRange),
                interfaceSettings.distributionWidth,
                interfaceSettings.displayAreaWidth,
                // Callback for when the sampling is done
                (allSamples) => {
                    // Update the UI state with the all time samples
                    allTimeSamples.set(allSamples);
                    // Make the UI state play
                    isPlaying.set(true);
                    // Download the samples as json 
                    downloadJSON(allSamples, `${$datasetName}_${$trainingObjective}_samples.json`);
                }
            )
        }
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
        // Set epoch value to 0
        epochValue.set(0);
        // Get the model config and class
        const ModelClass = trainingObjectiveToModelClass[$trainingObjective];
        const modelConfig = trainingObjectiveToModelConfig[$trainingObjective];
        // Fill up the intermediate training samples with some random samples
        const randomSamples = sampleMultivariateNormal(
            [0, 0],
            [[1, 0], [0, 1]],
            get(numSamples)
        );
        intermediateTrainingSamples.set(randomSamples);
        // Call the training worker thread
        trainingWorker = callTrainingWorkerThread(
            $trainingObjective,
            modelConfig,
            base + datasetNameToPath[$datasetName],
            trainingConfig,
            // Callback for when training is done
            (tfModelPath: string) => {
                // Save the path to the model in the state
                cachedModelPaths.update(
                    (cachedModelPaths) => {
                        return {
                            ...cachedModelPaths,
                            [$trainingObjective]: {
                                ...cachedModelPaths[$trainingObjective],
                                [$datasetName]: tfModelPath,
                            }
                        }
                    }
                )
                // TODO: decide if I load it from the browser database or state later
                // Load up a model from the given file path and save it in state
                // tf.loadLayersModel(tfModelPath).then((tfModel) => {
                //     // Save the tfModel in state
                //     // cachedModels.update(
                //     //     (cachedModels) => {
                //     //         return {
                //     //             ...cachedModels,
                //     //             [$trainingObjective]: {
                //     //                 ...cachedModels[$trainingObjective],
                //     //                 [$datasetName]: tfModel,
                //     //             }
                //     //         }
                //     //     }
                //     // )
                //     // console.log("Downloading model from: ", tfModelPath);
                //     // Prompt to download the model
                //     // ourModel.download();
                // });
                // Run sampling with the saved model 
                callSamplingWorkerThread(
                    tfModelPath,
                    $trainingObjective,
                    modelConfig,
                    get(numSamples),
                    get(numberOfSteps),
                    (allSamples) => {
                        // Convert all samples to tf tensor
                        allSamples = tf.tensor(allSamples);
                        // Update the UI state with the all time samples
                        allTimeSamples.set(allSamples);
                    }
                );
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
        // Set the timer to zero, and set playing to true
        isPlaying.set(true);
        currentTime.set(0);
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
        <DisplayArea/>
        <!-- </div> -->
    </div>
    <TimeSlider /> 
    <div class="footer"></div>
</div>