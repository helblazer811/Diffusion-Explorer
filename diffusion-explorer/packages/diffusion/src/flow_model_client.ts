/**
 * Unified FlowModelClient for sampling and training flow models.
 *
 * This module provides a class-based API that consolidates all flow model operations:
 * - Sampling: sample, sampleFromInitialPoints, sampleGrid, vectorFieldGrid
 * - Training: train, trainRectified
 *
 * Uses a shared worker pool for efficient parallel processing.
 */

import { SchedulerType } from './schedulers';
import { validateModelPath } from './utils';

// ===== Types =====

type MessageType =
    | 'sample'
    | 'sample_from_initial_points'
    | 'sample_grid'
    | 'vector_field_grid'
    | 'train'
    | 'train_rectified';

export interface SamplingOptions {
    cond?: number[] | any;
    guidanceScale?: number;
    return_guidance?: boolean;
    scheduler?: SchedulerType;
    reverse?: boolean;  // If true, sample in reverse time (1 to 0) for inverting the flow
}

export interface DomainRange {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
}

export interface ModelConfig {
    dim: number;
    hidden: number;
    condDim?: number;
}

export interface TrainingConfig {
    epochs: number;
    batchSize: number;
    updateInterval: number;
}

export interface RectifiedConfig {
    num_rectified_steps: number;
    epochs_per_rectified_step: number;
    batchSize: number;
    num_simulation_steps: number;
    sourceDistributionPath?: string;
    testSourceDistributionPoints?: number[][];  // Optional test points for sampling visualization trajectories
    reverseSampling?: boolean;  // If true, sample backward from target to source for induced coupling
}

// Callback types
export type PerStepCallback = (step: number, x_t: number[][]) => void;
export type EpochCallback = (epoch: number, intermediateSamples: number[][] | null, loss: number) => void;
export type RectifiedEpochCallback = (epoch: number, rectifiedStep: number, intermediateSamples: number[][] | null, loss?: number) => void;
export type RectifiedStepCallback = (rectifiedStep: number, trajectories: number[][][] | null) => void;

// Result types
export interface RequestResult<T> {
    requestId: string;
    promise: Promise<T>;
}

export interface TrainingResult {
    tfModelPath: string;
}

export interface RectifiedTrainingResult {
    tfModelPath: string;
    allRectifiedTrajectories: number[][][][];
}

export interface VectorFieldResult {
    velocities: number[][];
    gridPoints: number[][];
}

// Internal callback tracking
interface RequestCallbacks {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    onStep?: PerStepCallback;
    onEpoch?: EpochCallback | RectifiedEpochCallback;
    onRectifiedStep?: RectifiedStepCallback;
}

interface MessageData {
    modelJSONPath?: string;
    trainingObjective: string;
    modelConfig: ModelConfig;
    numSamples?: number;
    initialPoints?: number[][];
    gridResolution?: number;
    numberOfSteps?: number;
    timeValue?: number;
    domainRange?: DomainRange;
    options?: SamplingOptions;
    streaming?: boolean;
    datasetPath?: string;
    trainingConfig?: TrainingConfig;
    rectifiedConfig?: RectifiedConfig;
}

// ===== Module-level state for worker pool =====

let poolSize = 5;
let workerPool: Worker[] = [];
let workerPoolUrl: string | null = null;
let nextWorkerIndex = 0;
const callbacksByRequestId = new Map<string, RequestCallbacks>();
const requestIdToWorker = new Map<string, Worker>();

/**
 * Create a message handler for a worker in the pool.
 * Routes responses based on requestId and message type.
 */
function createMessageHandler(workerIndex: number) {
    return (e: MessageEvent) => {
        const { requestId, type: msgType } = e.data;

        const handlers = callbacksByRequestId.get(requestId);
        if (!handlers) return;

        switch (msgType) {
            case 'step':
                // Sampling step update
                if (handlers.onStep) {
                    handlers.onStep(e.data.step, e.data.x_t);
                }
                break;

            case 'epoch_chunk':
                // Training epoch update
                if (handlers.onEpoch) {
                    if (e.data.rectifiedStep !== undefined) {
                        // Rectified training epoch
                        (handlers.onEpoch as RectifiedEpochCallback)(
                            e.data.epoch,
                            e.data.rectifiedStep,
                            e.data.intermediateSamples,
                            e.data.loss
                        );
                    } else {
                        // Standard training epoch
                        (handlers.onEpoch as EpochCallback)(
                            e.data.epoch,
                            e.data.intermediateSamples,
                            e.data.loss
                        );
                    }
                }
                break;

            case 'rectified_step_complete':
                // Rectified training step complete
                if (handlers.onRectifiedStep) {
                    handlers.onRectifiedStep(e.data.rectifiedStep, e.data.trajectories);
                }
                break;

            case 'result':
                // Final result - resolve promise with extracted payload
                // Extract the actual result based on what's in the message
                if (e.data.allSamples !== undefined) {
                    // Sampling result
                    handlers.resolve(e.data.allSamples);
                } else if (e.data.allRectifiedTrajectories !== undefined) {
                    // Rectified training result
                    handlers.resolve({
                        tfModelPath: e.data.tfModelPath,
                        allRectifiedTrajectories: e.data.allRectifiedTrajectories
                    });
                } else if (e.data.tfModelPath !== undefined) {
                    // Standard training result
                    handlers.resolve({ tfModelPath: e.data.tfModelPath });
                } else if (e.data.velocities !== undefined) {
                    // Vector field result
                    handlers.resolve({
                        velocities: e.data.velocities,
                        gridPoints: e.data.gridPoints
                    });
                } else {
                    // Unknown result type - pass through as-is
                    handlers.resolve(e.data);
                }
                cleanup(requestId);
                break;

            case 'cancelled':
                console.log(`[FlowModel Worker ${workerIndex}] Request cancelled:`, requestId);
                cleanup(requestId);
                break;

            case 'status':
                console.log(`[FlowModel Worker ${workerIndex}] status:`, e.data.message);
                break;

            case 'error':
                console.error(`[FlowModel Worker ${workerIndex}] error:`, e.data.error || e.data.message);
                handlers.reject(new Error(e.data.error || e.data.message));
                cleanup(requestId);
                break;
        }
    };
}

function cleanup(requestId: string): void {
    callbacksByRequestId.delete(requestId);
    requestIdToWorker.delete(requestId);
}

/**
 * Lazily creates and returns the worker pool.
 */
function initializeWorkerPool(workerUrl: string): void {
    // Already initialized with same URL
    if (workerPool.length > 0 && workerPoolUrl === workerUrl) return;

    // Different URL - terminate old workers and create new pool
    if (workerPoolUrl !== workerUrl && workerPool.length > 0) {
        workerPool.forEach(w => w.terminate());
        workerPool = [];
    }

    workerPoolUrl = workerUrl;

    for (let i = 0; i < poolSize; i++) {
        const worker = new Worker(workerUrl, { type: 'module' });

        worker.onerror = (e) => {
            console.error(`[FlowModel Worker ${i} Error]`, {
                message: e.message,
                filename: e.filename,
                lineno: e.lineno,
                colno: e.colno
            });
        };

        worker.onmessageerror = (e) => {
            console.error(`[FlowModel Worker ${i} Message Error] Failed to deserialize message:`, e);
        };

        worker.onmessage = createMessageHandler(i);

        workerPool.push(worker);
    }

    console.log(`[FlowModel Pool] Initialized ${poolSize} workers`);
}

/**
 * Get next worker from pool using round-robin.
 */
function getNextWorker(workerUrl: string): Worker {
    initializeWorkerPool(workerUrl);

    const worker = workerPool[nextWorkerIndex];
    nextWorkerIndex = (nextWorkerIndex + 1) % workerPool.length;
    return worker;
}

/**
 * Set the worker pool size. Must be called before any operations.
 * @param size Number of workers in the pool (default: 5)
 */
export function setPoolSize(size: number): void {
    if (workerPool.length > 0) {
        console.warn('[FlowModel Pool] Cannot change pool size after initialization');
        return;
    }
    poolSize = size;
}

/**
 * Cancel all pending requests by rejecting their promises.
 * Use this when navigating away from a page to prevent orphaned promises.
 */
export function cancelAllPendingRequests(): void {
    const pendingCount = callbacksByRequestId.size;
    if (pendingCount === 0) return;

    console.log(`[FlowModel Pool] Cancelling ${pendingCount} pending requests`);

    // Send stop messages to workers for all pending requests
    for (const [requestId, callbacks] of callbacksByRequestId.entries()) {
        const worker = requestIdToWorker.get(requestId);
        if (worker) {
            worker.postMessage({ requestId, type: 'stop' });
        }
        // Reject the promise so awaiting code doesn't hang
        callbacks.reject(new Error('Request cancelled due to cleanup'));
    }

    // Clear all tracking maps
    callbacksByRequestId.clear();
    requestIdToWorker.clear();
}

/**
 * Destroy the worker pool entirely.
 * Cancels all pending requests and terminates all workers.
 * Use this when the application is shutting down or on page unload.
 */
export function destroyWorkerPool(): void {
    console.log('[FlowModel Pool] Destroying worker pool');

    // Cancel all pending requests first
    cancelAllPendingRequests();

    // Terminate all workers
    for (const worker of workerPool) {
        worker.terminate();
    }

    // Reset pool state
    workerPool = [];
    workerPoolUrl = null;
    nextWorkerIndex = 0;
}

// ===== FlowModelClient Class =====

const DEFAULT_WORKER_URL = '/workers/flow_model.worker.js';

/**
 * Unified client for flow model sampling and training using web workers.
 *
 * Provides a clean, class-based API for all flow model operations:
 * - Sampling: Generate trajectories from trained models
 * - Training: Train new models or perform rectified flow training
 *
 * Uses a shared worker pool for efficient parallel processing across
 * all client instances.
 *
 * @example
 * ```typescript
 * // Sampling from a trained model
 * const client = new FlowModelClient(
 *   '/workers/flow_model.worker.js',
 *   '/models/flow_matching_model.json',
 *   'Flow Matching',
 *   { dim: 2, hidden: 64 }
 * );
 *
 * const { requestId, promise } = client.sampleFromInitialPoints(
 *   [[0, 0], [1, 1]],
 *   100,
 *   { scheduler: 'euler' },
 *   (step, x_t) => console.log(`Step ${step}:`, x_t)
 * );
 *
 * const trajectories = await promise;
 *
 * // Cancel if needed
 * client.stopRequest(requestId);
 * ```
 *
 * @example
 * ```typescript
 * // Training a new model
 * const client = new FlowModelClient(
 *   '/workers/flow_model.worker.js',
 *   '',  // No model path for training
 *   'Flow Matching',
 *   { dim: 2, hidden: 64 }
 * );
 *
 * const { requestId, promise } = client.train(
 *   '/data/dataset.json',
 *   { epochs: 100, batchSize: 256, updateInterval: 10 },
 *   (epoch, samples, loss) => console.log(`Epoch ${epoch}: loss=${loss}`)
 * );
 *
 * const { tfModelPath } = await promise;
 * ```
 */
export class FlowModelClient {
    private workerUrl: string;
    private modelJSONPath: string;
    private trainingObjective: string;
    private modelConfig: ModelConfig;
    private domainRange: DomainRange | null;

    /**
     * Create a new FlowModelClient.
     *
     * @param workerUrl - URL to the worker script (default: '/workers/flow_model.worker.js')
     * @param modelJSONPath - Path to the saved model (file path or IndexedDB URL). Empty for training.
     * @param trainingObjective - Training objective ('Flow Matching', 'Diffusion', etc.)
     * @param modelConfig - Model configuration object with dim, hidden, and optional condDim
     * @param domainRange - Optional domain bounds for clipping
     */
    constructor(
        workerUrl: string = DEFAULT_WORKER_URL,
        modelJSONPath: string = '',
        trainingObjective: string = 'Flow Matching',
        modelConfig: ModelConfig = { dim: 2, hidden: 64 },
        domainRange: DomainRange | null = null
    ) {
        this.workerUrl = workerUrl;
        this.modelJSONPath = modelJSONPath;
        this.trainingObjective = trainingObjective;
        this.modelConfig = modelConfig;
        this.domainRange = domainRange;
    }

    /**
     * Create a validated FlowModelClient.
     *
     * Validates that the model exists at the specified path before returning.
     * Use this factory method when you need to verify the model is available.
     *
     * @param workerUrl - URL to the worker script
     * @param modelJSONPath - Path to the saved model
     * @param trainingObjective - Training objective
     * @param modelConfig - Model configuration
     * @param domainRange - Optional domain bounds
     * @returns Promise resolving to a validated FlowModelClient
     * @throws Error if the model path is invalid
     */
    static async create(
        workerUrl: string = DEFAULT_WORKER_URL,
        modelJSONPath: string = '',
        trainingObjective: string = 'Flow Matching',
        modelConfig: ModelConfig = { dim: 2, hidden: 64 },
        domainRange: DomainRange | null = null
    ): Promise<FlowModelClient> {
        if (modelJSONPath) {
            await validateModelPath(modelJSONPath);
        }
        return new FlowModelClient(workerUrl, modelJSONPath, trainingObjective, modelConfig, domainRange);
    }

    /**
     * Internal dispatch method for sending messages to workers.
     */
    private dispatch<T>(
        type: MessageType,
        data: MessageData,
        callbacks: Partial<RequestCallbacks> = {}
    ): RequestResult<T> {
        const worker = getNextWorker(this.workerUrl);
        const requestId = crypto.randomUUID();

        const promise = new Promise<T>((resolve, reject) => {
            callbacksByRequestId.set(requestId, {
                resolve,
                reject,
                ...callbacks
            });
        });

        requestIdToWorker.set(requestId, worker);

        console.log('[FlowModel Pool] Sending message:', { type, requestId, timestamp: Date.now() });
        worker.postMessage({ requestId, type, data });

        return { requestId, promise };
    }

    /**
     * Cancel a request by ID.
     *
     * @param requestId - The request ID to cancel (from a previous call)
     */
    stopRequest(requestId: string): void {
        const worker = requestIdToWorker.get(requestId);
        if (worker) {
            console.log('[FlowModel Pool] Sending stop request:', requestId);
            worker.postMessage({ requestId, type: 'stop' });
            cleanup(requestId);
        }
    }

    // ===== SAMPLING METHODS =====

    /**
     * Sample trajectories from random Gaussian initial points.
     *
     * @param numSamples - Number of random samples to generate
     * @param numberOfSteps - Number of integration steps (default: 100)
     * @param options - Optional sampling parameters
     * @param perStepCallback - Optional callback invoked after each step
     * @returns Object with requestId and promise resolving to trajectories
     */
    sample(
        numSamples: number,
        numberOfSteps: number = 100,
        options: SamplingOptions = {},
        perStepCallback?: PerStepCallback
    ): RequestResult<number[][][]> {
        return this.dispatch<number[][][]>(
            'sample',
            {
                modelJSONPath: this.modelJSONPath,
                trainingObjective: this.trainingObjective,
                modelConfig: this.modelConfig,
                numSamples,
                numberOfSteps,
                domainRange: this.domainRange ?? undefined,
                options,
                streaming: !!perStepCallback
            },
            { onStep: perStepCallback }
        );
    }

    /**
     * Sample trajectories from specified initial points.
     *
     * @param initialPoints - Array of starting points [[x, y], ...]
     * @param numberOfSteps - Number of integration steps (default: 100)
     * @param options - Optional sampling parameters
     * @param perStepCallback - Optional callback invoked after each step
     * @returns Object with requestId and promise resolving to trajectories
     */
    sampleFromInitialPoints(
        initialPoints: number[][],
        numberOfSteps: number = 100,
        options: SamplingOptions = {},
        perStepCallback?: PerStepCallback
    ): RequestResult<number[][][]> {
        return this.dispatch<number[][][]>(
            'sample_from_initial_points',
            {
                modelJSONPath: this.modelJSONPath,
                trainingObjective: this.trainingObjective,
                modelConfig: this.modelConfig,
                initialPoints,
                numberOfSteps,
                domainRange: this.domainRange ?? undefined,
                options,
                streaming: !!perStepCallback
            },
            { onStep: perStepCallback }
        );
    }

    /**
     * Sample trajectories from a uniform grid of initial points.
     *
     * @param gridResolution - Number of points along each axis
     * @param domainRange - Domain bounds defining the grid extent
     * @param numberOfSteps - Number of integration steps (default: 100)
     * @param options - Optional sampling parameters
     * @param perStepCallback - Optional callback invoked after each step
     * @returns Object with requestId and promise resolving to trajectories
     */
    sampleGrid(
        gridResolution: number,
        domainRange: DomainRange,
        numberOfSteps: number = 100,
        options: SamplingOptions = {},
        perStepCallback?: PerStepCallback
    ): RequestResult<number[][][]> {
        return this.dispatch<number[][][]>(
            'sample_grid',
            {
                modelJSONPath: this.modelJSONPath,
                trainingObjective: this.trainingObjective,
                modelConfig: this.modelConfig,
                gridResolution,
                numberOfSteps,
                domainRange,
                options,
                streaming: !!perStepCallback
            },
            { onStep: perStepCallback }
        );
    }

    /**
     * Evaluate vector field values on a uniform grid.
     *
     * @param gridResolution - Number of points along each axis
     * @param domainRange - Spatial domain to sample
     * @param timeValue - Time value for evaluation (default: 0.5)
     * @param options - Optional sampling parameters
     * @returns Object with requestId and promise resolving to velocities
     */
    vectorFieldGrid(
        gridResolution: number,
        domainRange: DomainRange,
        timeValue: number = 0.5,
        options: SamplingOptions = {}
    ): RequestResult<VectorFieldResult> {
        return this.dispatch<VectorFieldResult>(
            'vector_field_grid',
            {
                modelJSONPath: this.modelJSONPath,
                trainingObjective: this.trainingObjective,
                modelConfig: this.modelConfig,
                gridResolution,
                timeValue,
                domainRange,
                options
            }
        );
    }

    // ===== TRAINING METHODS =====

    /**
     * Train a flow model from scratch.
     *
     * @param datasetPath - URL to the JSON dataset file
     * @param trainingConfig - Training configuration (epochs, batchSize, updateInterval)
     * @param onEpoch - Optional callback invoked after each epoch
     * @returns Object with requestId and promise resolving to { tfModelPath }
     */
    train(
        datasetPath: string,
        trainingConfig: TrainingConfig,
        onEpoch?: EpochCallback
    ): RequestResult<TrainingResult> {
        return this.dispatch<TrainingResult>(
            'train',
            {
                trainingObjective: this.trainingObjective,
                modelConfig: this.modelConfig,
                datasetPath,
                trainingConfig
            },
            { onEpoch }
        );
    }

    /**
     * Train a model using rectified flow iterations.
     *
     * @param datasetPath - URL to the JSON dataset file (target distribution)
     * @param rectifiedConfig - Rectified flow training configuration
     * @param onEpoch - Optional callback invoked after each epoch
     * @param onRectifiedStep - Optional callback invoked after each rectified step
     * @returns Object with requestId and promise resolving to { tfModelPath, allRectifiedTrajectories }
     */
    trainRectified(
        datasetPath: string,
        rectifiedConfig: RectifiedConfig,
        onEpoch?: RectifiedEpochCallback,
        onRectifiedStep?: RectifiedStepCallback
    ): RequestResult<RectifiedTrainingResult> {
        return this.dispatch<RectifiedTrainingResult>(
            'train_rectified',
            {
                trainingObjective: this.trainingObjective,
                modelConfig: this.modelConfig,
                datasetPath,
                rectifiedConfig
            },
            { onEpoch, onRectifiedStep }
        );
    }
}

// Alias for backward compatibility with sampling_client
export { setPoolSize as setSamplingPoolSize };
