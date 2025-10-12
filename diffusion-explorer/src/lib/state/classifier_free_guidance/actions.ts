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
} from '$lib/state/main/state';

// Helper functions
import { sampleMultivariateNormal } from '$lib/diffusion/utils';
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