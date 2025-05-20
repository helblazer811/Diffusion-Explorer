/*
*  Handles logic for switching between global application states. 
*/

import * as settings from '$lib/settings';
import { base } from '$app/paths';
import { get } from 'svelte/store';

// Explicit state imports
import {
    datasetDict,
    datasetName,
    numSamples,
    sourceDistributionSamples,
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
} from '$lib/state';

// Helper functions
import { sampleMultivariateNormal } from '$lib/diffusion/utils';
import { callTrainingWorkerThread, callSamplingWorkerThread } from '$lib/diffusion/workers/utils';
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
* This function handles stoppping or interrupting the training process.
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
    distributionVisiblity.set({ current: false, source: true, training: false, target: true });
    isPlaying.set(false);
    epochValue.set(0);
    // Empty the target distribution samples
    targetDistributionSamples.set([]);
}