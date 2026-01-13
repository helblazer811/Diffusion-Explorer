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

import type { MainState } from './state';

// Worker URLs (bundled to static/workers/ for production)
const flowModelWorkerUrl = '/workers/flow_model.worker.js';
const diffusionModelWorkerUrl = '/workers/diffusion_model.worker.js';

/**
 * Create the appropriate model client based on training objective.
 */
function createModelClient(
    trainingObjective: string,
    modelPath: string,
    modelConfig: any
): FlowModelClient | DiffusionModelClient {
    if (trainingObjective === 'Flow Matching') {
        return new FlowModelClient(flowModelWorkerUrl, modelPath, trainingObjective, modelConfig);
    }
    if (trainingObjective === 'Diffusion') {
        return new DiffusionModelClient(diffusionModelWorkerUrl, modelPath, modelConfig);
    }
    throw new Error(`Unknown training objective: ${trainingObjective}`);
}

/**
 * Factory function that takes a MainState object and returns handlers bound to that state.
 */
export function createMainStateHandlers(state: MainState) {
    const {
        modeState,
        trainingState,
        playbackState,
        distributionData,
        visibility,
        config,
        modelState,
        datasetDict,
        isTraining,
    } = state;

    // ============================================================================
    // State Transition Functions
    // ============================================================================

    function enterTrainingMode() {
        modeState.set({ mode: 'training' });
        trainingState.set({ epoch: 0, intermediateSamples: undefined });
        playbackState.update(p => ({ ...p, isPlaying: false }));
        visibility.set({ source: false, target: true, current: false, training: true });
        modelState.update(m => ({ ...m, usePretrained: false }));
    }

    function exitTrainingMode() {
        modeState.set({ mode: 'idle' });
        trainingState.set({ epoch: 0, intermediateSamples: undefined });
        // Don't auto-start playback here - let caller decide based on whether samples are ready
        playbackState.update(p => ({ ...p, time: 0, isPlaying: false }));
        visibility.set({ source: true, target: true, current: true, training: false });
    }

    function enterEditMode() {
        modeState.set({ mode: 'editing' });
        playbackState.update(p => ({ ...p, isPlaying: false }));
        visibility.set({ source: false, target: true, current: false, training: false });
        trainingState.update(t => ({ ...t, epoch: 0 }));
        // Clear all distribution data to prevent stale samples from previous dataset showing
        distributionData.update(d => ({ ...d, target: [], allTime: undefined, allTimeGrid: undefined }));
    }

    function exitEditMode() {
        modeState.set({ mode: 'idle' });
    }

    // ============================================================================
    // Data Loading
    // ============================================================================

    async function loadDatasets() {
        console.log("[loadDatasets] Starting");
        const datasetNameToPath = settings.datasetNameToPath;

        async function loadDataset(path: string) {
            path = base + path;
            console.log("[loadDatasets] Loading dataset from:", path);
            const response = await fetch(path);
            const data = await response.json();
            console.log("[loadDatasets] Loaded", data.points?.length, "points");
            return data.points;
        }

        const datasets: Record<string, any> = {};
        for (const [name, path] of Object.entries(datasetNameToPath)) {
            datasets[name] = await loadDataset(path);
        }
        console.log("[loadDatasets] All datasets loaded:", Object.keys(datasets));
        datasetDict.set(datasets);
    }

    async function initializeDistributions() {
        console.log("[initializeDistributions] Starting");
        const datasetDictVal = get(datasetDict);
        const configVal = get(config);
        const interfaceSettings = settings.interfaceSettings;
        const domainRange = settings.domainRange;
        console.log("[initializeDistributions] datasetName:", configVal.datasetName, "numSamples:", configVal.numSamples);

        if (!(configVal.datasetName in datasetDictVal)) {
            throw new Error(`Dataset name ${configVal.datasetName} not found in dataset dictionary. Available keys: ${Object.keys(datasetDictVal).join(', ')}`);
        }
        const pointData = datasetDictVal[configVal.datasetName];
        if (!pointData) {
            throw new Error(`No data found for dataset ${configVal.datasetName}`);
        }
        console.log("[initializeDistributions] Raw target data sample (domain coords):", pointData.slice(0, 3));
        const translatedData = convertDataToDisplayCoordinateFrame(
            pointData,
            1.0,
            interfaceSettings.distributionWidth,
            interfaceSettings.displayAreaWidth,
            domainRange
        );
        console.log("[initializeDistributions] Translated target data sample (pixel coords):", translatedData.slice(0, 3));
        distributionData.update(d => ({ ...d, target: translatedData }));

        const multivariateNormalSamples = sampleMultivariateNormal(
            [0, 0],
            [[1, 0], [0, 1]],
            configVal.numSamples
        );
        const multivariateNormalSamplesArray = multivariateNormalSamples.arraySync() as number[][];
        console.log("[initializeDistributions] Raw source data sample (domain coords):", multivariateNormalSamplesArray.slice(0, 3));
        const translatedSamples = convertDataToDisplayCoordinateFrame(
            multivariateNormalSamplesArray,
            0.0,
            interfaceSettings.distributionWidth,
            interfaceSettings.displayAreaWidth,
            domainRange
        );
        console.log("[initializeDistributions] Translated source data sample (pixel coords):", translatedSamples.slice(0, 3));
        distributionData.update(d => ({ ...d, source: translatedSamples }));
        console.log("[initializeDistributions] Done");
    }

    // ============================================================================
    // Dataset & Config Change Handlers
    // ============================================================================

    async function handleDatasetChange() {
        const configVal = get(config);
        const datasetDictVal = get(datasetDict);
        const gridResolution = settings.meshPlotSettings.gridResolution;

        playbackState.update(p => ({ ...p, isPlaying: false }));
        trainingState.update(t => ({ ...t, epoch: 0 }));
        if (get(isTraining)) modeState.set({ mode: 'idle' });

        if (!settings.pretrainedModelPaths[configVal.trainingObjective]?.[configVal.datasetName]) {
            modelState.update(m => ({ ...m, usePretrained: false }));
        }

        if (!settings.trainingObjectiveToSamplers[configVal.trainingObjective].includes(configVal.sampler)) {
            config.update(c => ({
                ...c,
                sampler: settings.trainingObjectiveToSamplers[configVal.trainingObjective][0]
            }));
        }
        if (!datasetDictVal) {
            throw new Error('Dataset dictionary is undefined');
        }
        if (!(configVal.datasetName in datasetDictVal)) {
            throw new Error(`Dataset name ${configVal.datasetName} not found in dataset dictionary. Available keys: ${Object.keys(datasetDictVal).join(', ')}`);
        }
        const pointsData = datasetDictVal[configVal.datasetName];
        const translatedData = convertDataToDisplayCoordinateFrame(
            pointsData,
            1.0,
            settings.interfaceSettings.distributionWidth,
            settings.interfaceSettings.displayAreaWidth,
            settings.domainRange
        );
        distributionData.update(d => ({ ...d, target: translatedData, current: [[]] }));

        // Load cached samples if they exist
        const cachedSamplesPath = settings.cachedSamplesPaths?.[configVal.trainingObjective]?.[configVal.datasetName];
        const cachedGridSamplesPath = settings.cachedGridSamplesPaths?.[configVal.trainingObjective]?.[configVal.datasetName];

        if (cachedSamplesPath && cachedGridSamplesPath) {
            // Load and convert cached samples from domain coords to display coords
            const allSamples = await fetch(base + cachedSamplesPath).then(r => r.json());
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
            distributionData.update(d => ({ ...d, allTime: convertedSamples }));

            // Load grid samples, convert to display coords, and reshape from [time, N, 2] to [time, x, y, 2]
            const gridSamplesFlat = await fetch(base + cachedGridSamplesPath).then(r => r.json());
            const gridRes = settings.meshPlotSettings.gridResolution;

            // Convert and reshape grid samples
            const reshapedGrid = gridSamplesFlat.map((timestep: number[][], timeIdx: number) => {
                const t = timeIdx / (gridSamplesFlat.length - 1);
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
            distributionData.update(d => ({ ...d, allTimeGrid: reshapedGrid }));
            if (!get(isTraining)) playbackState.update(p => ({ ...p, isPlaying: true }));
        } else {
            console.log("No cached samples found.");
            // Regenerate samples using client-based API
            const defaultModelPath = base + settings.pretrainedModelPaths[configVal.trainingObjective][configVal.datasetName];
            const modelConfig = settings.trainingObjectiveToModelConfig[configVal.trainingObjective];
            const client = createModelClient(configVal.trainingObjective, defaultModelPath, modelConfig);

            // Sample trajectories
            const { promise: samplePromise } = client.sample(configVal.numSamples, configVal.numberOfSteps);
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
                distributionData.update(d => ({ ...d, allTime: convertedSamples }));
                if (!get(isTraining)) playbackState.update(p => ({ ...p, isPlaying: true }));
                if (settings.downloadSamplesIfNotCached) {
                    downloadJSON(allSamples, `${configVal.datasetName}_${configVal.trainingObjective}_samples.json`);
                }
            });

            // Sample grid trajectories
            const { promise: gridPromise } = configVal.trainingObjective === 'Flow Matching'
                ? (client as FlowModelClient).sampleGrid(gridResolution, settings.domainRange as DomainRange, configVal.numberOfSteps)
                : (client as DiffusionModelClient).sampleGrid(gridResolution, settings.domainRange as DomainRange, configVal.numberOfSteps);

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
                distributionData.update(d => ({ ...d, allTimeGrid: reshapedGrid }));
                if (settings.downloadSamplesIfNotCached) {
                    downloadJSON(gridSamples, `${configVal.datasetName}_${configVal.trainingObjective}_grid.json`);
                }
            });
        }
    }

    function handleTrainingObjectiveChange() {
        const configVal = get(config);
        config.update(c => ({
            ...c,
            sampler: settings.trainingObjectiveToSamplers[configVal.trainingObjective][0]
        }));
        handleDatasetChange();
    }

    // ============================================================================
    // Training
    // ============================================================================

    /**
     * Sample from the trained model and transition to playback mode.
     * Called after training completes (naturally or stopped early).
     */
    function finishTrainingAndSample(
        client: FlowModelClient | DiffusionModelClient,
        configVal: { numSamples: number; numberOfSteps: number; trainingObjective: string },
        jsonURL: string | null = null
    ) {
        console.log('[finishTrainingAndSample] Starting sampling from trained model');
        if (jsonURL) URL.revokeObjectURL(jsonURL);

        // Sample trajectories from the trained model
        const { promise: samplePromise } = client.sample(configVal.numSamples, configVal.numberOfSteps);
        samplePromise.then((allSamples: number[][][]) => {
            console.log('[finishTrainingAndSample] Samples received:', allSamples.length, 'timesteps');
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
            distributionData.update(d => ({ ...d, allTime: convertedSamples }));
            exitTrainingMode();
            // Start playback now that samples are ready
            playbackState.update(p => ({ ...p, isPlaying: true }));
            console.log('[finishTrainingAndSample] Playback started');
        }).catch((err: Error) => {
            console.error('[finishTrainingAndSample] Sampling failed:', err);
            // Still exit training mode even if sampling fails
            exitTrainingMode();
        });

        // Sample grid trajectories
        const squashedDomainRange: DomainRange = {
            xMin: settings.domainRange.xMin + 0.6,
            xMax: settings.domainRange.xMax - 0.6,
            yMin: settings.domainRange.yMin + 0.6,
            yMax: settings.domainRange.yMax - 0.6
        };
        const gridResolution = settings.meshPlotSettings.gridResolution;

        const { promise: gridPromise } = configVal.trainingObjective === 'Flow Matching'
            ? (client as FlowModelClient).sampleGrid(gridResolution, squashedDomainRange, configVal.numberOfSteps)
            : (client as DiffusionModelClient).sampleGrid(gridResolution, squashedDomainRange, configVal.numberOfSteps);

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
            distributionData.update(d => ({ ...d, allTimeGrid: reshapedGrid }));
        }).catch((err: Error) => {
            console.error('[finishTrainingAndSample] Grid sampling failed:', err);
        });
    }

    // Store training client and request ID for stopping
    let activeTrainingClient: FlowModelClient | DiffusionModelClient | null = null;
    let activeTrainingRequestId: string | null = null;

    function startTraining(): { requestId: string; client: FlowModelClient | DiffusionModelClient } {
        enterTrainingMode();

        const configVal = get(config);

        const randomSamples = sampleMultivariateNormal([0, 0], [[1, 0], [0, 1]], configVal.numSamples);
        const translatedSamples = convertDataToDisplayCoordinateFrame(
            randomSamples.arraySync() as number[][],
            1.0,
            settings.interfaceSettings.distributionWidth,
            settings.interfaceSettings.displayAreaWidth,
            settings.domainRange
        );
        trainingState.update(t => ({ ...t, intermediateSamples: translatedSamples }));

        let jsonURL: string | null = null;
        if (configVal.datasetName === "brush") {
            const targetData = get(distributionData).target;
            if (targetData) {
                // Use time=0.0 because brush data is stored in local canvas coordinates (0-500),
                // not display coordinates. No translation needed, just domain scaling.
                const brushSamples = convertDisplayCoordinateFrameToData(
                    targetData,
                    0.0,
                    settings.interfaceSettings.distributionWidth,
                    settings.interfaceSettings.displayAreaWidth,
                    settings.domainRange
                );
                jsonURL = URL.createObjectURL(new Blob([JSON.stringify({ points: brushSamples })], { type: 'application/json' }));
            }
        }

        const modelConfig = settings.trainingObjectiveToModelConfig[configVal.trainingObjective];
        const datasetPath = jsonURL ?? base + settings.datasetNameToPath[configVal.datasetName];
        const client = createModelClient(configVal.trainingObjective, '', modelConfig);

        // Start training
        const { requestId, promise } = client.train(
            datasetPath,
            settings.trainingConfig,
            (epoch: number, intermediateSamples: number[][] | null, loss: number) => {
                trainingState.update(t => ({ ...t, epoch }));

                // DIAGNOSTIC: Check for NaN/explosion
                console.log(`[Training] Epoch ${epoch}, Loss: ${loss}`);

                if (intermediateSamples && intermediateSamples.length > 0) {
                    const hasNaN = intermediateSamples.some(s => s.some(v => !isFinite(v)));
                    const sample = intermediateSamples[0];
                    console.log(`[Training] Sample[0]: [${sample[0]?.toFixed(2)}, ${sample[1]?.toFixed(2)}], hasNaN: ${hasNaN}, count: ${intermediateSamples.length}`);

                    if (hasNaN) {
                        console.error('[Training] WARNING: Samples contain NaN/Infinity - model may have exploded');
                        return; // Skip update if samples are invalid
                    }

                    const convertedSamples = convertDataToDisplayCoordinateFrame(
                        intermediateSamples,
                        1.0,
                        settings.interfaceSettings.distributionWidth,
                        settings.interfaceSettings.displayAreaWidth,
                        settings.domainRange
                    );
                    trainingState.update(t => ({ ...t, intermediateSamples: convertedSamples }));
                }
            }
        );

        // Handle training completion (natural or stopped)
        console.log('[startTraining] Setting up promise handlers for requestId:', requestId);
        promise.then((result: { tfModelPath: string }) => {
            console.log('[startTraining] Promise RESOLVED - Training completed naturally');
            console.log('[startTraining] Model path:', result.tfModelPath);
            // Cache the model path for future use
            modelState.update(m => ({
                ...m,
                cachedPaths: {
                    ...m.cachedPaths,
                    [configVal.trainingObjective]: {
                        ...m.cachedPaths[configVal.trainingObjective],
                        [configVal.datasetName]: result.tfModelPath
                    }
                }
            }));
        }).catch((error: Error) => {
            console.log('[startTraining] Promise REJECTED - Training stopped:', error.message);
        }).finally(() => {
            // Whether completed or stopped, sample from the trained model and play animation
            console.log('[startTraining] Promise FINALLY - sampling from model');
            if (activeTrainingClient) {
                finishTrainingAndSample(activeTrainingClient, configVal, jsonURL);
            } else {
                console.error('[startTraining] No active client to sample from!');
                exitTrainingMode();
            }
            activeTrainingClient = null;
            activeTrainingRequestId = null;
        });

        // Store for stopping
        activeTrainingClient = client;
        activeTrainingRequestId = requestId;

        return { requestId, client };
    }

    async function stopTraining() {
        console.log('[stopTraining] Called, activeClient:', !!activeTrainingClient);
        if (activeTrainingClient && activeTrainingRequestId) {
            console.log('[stopTraining] Sending stop request and finishing training');
            // Send stop request to the worker
            activeTrainingClient.stopRequest(activeTrainingRequestId);
            // The promise doesn't settle when stopped, so we handle finish directly here
            const client = activeTrainingClient;
            const configVal = get(config);
            activeTrainingClient = null;
            activeTrainingRequestId = null;
            // Sample from whatever state the model is in and play animation
            finishTrainingAndSample(client, configVal, null);
        } else {
            console.log('[stopTraining] No active training to stop');
        }
    }

    function handleUsePretrained() {
        handleDatasetChange();
    }

    return {
        // Data loading
        loadDatasets,
        initializeDistributions,

        // Change handlers
        handleDatasetChange,
        handleTrainingObjectiveChange,
        handleUsePretrained,

        // Training
        startTraining,
        stopTraining,

        // Editing (called directly by MiniDistribution)
        enterEditMode,
        exitEditMode,
    };
}
