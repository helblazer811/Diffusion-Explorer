/*
 * MainStateHandler.ts
 * Handles logic for switching and updating global application state.
 */

import * as settings from '$lib/settings';
import { base } from '$app/paths';
import { get } from 'svelte/store';
import { downloadJSON } from '$lib/utils'; 
import * as tf from '@tensorflow/tfjs';
import { convertDataToDisplayCoordinateFrame, convertDisplayCoordinateFrameToData } from '$lib/utils';

import {sampleMultivariateNormal, callTrainingWorkerThread, callSamplingWorkerThread, callSamplingWorkerThreadGrid} from '$lib/diffusion';

/**
 * Factory function that takes a MainState object and returns handlers bound to that state.
 */
export function createMainStateHandlers(MainState: any) {
    const {
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
    } = MainState;

    /* Load all datasets into the state */
    async function loadDatasets() {
        const datasetNameToPath = settings.datasetNameToPath;

        async function loadDataset(path: string) {
            path = base + path;
            const response = await fetch(path);
            const data = await response.json();
            return data.points;
        }

        const datasets: Record<string, any> = {};
        for (const [name, path] of Object.entries(datasetNameToPath)) {
            datasets[name] = await loadDataset(path);
        }
        datasetDict.set(datasets);
    }

    /* Initialize distributions from the current dataset */
    async function initializeDistributions() {
        const datasetDictVal = get(datasetDict);
        const datasetNameVal = get(datasetName);
        const numSamplesVal = get(numSamples);
        const interfaceSettings = settings.interfaceSettings;
        const domainRange = settings.domainRange;

        if (!(datasetNameVal in datasetDictVal)) {
            throw new Error(`Dataset name ${datasetNameVal} not found in dataset dictionary`);
        }   
        const pointData = datasetDictVal[datasetNameVal];
        if (!pointData) {
            throw new Error(`No data found for dataset ${datasetNameVal}`);
        }
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

    /* Handle dataset change */
    async function handleDatasetChange() {
        const trainingObjectiveVal = get(trainingObjective);
        const datasetNameVal = get(datasetName);
        const datasetDictVal = get(datasetDict);
        const samplerVal = get(sampler);
        const numberOfStepsVal = get(numberOfSteps);
        const gridResolution = settings.meshPlotSettings.gridResolution;

        isPlaying.set(false);
        epochValue.set(0);
        if (get(isTraining)) isTraining.set(false);

        if (!settings.pretrainedModelPaths[trainingObjectiveVal]?.[datasetNameVal]) {
            usePretrained.set(false);
        }

        if (!settings.trainingObjectiveToSamplers[trainingObjectiveVal].includes(samplerVal)) {
            sampler.set(settings.trainingObjectiveToSamplers[trainingObjectiveVal][0]);
        }
        if (!(datasetNameVal in datasetDictVal)) {
            throw new Error(`Dataset name ${datasetNameVal} not found in dataset dictionary`);
        }
        const pointsData = datasetDictVal[datasetNameVal];
        const translatedData = convertDataToDisplayCoordinateFrame(
            pointsData,
            1.0,
            settings.interfaceSettings.distributionWidth,
            settings.interfaceSettings.displayAreaWidth,
            settings.domainRange
        );
        targetDistributionSamples.set(translatedData);
        currentDistributionSamples.set([[]]);

        // Load cached samples if they exist
        const cachedSamplesPath = settings.cachedSamplesPaths?.[trainingObjectiveVal]?.[datasetNameVal];
        const cachedGridSamplesPath = settings.cachedGridSamplesPaths?.[trainingObjectiveVal]?.[datasetNameVal];

        if (cachedSamplesPath && cachedGridSamplesPath) {
            const allSamples = await fetch(base + cachedSamplesPath).then(r => r.json());
            allTimeSamples.set(allSamples);
            const gridSamples = await fetch(base + cachedGridSamplesPath).then(r => r.json());
            allTimeGridSamples.set(gridSamples);
            if (!get(isTraining)) isPlaying.set(true);
        } else {
            console.log("No cached samples found.");
            // Regenerate samples
            const defaultModelPath = base + settings.pretrainedModelPaths[trainingObjectiveVal][datasetNameVal];
            callSamplingWorkerThread(
                defaultModelPath,
                trainingObjectiveVal,
                settings.trainingObjectiveToModelConfig[trainingObjectiveVal],
                get(numSamples),
                get(numberOfSteps),
                settings.domainRange,
                settings.interfaceSettings.distributionWidth,
                settings.interfaceSettings.displayAreaWidth,
                (allSamples) => {
                    allTimeSamples.set(allSamples);
                    if (!get(isTraining)) isPlaying.set(true);
                    if (settings.downloadSamplesIfNotCached) {
                        downloadJSON(allSamples, `${datasetNameVal}_${trainingObjectiveVal}_samples.json`);
                    }
                }
            );

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
                    const trajectoryGrid = tf.tensor(allSamples).reshape([numberOfStepsVal, gridResolution, gridResolution, 2]).arraySync() as number[][][];
                    allTimeGridSamples.set(trajectoryGrid);
                    if (settings.downloadSamplesIfNotCached) {
                        downloadJSON(trajectoryGrid, `${datasetNameVal}_${trainingObjectiveVal}_grid.json`);
                    }
                }
            );
        }
    }

    function handleTrainingObjectiveChange() {
        const trainingObjectiveVal = get(trainingObjective);
        sampler.set(settings.trainingObjectiveToSamplers[trainingObjectiveVal][0]);
        handleDatasetChange();
    }

    async function finishTraining(
        tfModelPath: string,
        trainingObjectiveVal: string,
        datasetNameVal: string,
        modelConfig: object,
        jsonURL: string | null = null
    ) {
        if (jsonURL) URL.revokeObjectURL(jsonURL);
        cachedModelPaths.update((cache) => ({
            ...cache,
            [trainingObjectiveVal]: {
                ...cache[trainingObjectiveVal],
                [datasetNameVal]: tfModelPath
            }
        }));

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
                allTimeSamples.set(allSamples);
                distributionVisiblity.set({ current: true, source: true, training: false, target: true });
                isPlaying.set(true);
                currentTime.set(0);
            }
        );

        const squashedDomainRange = {
            xMin: settings.domainRange.xMin + 0.6,
            xMax: settings.domainRange.xMax - 0.6,
            yMin: settings.domainRange.yMin + 0.6,
            yMax: settings.domainRange.yMax - 0.6
        };

        const gridResolution = settings.meshPlotSettings.gridResolution;
        callSamplingWorkerThreadGrid(
            tfModelPath,
            trainingObjectiveVal,
            settings.trainingObjectiveToModelConfig[trainingObjectiveVal],
            gridResolution,
            get(numberOfSteps),
            squashedDomainRange,
            settings.interfaceSettings.distributionWidth,
            settings.interfaceSettings.displayAreaWidth,
            (allSamples: number[][]) => {
                const trajectoryGrid = tf.tensor(allSamples).reshape([get(numberOfSteps), gridResolution, gridResolution, 2]).arraySync() as number[][][];
                allTimeGridSamples.set(trajectoryGrid);
            }
        );
    }

    function startTraining() {
        if (get(usePretrained)) usePretrained.set(false);
        distributionVisiblity.set({ current: false, source: false, training: true, target: true });
        isPlaying.set(false);
        epochValue.set(0);

        const randomSamples = sampleMultivariateNormal([0, 0], [[1, 0], [0, 1]], get(numSamples));
        const translatedSamples = convertDataToDisplayCoordinateFrame(
            randomSamples.arraySync() as number[][],
            1.0,
            settings.interfaceSettings.distributionWidth,
            settings.interfaceSettings.displayAreaWidth,
            settings.domainRange
        );
        intermediateTrainingSamples.set(translatedSamples);

        let jsonURL: string | null = null;
        const datasetNameVal = get(datasetName);
        if (datasetNameVal === "brush") {
            const translatedSamples = convertDisplayCoordinateFrameToData(
                get(targetDistributionSamples),
                1.0,
                settings.interfaceSettings.distributionWidth,
                settings.interfaceSettings.displayAreaWidth,
                settings.domainRange
            );
            jsonURL = URL.createObjectURL(new Blob([JSON.stringify({ points: translatedSamples })], { type: 'application/json' }));
        }

        const trainingObjectiveVal = get(trainingObjective);
        const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];

        const trainingWorker: Worker = callTrainingWorkerThread(
            trainingObjectiveVal,
            modelConfig,
            jsonURL ?? base + settings.datasetNameToPath[datasetNameVal],
            settings.trainingConfig,
            (tfModelPath: string) => finishTraining(tfModelPath, trainingObjectiveVal, datasetNameVal, modelConfig, jsonURL),
            (epoch: number, intermediateSamples: number[][]) => {
                epochValue.set(epoch);
                if (intermediateSamples) {
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

        return trainingWorker;
    }

    async function stopTraining(trainingWorker: Worker) {
        trainingWorker.postMessage({ type: 'stop_training' });
    }

    function startEditing() {
        distributionVisiblity.set({ current: false, source: false, training: false, target: true });
        isPlaying.set(false);
        epochValue.set(0);
        targetDistributionSamples.set([]);
    }

    function stopEditing() {
        // No-op for now
    }

    function handleUsePretrained() {
        handleDatasetChange();
    }

    return {
        loadDatasets,
        initializeDistributions,
        handleDatasetChange,
        handleTrainingObjectiveChange,
        startTraining,
        stopTraining,
        finishTraining,
        startEditing,
        stopEditing,
        handleUsePretrained
    };
}
