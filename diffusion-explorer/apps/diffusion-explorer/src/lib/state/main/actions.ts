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

import {
    sampleMultivariateNormal,
    FlowModelClient,
    DiffusionModelClient,
    type DomainRange
} from '@diffusion-explorer/diffusion';

// Worker URLs (bundled to static/workers/ for production)
const flowModelWorkerUrl = '/workers/flow_model.worker.js';
const diffusionModelWorkerUrl = '/workers/diffusion_model.worker.js';

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
            throw new Error(`Dataset name ${datasetNameVal} not found in dataset dictionary. Available keys: ${Object.keys(datasetDictVal).join(', ')}`);
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
        if (!datasetDictVal) {
            throw new Error('Dataset dictionary is undefined');
        }
        if (!(datasetNameVal in datasetDictVal)) {
            throw new Error(`Dataset name ${datasetNameVal} not found in dataset dictionary. Available keys: ${Object.keys(datasetDictVal).join(', ')}`);
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
            // Load and convert cached samples from domain coords to display coords
            const allSamples = await fetch(base + cachedSamplesPath).then(r => r.json());
            const convertedSamples = allSamples.map((samples: number[][], timeIdx: number) => {
                const t = timeIdx / (allSamples.length - 1); // Normalize time to [0, 1]
                return convertDataToDisplayCoordinateFrame(
                    samples,
                    t,
                    settings.interfaceSettings.distributionWidth,
                    settings.interfaceSettings.displayAreaWidth,
                    settings.domainRange
                );
            });
            allTimeSamples.set(convertedSamples);

            // Load grid samples, convert to display coords, and reshape from [time, N, 2] to [time, x, y, 2]
            const gridSamplesFlat = await fetch(base + cachedGridSamplesPath).then(r => r.json());
            const gridRes = settings.meshPlotSettings.gridResolution; // e.g., 15

            // Convert and reshape grid samples
            const reshapedGrid = gridSamplesFlat.map((timestep: number[][], timeIdx: number) => {
                const t = timeIdx / (gridSamplesFlat.length - 1);
                // Convert flat points to display coordinates
                const convertedPoints = convertDataToDisplayCoordinateFrame(
                    timestep,
                    t,
                    settings.interfaceSettings.distributionWidth,
                    settings.interfaceSettings.displayAreaWidth,
                    settings.domainRange
                );
                // Reshape [N, 2] to [gridRes, gridRes, 2]
                const result: number[][][] = [];
                for (let i = 0; i < gridRes; i++) {
                    const row: number[][] = [];
                    for (let j = 0; j < gridRes; j++) {
                        row.push(convertedPoints[i * gridRes + j]);
                    }
                    result.push(row);
                }
                return result;
            });
            allTimeGridSamples.set(reshapedGrid);
            if (!get(isTraining)) isPlaying.set(true);
        } else {
            console.log("No cached samples found.");
            // Regenerate samples using client-based API
            const defaultModelPath = base + settings.pretrainedModelPaths[trainingObjectiveVal][datasetNameVal];
            const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];

            // Select appropriate client based on training objective
            const workerUrl = trainingObjectiveVal === 'Flow Matching' ? flowModelWorkerUrl : diffusionModelWorkerUrl;
            const client = trainingObjectiveVal === 'Flow Matching'
                ? new FlowModelClient(workerUrl, defaultModelPath, trainingObjectiveVal, modelConfig)
                : new DiffusionModelClient(workerUrl, defaultModelPath, modelConfig);

            // Sample trajectories
            const { promise: samplePromise } = client.sample(get(numSamples), get(numberOfSteps));
            samplePromise.then((allSamples: number[][][]) => {
                // Convert from domain coords to display coords
                const convertedSamples = allSamples.map((samples: number[][], timeIdx: number) => {
                    const t = timeIdx / (allSamples.length - 1);
                    return convertDataToDisplayCoordinateFrame(
                        samples,
                        t,
                        settings.interfaceSettings.distributionWidth,
                        settings.interfaceSettings.displayAreaWidth,
                        settings.domainRange
                    );
                });
                allTimeSamples.set(convertedSamples);
                if (!get(isTraining)) isPlaying.set(true);
                if (settings.downloadSamplesIfNotCached) {
                    downloadJSON(allSamples, `${datasetNameVal}_${trainingObjectiveVal}_samples.json`);
                }
            });

            // Sample grid trajectories
            const { promise: gridPromise } = trainingObjectiveVal === 'Flow Matching'
                ? (client as FlowModelClient).sampleGrid(gridResolution, settings.domainRange as DomainRange, numberOfStepsVal)
                : (client as DiffusionModelClient).sampleGrid(gridResolution, settings.domainRange as DomainRange, numberOfStepsVal);

            gridPromise.then((gridSamples: number[][][]) => {
                // Convert from domain coords to display coords and reshape
                const reshapedGrid = gridSamples.map((timestep: number[][], timeIdx: number) => {
                    const t = timeIdx / (gridSamples.length - 1);
                    const convertedPoints = convertDataToDisplayCoordinateFrame(
                        timestep,
                        t,
                        settings.interfaceSettings.distributionWidth,
                        settings.interfaceSettings.displayAreaWidth,
                        settings.domainRange
                    );
                    // Reshape [N, 2] to [gridRes, gridRes, 2]
                    const result: number[][][] = [];
                    for (let i = 0; i < gridResolution; i++) {
                        const row: number[][] = [];
                        for (let j = 0; j < gridResolution; j++) {
                            row.push(convertedPoints[i * gridResolution + j]);
                        }
                        result.push(row);
                    }
                    return result;
                });
                allTimeGridSamples.set(reshapedGrid);
                if (settings.downloadSamplesIfNotCached) {
                    downloadJSON(gridSamples, `${datasetNameVal}_${trainingObjectiveVal}_grid.json`);
                }
            });
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
        modelConfig: any,
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

        // Select appropriate client based on training objective
        const workerUrl = trainingObjectiveVal === 'Flow Matching' ? flowModelWorkerUrl : diffusionModelWorkerUrl;
        const client = trainingObjectiveVal === 'Flow Matching'
            ? new FlowModelClient(workerUrl, tfModelPath, trainingObjectiveVal, modelConfig)
            : new DiffusionModelClient(workerUrl, tfModelPath, modelConfig);

        // Sample trajectories
        const { promise: samplePromise } = client.sample(get(numSamples), get(numberOfSteps));
        samplePromise.then((allSamples: number[][][]) => {
            // Convert from domain coords to display coords
            const convertedSamples = allSamples.map((samples: number[][], timeIdx: number) => {
                const t = timeIdx / (allSamples.length - 1);
                return convertDataToDisplayCoordinateFrame(
                    samples,
                    t,
                    settings.interfaceSettings.distributionWidth,
                    settings.interfaceSettings.displayAreaWidth,
                    settings.domainRange
                );
            });
            allTimeSamples.set(convertedSamples);
            distributionVisiblity.set({ current: true, source: true, training: false, target: true });
            isPlaying.set(true);
            currentTime.set(0);
        });

        const squashedDomainRange: DomainRange = {
            xMin: settings.domainRange.xMin + 0.6,
            xMax: settings.domainRange.xMax - 0.6,
            yMin: settings.domainRange.yMin + 0.6,
            yMax: settings.domainRange.yMax - 0.6
        };

        const gridResolution = settings.meshPlotSettings.gridResolution;
        const numberOfStepsVal = get(numberOfSteps);

        // Sample grid trajectories
        const { promise: gridPromise } = trainingObjectiveVal === 'Flow Matching'
            ? (client as FlowModelClient).sampleGrid(gridResolution, squashedDomainRange, numberOfStepsVal)
            : (client as DiffusionModelClient).sampleGrid(gridResolution, squashedDomainRange, numberOfStepsVal);

        gridPromise.then((gridSamples: number[][][]) => {
            // Convert from domain coords to display coords and reshape
            const reshapedGrid = gridSamples.map((timestep: number[][], timeIdx: number) => {
                const t = timeIdx / (gridSamples.length - 1);
                const convertedPoints = convertDataToDisplayCoordinateFrame(
                    timestep,
                    t,
                    settings.interfaceSettings.distributionWidth,
                    settings.interfaceSettings.displayAreaWidth,
                    settings.domainRange
                );
                // Reshape [N, 2] to [gridRes, gridRes, 2]
                const result: number[][][] = [];
                for (let i = 0; i < gridResolution; i++) {
                    const row: number[][] = [];
                    for (let j = 0; j < gridResolution; j++) {
                        row.push(convertedPoints[i * gridResolution + j]);
                    }
                    result.push(row);
                }
                return result;
            });
            allTimeGridSamples.set(reshapedGrid);
        });
    }

    // Store training client and request ID for stopping
    let activeTrainingClient: FlowModelClient | DiffusionModelClient | null = null;
    let activeTrainingRequestId: string | null = null;

    function startTraining(): { requestId: string; client: FlowModelClient | DiffusionModelClient } {
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
            const brushSamples = convertDisplayCoordinateFrameToData(
                get(targetDistributionSamples),
                1.0,
                settings.interfaceSettings.distributionWidth,
                settings.interfaceSettings.displayAreaWidth,
                settings.domainRange
            );
            jsonURL = URL.createObjectURL(new Blob([JSON.stringify({ points: brushSamples })], { type: 'application/json' }));
        }

        const trainingObjectiveVal = get(trainingObjective);
        const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];
        const datasetPath = jsonURL ?? base + settings.datasetNameToPath[datasetNameVal];

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
                epochValue.set(epoch);
                if (intermediateSamples) {
                    const convertedSamples = convertDataToDisplayCoordinateFrame(
                        intermediateSamples,
                        1.0,
                        settings.interfaceSettings.distributionWidth,
                        settings.interfaceSettings.displayAreaWidth,
                        settings.domainRange
                    );
                    intermediateTrainingSamples.set(convertedSamples);
                }
            }
        );

        // Handle training completion
        promise.then((result: { tfModelPath: string }) => {
            finishTraining(result.tfModelPath, trainingObjectiveVal, datasetNameVal, modelConfig, jsonURL);
            activeTrainingClient = null;
            activeTrainingRequestId = null;
        }).catch((error: Error) => {
            console.log('Training stopped or failed:', error.message);
            activeTrainingClient = null;
            activeTrainingRequestId = null;
        });

        // Store for stopping
        activeTrainingClient = client;
        activeTrainingRequestId = requestId;

        return { requestId, client };
    }

    async function stopTraining() {
        if (activeTrainingClient && activeTrainingRequestId) {
            activeTrainingClient.stopRequest(activeTrainingRequestId);
            activeTrainingClient = null;
            activeTrainingRequestId = null;
        }
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
