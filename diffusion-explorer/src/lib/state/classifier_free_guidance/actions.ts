/*
*  Handles logic for switching between global application states. 
*/

import * as settings from '$lib/settings';
import { base } from '$app/paths';
import { get } from 'svelte/store';
import * as tf from '@tensorflow/tfjs';

// Helper functions
import { sampleMultivariateNormal } from '$lib/diffusion/utils';
import { convertDataToDisplayCoordinateFrame, convertDisplayCoordinateFrameToData } from '$lib/utils';
import { callTrainingWorkerThread, callSamplingWorkerThread, callSamplingWorkerThreadGrid } from '$lib/diffusion/workers/utils';
import { downloadJSON } from '$lib/utils';

/**
 * Factory function that takes a state object and returns handlers bound to that state.
 */
export function createCFGStateHandlers(cfgState: any) {
    const {
        datasetDict,
        datasetName,
        numSamples,
        sourceDistributionSamples,
        currentDistributionSamples,
        targetDistributionSamples,
        trainingObjective,
        sampler,
        numberOfSteps,
        isPlaying,
        usePretrained,
        allTimeSamples,
        allTimeGridSamples,
        isTraining
    } = cfgState;

    /*
    * This function handles loading up the pre-defined datasets into 
    * state. 
    */
    async function loadDatasets() {
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
        const datasets: Record<string, any> = {};
        for (const [name, path] of Object.entries(datasetNameToPath)) {
            datasets[name] = await loadDataset(path);
        }
        datasetDict.set(datasets);
    }

    /* 
    * Initialize the initial distributions based on initial dataset
    */ 
    async function initializeDistributions() {
        const datasetDictVal = get(datasetDict) as Record<string, any>;
        console.log(datasetDictVal);
        const datasetNameVal = get(datasetName) as string;
        const numSamplesVal = get(numSamples) as number;
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
    async function handleDatasetChange() {
        const trainingObjectiveVal = get(trainingObjective) as string;
        const datasetNameVal = get(datasetName) as string;
        const datasetDictVal = get(datasetDict) as Record<string, any>;
        const samplerVal = get(sampler) as string;
        const numberOfStepsVal = get(numberOfSteps) as number;
        const gridResolution = settings.meshPlotSettings.gridResolution;
        // Pause the animation
        isPlaying.set(false);
        // Check that there is a trained model for the given dataset
        if (!settings.pretrainedModelPaths[trainingObjectiveVal][datasetNameVal]) {
            // If there is no model, switch pretrained to false
            console.error("No pretrained model available for the selected dataset and training objective: ", trainingObjectiveVal, datasetNameVal);
        }
        // Check if the sampler is valid for $trainingObjective and if not set it to a valid default
        // NOTE: This is done here to avoid conflicting with the training objective
        if (!settings.trainingObjectiveToSamplers[trainingObjectiveVal].includes(samplerVal)) {
            // Set the sampler to the first one in the list
            sampler.set(settings.trainingObjectiveToSamplers[trainingObjectiveVal][0]);
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
                (allSamples: any) => {
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
    * This function handles the logic for starting the training process.
    */
    function runTraining() {
        // Load up the dataset and save it in a temp-file
        let jsonURL: string | null = null;
        const datasetNameVal = get(datasetName) as string;
        const datasetNameToPath = settings.datasetNameToPath;
        // Pull out the appropriate model config 
        const trainingObjectiveVal = get(trainingObjective) as string;
        const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];
        // Call the training worker thread
        const trainingWorker: Worker = callTrainingWorkerThread(
            trainingObjectiveVal,
            modelConfig,
            jsonURL ? jsonURL : base + datasetNameToPath[datasetNameVal],
            settings.trainingConfig,
            (tfModelPath: string) => {
                // On model save callback
                console.error("Not implemented yet: loading trained model from path ", tfModelPath);
                // TODO: Save the model to a file. 
            },
            // Update the intermediate training samples between epochs
            (epoch: number, intermediateSamples: number[][]) => { /* Do nothing for now */}
        );

        // Return training worker to be used when stopping training
        return trainingWorker;
    }

    return {
        loadDatasets,
        initializeDistributions,
        handleDatasetChange,
        runTraining
    };
}