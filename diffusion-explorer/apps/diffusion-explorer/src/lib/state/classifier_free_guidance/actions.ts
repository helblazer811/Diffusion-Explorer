/*
*  Handles logic for switching between global application states. 
*/

import * as settings from '$lib/settings';
import { base } from '$app/paths';
import { get } from 'svelte/store';
import * as tf from '@tensorflow/tfjs';

// Helper functions
import { convertDataToDisplayCoordinateFrame, convertDisplayCoordinateFrameToData, downloadJSON } from '$lib/utils';
import {
    sampleMultivariateNormal,
    FlowModelClient,
    DiffusionModelClient
} from '@diffusion-explorer/diffusion';

// Worker URLs (bundled to static/workers/ for production)
const flowModelWorkerUrl = '/workers/flow_model.worker.js';
const diffusionModelWorkerUrl = '/workers/diffusion_model.worker.js';

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
        const datasetNameVal = get(datasetName) as string;
        const datasetNameToPath = settings.datasetNameToPath;
        const datasetPath = base + datasetNameToPath[datasetNameVal];

        // Pull out the appropriate model config
        const trainingObjectiveVal = get(trainingObjective) as string;
        const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];
        console.log("Calling training worker with config: ", modelConfig);

        // Select appropriate client based on training objective
        const workerUrl = trainingObjectiveVal === 'Flow Matching' ? flowModelWorkerUrl : diffusionModelWorkerUrl;
        const client = trainingObjectiveVal === 'Flow Matching'
            ? new FlowModelClient(workerUrl, '', trainingObjectiveVal, modelConfig)
            : new DiffusionModelClient(workerUrl, '', modelConfig);

        // Start training
        const { requestId, promise } = client.train(
            datasetPath,
            settings.trainingConfig,
            (epoch: number, intermediateSamples: number[][] | null, loss: number) => {
                console.log("Epoch: ", epoch);
            }
        );

        // Handle training completion
        promise.then(async (result: { tfModelPath: string }) => {
            const model = await tf.loadLayersModel(result.tfModelPath);
            await model.save("downloads://model");
        }).catch((error: Error) => {
            console.log('Training stopped or failed:', error.message);
        });

        // Return client and requestId for stopping
        return { client, requestId };
    }

    return {
        loadDatasets,
        initializeDistributions,
        runTraining
    };
}