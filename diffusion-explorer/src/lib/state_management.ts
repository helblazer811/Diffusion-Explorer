/*
*  Handles logic for switching between global application states. 
*/

import * as settings from '$lib/settings';
import { base } from '$app/paths';
import { get } from 'svelte/store';

import { downloadJSON } from '$lib/utils'; 
import * as tf from '@tensorflow/tfjs';

// Explicit state imports
import {
    datasetDict,
    datasetName,
    numSamples,
    sourceDistributionSamples,
    currentDistributionSamples,
    targetDistributionSamples,
    intermediateTrainingSamples,
    trainingObjective,
    usePretrained,
    distributionVisiblity,
    isPlaying,
    epochValue,
    numberOfSteps,
    allTimeSamples,
    currentTime,
    cachedModelPaths,
    isTraining,
    sampler,
    allTimeGridSamples
} from '$lib/state';

// Helper functions
import { sampleMultivariateNormal } from '$lib/diffusion/utils';
import { 
    callTrainingWorkerThread, 
    callSamplingWorkerThread,
    callSamplingWorkerThreadGrid
} from '$lib/diffusion/workers/utils';
import { convertDataToDisplayCoordinateFrame, convertDisplayCoordinateFrameToData } from '$lib/utils';

/*
* This function handles loading up the pre-defined datasets into 
* state. 
*/
export async function loadDatasets() {
    // Pull the dataset paths from the settings
    const datasetNameToPath = settings.datasetNameToPath;
    // Helper function to load a dataset
    function loadDataset(path: string) {
        path = base + path;
        return fetch(path)
            .then(response => response.json())
            .then(data => {
                return data.points;
            });
    }
    // Loop through and load the datasets
    const datasets = {};
    for (const [name, path] of Object.entries(datasetNameToPath)) {
        datasets[name] = await loadDataset(path);
    }
    datasetDict.set(datasets);
}

/* 
* Initialize the initial distributions based on initial dataset
*/ 
export async function initializeDistributions() {
    const datasetDictVal = get(datasetDict);
    const datasetNameVal = get(datasetName);
    const numSamplesVal = get(numSamples);
    const interfaceSettings = settings.interfaceSettings;
    const domainRange = settings.domainRange;

    const pointData = datasetDictVal[datasetNameVal];
    const translatedData = convertDataToDisplayCoordinateFrame(
        pointData,
        1.0,
        interfaceSettings.distributionWidth,
        interfaceSettings.displayAreaWidth,
        domainRange
    );
    targetDistributionSamples.set(translatedData);

    const multivariateNormalSamples = sampleMultivariateNormal(
        [0, 0],
        [[1, 0], [0, 1]],
        numSamplesVal
    );
    const multivariateNormalSamplesArray = multivariateNormalSamples.arraySync() as number[][];
    const translatedSamples = convertDataToDisplayCoordinateFrame(
        multivariateNormalSamplesArray,
        0.0,
        interfaceSettings.distributionWidth,
        interfaceSettings.displayAreaWidth,
        domainRange
    );
    sourceDistributionSamples.set(translatedSamples);
}

/*
* Handle the event that the dataset has changed. 
* NOTE: This function is also called on applicaiton load. 
*/
export async function handleDatasetChange() {
    const trainingObjectiveVal = get(trainingObjective);
    const datasetNameVal = get(datasetName);
    const datasetDictVal = get(datasetDict);
    const samplerVal = get(sampler);
    const numberOfStepsVal = get(numberOfSteps);
    const gridResolution = settings.meshPlotSettings.gridResolution;
    // Pause the animation
    isPlaying.set(false);
    // Set epoch to 0
    epochValue.set(0);
    // If training is in progress, then send a stop training event
    if (get(isTraining)) {
        isTraining.set(false);
    }
    // Check that there is a trained model for the given dataset
    if (!settings.pretrainedModelPaths[trainingObjectiveVal][datasetNameVal]) {
        // If there is no model, switch pretrained to false
        usePretrained.set(false);
    }
    // Check if the sampler is valid for $trainingObjective and if not set it to a valid default
    // NOTE: This is done here to avoid conflicting with the training objective
    if (!settings.trainingObjectiveToSamplers[trainingObjectiveVal].includes(samplerVal)) {
        // Set the sampler to the first one in the list
        sampler.set(settings.trainingObjectiveToSamplers[$trainingObjective][0]);
    }
    // Load the dataset
    const pointsData = datasetDictVal[datasetNameVal];
    // Convert the points to the correct coordinate frame
    const translatedData = convertDataToDisplayCoordinateFrame(
        pointsData,
        1.0, // Time of target distribution
        settings.interfaceSettings.distributionWidth,
        settings.interfaceSettings.displayAreaWidth,
        settings.domainRange
    );
    // Update the UI state with the training dataset
    targetDistributionSamples.set(translatedData);
    // Immediately remove the currentDistributionSamples
    currentDistributionSamples.set([[]]);
    // Check if there are cached samples for the given dataset and model
    if (
        settings.cachedSamplesPaths[trainingObjectiveVal] &&
        settings.cachedSamplesPaths[trainingObjectiveVal][datasetNameVal]
    ) {
        // Load the cached samples
        const cachedSamplesPath = base + settings.cachedSamplesPaths[trainingObjectiveVal][datasetNameVal];
        fetch(cachedSamplesPath)
            .then(response => response.json())
            .then(data => {
                // Update the UI state with the cached samples
                allTimeSamples.set(data);
                // Load the cached grid samples
                const cachedGridSamplesPath = base + settings.cachedGridSamplesPaths[trainingObjectiveVal][datasetNameVal];
                fetch(cachedGridSamplesPath)
                    .then(response => response.json())
                    .then(data => {
                        // Update the UI state with the cached samples
                        allTimeGridSamples.set(data);
                        // Start playing if not already training
                        if (!get(isTraining)) {
                            isPlaying.set(true);
                        }
                    });
            });
    } else {
        // Load up the model corresponding to the dataset
        const defaultTrainingObjective = trainingObjectiveVal;
        const defaultModelPath = base + settings.pretrainedModelPaths[trainingObjectiveVal][datasetNameVal];
        // Regenerate all of the samples 
        callSamplingWorkerThread(
            defaultModelPath,
            defaultTrainingObjective,
            settings.trainingObjectiveToModelConfig[defaultTrainingObjective],
            get(numSamples),
            get(numberOfSteps),
            settings.domainRange,
            settings.interfaceSettings.distributionWidth,
            settings.interfaceSettings.displayAreaWidth,
            // Callback for when the sampling is done
            (allSamples) => {
                // Update the UI state with the all time samples
                allTimeSamples.set(allSamples);
                // Make the UI state play
                if (!get(isTraining)) {
                    isPlaying.set(true);
                }
                // Download the samples as json 
                if (settings.downloadSamplesIfNotCached) {
                    downloadJSON(allSamples, `${datasetNameVal}_${trainingObjectiveVal}_samples.json`);
                }
            }
        )
        // Also do a sampling gird for PathPlot and MeshPlot
        callSamplingWorkerThreadGrid(
            defaultModelPath,
            trainingObjectiveVal,
            settings.trainingObjectiveToModelConfig[trainingObjectiveVal],
            gridResolution,
            numberOfStepsVal,
            settings.domainRange,
            settings.interfaceSettings.distributionWidth,
            settings.interfaceSettings.displayAreaWidth,
            (allSamples: number[][]) => {
                let allSamplesTensor = tf.tensor(allSamples);
                // Reshape the samples to be [time, x, y, 2]
                allSamplesTensor = allSamplesTensor.reshape([numberOfStepsVal, gridResolution, gridResolution, 2]);
                // Save the samples to the trajectory grid
                const trajectoryGrid = allSamplesTensor.arraySync() as number[][][];
                // Update the UI state with the trajectory grid
                allTimeGridSamples.set(trajectoryGrid);
                // Download the samples as json 
                if (settings.downloadSamplesIfNotCached) {
                    downloadJSON(trajectoryGrid, `${datasetNameVal}_${trainingObjectiveVal}_grid.json`);
                }
            }
        )
    }
}

/*
* This function handles when model training is finished.
*/
export async function finishTraining(
    tfModelPath: string,
    trainingObjectiveVal: string,
    datasetNameVal: string,
    modelConfig: object,
    jsonURL: string | null = null
) {
    // Remove the dataset temp file if it exists
    if (jsonURL) URL.revokeObjectURL(jsonURL);
    // Save the model in the cache
    cachedModelPaths.update((cache) => {
        return {
            ...cache,
            [trainingObjectiveVal]: {
                ...cache[trainingObjectiveVal],
                [datasetNameVal]: tfModelPath,
            }
        };
    });
    
    // Run sampling from the model
    callSamplingWorkerThread(
        tfModelPath,
        trainingObjectiveVal,
        modelConfig,
        get(numSamples),
        get(numberOfSteps),
        settings.domainRange,
        settings.interfaceSettings.distributionWidth,
        settings.interfaceSettings.displayAreaWidth,
        (allSamples) => {
            // When sampling is done, then update the UI and start playing at zero. 
            allTimeSamples.set(allSamples);
            distributionVisiblity.set({ current: true, source: true, training: false, target: true });
            isPlaying.set(true);
            currentTime.set(0);
        }
    );
    // Also do a sampling gird for PathPlot and MeshPlot
    const gridResolution = settings.meshPlotSettings.gridResolution;
    callSamplingWorkerThreadGrid(
        tfModelPath,
        trainingObjectiveVal,
        settings.trainingObjectiveToModelConfig[trainingObjectiveVal],
        gridResolution,
        get(numberOfSteps),
        settings.domainRange,
        settings.interfaceSettings.distributionWidth,
        settings.interfaceSettings.displayAreaWidth,
        (allSamples: number[][]) => {
            let allSamplesTensor = tf.tensor(allSamples);
            // Reshape the samples to be [time, x, y, 2]
            allSamplesTensor = allSamplesTensor.reshape([get(numberOfSteps), gridResolution, gridResolution, 2]);
            // Save the samples to the trajectory grid
            const trajectoryGrid = allSamplesTensor.arraySync() as number[][][];
            // Update the UI state with the trajectory grid
            allTimeGridSamples.set(trajectoryGrid);
        }
    )
}

/*
* This function handles the logic for starting the training process.
*/
export function startTraining() {
    // Switch to not using pre existing model cause we are training
    if (get(usePretrained)) {
        usePretrained.set(false);
    }
    // Change the desired UI state settings
    distributionVisiblity.set({ current: false, source: false, training: true, target: true });
    isPlaying.set(false);
    epochValue.set(0);
    // Initialize the UI with random samples before training
    const randomSamples = sampleMultivariateNormal([0, 0], [[1, 0], [0, 1]], get(numSamples));
    const randomSamplesArray = randomSamples.arraySync() as number[][];
    const translatedSamples = convertDataToDisplayCoordinateFrame(
        randomSamplesArray,
        1.0,
        settings.interfaceSettings.distributionWidth,
        settings.interfaceSettings.displayAreaWidth,
        settings.domainRange
    );
    intermediateTrainingSamples.set(translatedSamples);
    // Load up the dataset and save it in a temp-file
    let jsonURL: string | null = null;
    const datasetNameVal = get(datasetName);
    const datasetNameToPath = settings.datasetNameToPath;
    if (datasetNameVal === "brush") {
        // Convert the data to the data coordinate frame
        const translatedSamples = convertDisplayCoordinateFrameToData(
            get(targetDistributionSamples),
            1.0,
            settings.interfaceSettings.distributionWidth,
            settings.interfaceSettings.displayAreaWidth,
            settings.domainRange
        );
        // Create a blob from the data
        const blob = new Blob([
            JSON.stringify({ points: translatedSamples })
        ], { type: 'application/json' });
        jsonURL = URL.createObjectURL(blob);
    }
    // Pull out the appropriate model config 
    const trainingObjectiveVal = get(trainingObjective);
    const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];
    // Call the training worker thread
    const trainingWorker: Worker = callTrainingWorkerThread(
        trainingObjectiveVal,
        modelConfig,
        jsonURL ? jsonURL : base + datasetNameToPath[datasetNameVal],
        settings.trainingConfig,
        (tfModelPath: string) => {
            finishTraining(
                tfModelPath, 
                trainingObjectiveVal, 
                datasetNameVal, 
                modelConfig, 
                jsonURL
            );
        },
        // Update the intermediate training samples between epochs
        (epoch: number, intermediateSamples: number[][]) => { 
            epochValue.set(epoch);
            if (intermediateSamples != null) {
                const translatedSamples = convertDataToDisplayCoordinateFrame(
                    intermediateSamples,
                    1.0,
                    settings.interfaceSettings.distributionWidth,
                    settings.interfaceSettings.displayAreaWidth,
                    settings.domainRange
                );
                intermediateTrainingSamples.set(translatedSamples);
            }
        }
    );

    // Return training worker to be used when stopping training
    return trainingWorker;
}

/*
* This function handles stopping or interrupting the training process.
*/
export async function stopTraining(trainingWorker: Worker) {
    // Stop the training thread by posting a "stop_training" message.
    trainingWorker.postMessage({ type: 'stop_training' });
}

/*
* This function handles when the user wnats to draw a new distribution.
*/
export function startEditing() {
    // Set the state to editing
    distributionVisiblity.set({ current: false, source: false, training: false, target: true });
    isPlaying.set(false);
    epochValue.set(0);
    // Empty the target distribution samples
    targetDistributionSamples.set([]);
}

export function stopEditing() {
    // Do nothing for now. 
}

/* 
* Handle when the user clicks usePretrained
*/
export function handleUsePretrained() {
    // For now just run the dataset change function
    handleDatasetChange();
}