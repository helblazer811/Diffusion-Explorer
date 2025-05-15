<script lang="ts">
    import * as tf from '@tensorflow/tfjs';
    // import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
    // setWasmPaths('/tfjs-backend-wasm/');
    // import '@tensorflow/tfjs-backend-wasm'; // Import the WebGL backend for TensorFlow.js

    import * as d3 from 'd3';

    import { onMount, onDestroy} from 'svelte';
    import { get } from 'svelte/store';
    // Load up the application config
    import { 
        pretrainedModelPaths, 
        trainingObjectiveToModelClass, 
        datasetNameToPath, 
        trainingConfig, 
        sourceDistributionSamples,
        targetDistributionSamples,
        currentDistributionSamples,
        allTimeSamples,
        isPlaying,
        datasetName,
        domainRange,
        trainingObjective,

        trainingObjectiveToModelConfig

    } from '$lib/state';
    // Load up the application state
    import { UIState, model } from '$lib/state';
    // Load up the components
    import TitleBar from '$lib/components/TitleBar.svelte';
    import TimeSlider from '$lib/components/time_slider/TimeSlider.svelte';
    import TrainingBar from '$lib/components/training_bar/TrainingBar.svelte';
    import DisplayArea from '$lib/components/display_area/DisplayArea.svelte';
    // import Explanation from '$lib/components/Explanation.svelte';
    // Import helper tf functions
    import { sampleMultivariateNormal } from '$lib/diffusion/utils';
    import { callSamplingWorkerThread } from '$lib/diffusion/workers/utils';

    export let trainModel: boolean = false; // Flag to indicate if the model is being trained

    let datasetDict: any = {}; // Dictionary to hold the loaded datasets

    function loadDataset(path: string) {
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

    async function loadModel(modelJSONPath: string) {
        const model = await tf.loadLayersModel(modelJSONPath);
        return model;
    }

    onMount(async () => {
        // Load the UI state
        const readonlyUIState = get(UIState);
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
            readonlyUIState.numSamples
        );
        // Update the UI state with the source distribution samples
        sourceDistributionSamples.set(multivariateNormalSamples);
        // Create a worker for training the model 
        const trainingWorker = new Worker(
            new URL('$lib/diffusion/workers/train_worker.ts', import.meta.url),
            { type: 'module' }
        );
        // Add a listener to the training worker thread to receive the model
        trainingWorker.onmessage = async (e) => {
            const { type, result: res } = e.data;
            if (type === 'result') {
                // Get the model path 
                const tfModelPath = e.data.tfModelPath;
                // Make the model
                const ModelClass = trainingObjectiveToModelClass[$trainingObjective];
                const modelConfig = trainingObjectiveToModelConfig[$trainingObjective];
                const ourModel = new ModelClass(
                    modelConfig.dim,
                    modelConfig.hidden,
                );
                // Load up a model from the given file path
                const tfModel = await tf.loadLayersModel(tfModelPath);
                // // Set the model in the model class
                ourModel.setModel(tfModel);
                // Prompt to download the model
                ourModel.download();
            } else if (type === 'status') {
                console.log('Worker status:', e.data.message);
            } else if (type === 'error') {
                console.error('Worker error:', e.data.message);
            }
        };
        // Call the training worker thread
        if (false) {
            console.log("Calling the worker thread to train...");
            trainingWorker.postMessage({
                type: 'train',
                data: {
                    trainingObjective: $trainingObjective,
                    modelConfig: modelConfig[$trainingObjective],
                    datasetPath: datasetNameToPath[$datasetName],
                    trainingConfig: {
                        iterations: trainingConfig["iterations"],
                        batchSize: trainingConfig["batchSize"],
                    },
                }
            });
        }
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('keydown', handleKeydown);
        }
    });

    // Add handler for if datasetName changes
    $: if (
        $datasetName && 
        datasetDict[$datasetName] &&
        pretrainedModelPaths[$trainingObjective]?.[$datasetName] &&
        typeof window !== 'undefined'
    ) {
        // NOTE: typof window !== 'undefined' is to prevent SSR errors
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
        const defaultModelPath = pretrainedModelPaths[$trainingObjective][$datasetName];
        // // Load the model
        // loadModel(defaultModelPath).then((loadedModel) => {
        //     // Set the model in the UI state
        //     model.set(loadedModel);
        // });
        // Regenerate all of the samples 
        callSamplingWorkerThread(
            defaultModelPath,
            defaultTrainingObjective,
            trainingObjectiveToModelConfig[defaultTrainingObjective],
            get(UIState).numSamples,
            get(UIState).numberOfSteps,
            (allSamples) => {
                // Convert all samples to tf tensor
                allSamples = tf.tensor(allSamples);
                // Update the UI state with the all time samples
                allTimeSamples.set(allSamples);
                // Compute the range of the points to use for the domain of each contour map
                let flatAllTimeSamples = tf.reshape(allSamples, [get(UIState).numSamples * get(UIState).numberOfSteps, 2]); // shape [num_time_steps * num_samples, dim]
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

</script>

<style>

    .container {
        position: relative;
    }

    .main-area {
        /* width: 100%;
        background-color: white;
        display: flex;
        flex-direction: row;
        justify-content: center;
        z-index: -1; */
        /* z-index: 3; */
        width: 100%;
        height: var(--main-area-height);
        background-color: white;
        display: flex;
        justify-content: center;
        overflow: hidden;
        /* display: flex; */
    }

    /* .display-area-container {
        position: relative;
        margin: 0 auto;
        max-width: var(--display-area-width);
    }
     */

    /* .dataset-menu-container {
        top: 50px;
        height: 100%;
        position: absolute;
        left: 0;
    } */

    .footer {
        height: 10px;
        /* z-index: 1; */
        position: relative;
        bottom: 10px;
        /* box-shadow: rgba(0, 0, 0, 0.8) 0px -2px -4px 0px; */
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