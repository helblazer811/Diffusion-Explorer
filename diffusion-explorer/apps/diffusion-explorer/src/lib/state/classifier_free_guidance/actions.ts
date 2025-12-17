/*
*  Handles logic for switching between global application states. 
*/

import * as settings from '$lib/settings';
import { base } from '$app/paths';
import { get } from 'svelte/store';
import * as tf from '@tensorflow/tfjs';

// Helper functions
import { convertDataToDisplayCoordinateFrame, convertDisplayCoordinateFrameToData } from '$lib/utils';
import { sampleMultivariateNormal, callTrainingWorkerThread, callSamplingWorkerThread, callSamplingWorkerThreadGrid } from '$lib/diffusion';
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
        console.log("Calling training worker with config: ", modelConfig);
        // Call the training worker thread
        const trainingWorker: Worker = callTrainingWorkerThread(
            trainingObjectiveVal,
            modelConfig,
            jsonURL ? jsonURL : base + datasetNameToPath[datasetNameVal],
            settings.trainingConfig,
            async (tfModelPath: string) => {
                // On model save callback
                // console.error("Not implemented yet: loading trained model from path ", tfModelPath);
                // // TODO: Save the model to a file. 
                const model = await tf.loadLayersModel(tfModelPath);
                await model.save("downloads://model");
                // console.log(model)
                // await model.save('downloads://trained_model');
            },
            // Update the intermediate training samples between epochs
            (epoch: number, intermediateSamples: number[][]) => { 
                console.log("Epoch: ", epoch);
            }
        );

        // Return training worker to be used when stopping training
        return trainingWorker;
    }

    return {
        loadDatasets,
        initializeDistributions,
        runTraining
    };
}