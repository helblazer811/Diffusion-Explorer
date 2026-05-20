/**
 * DiffusionModelClient for sampling and training diffusion models.
 *
 * This module provides a class-based API that consolidates all diffusion model operations:
 * - Sampling: sample, sampleFromInitialPoints, sampleGrid
 * - Training: train
 *
 * Uses a shared worker pool for efficient parallel processing.
 */

import { DiffusionSchedulerType } from './schedulers';
import { validateModelPath } from '../utils';

// ===== Types =====

type MessageType =
    | 'sample'
    | 'sample_from_initial_points'
    | 'sample_grid'
    | 'train';

export interface DiffusionSamplingOptions {
    scheduler?: DiffusionSchedulerType;
}

export interface DomainRange {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
}

export interface DiffusionModelConfig {
    dim: number;
    hidden: number;
    T?: number;
    betaStart?: number;
    betaEnd?: number;
}

export interface DiffusionTrainingConfig {
    epochs: number;
    batchSize: number;
    updateInterval: number;
}

// Callback types
export type PerStepCallback = (step: number, x_t: number[][]) => void;
export type EpochCallback = (epoch: number, intermediateSamples: number[][] | null, loss: number) => void;

// Result types
export interface RequestResult<T> {
    requestId: string;
    promise: Promise<T>;
}

export interface TrainingResult {
    tfModelPath: string;
}

// Internal callback tracking
interface RequestCallbacks {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    onStep?: PerStepCallback;
    onEpoch?: EpochCallback;
}

interface MessageData {
    modelJSONPath?: string;
    trainingObjective: string;
    modelConfig: DiffusionModelConfig;
    numSamples?: number;
    initialPoints?: number[][];
    gridResolution?: number;
    numberOfSteps?: number;
    domainRange?: DomainRange;
    options?: DiffusionSamplingOptions;
    streaming?: boolean;
    datasetPath?: string;
    trainingConfig?: DiffusionTrainingConfig;
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
 */
function createMessageHandler(workerIndex: number) {
    return (e: MessageEvent) => {
        const { requestId, type: msgType } = e.data;

        const handlers = callbacksByRequestId.get(requestId);
        if (!handlers) return;

        switch (msgType) {
            case 'step':
                if (handlers.onStep) {
                    handlers.onStep(e.data.step, e.data.x_t);
                }
                break;

            case 'epoch_chunk':
                if (handlers.onEpoch) {
                    handlers.onEpoch(
                        e.data.epoch,
                        e.data.intermediateSamples,
                        e.data.loss
                    );
                }
                break;

            case 'result':
                if (e.data.allSamples !== undefined) {
                    handlers.resolve(e.data.allSamples);
                } else if (e.data.tfModelPath !== undefined) {
                    handlers.resolve({ tfModelPath: e.data.tfModelPath });
                } else {
                    handlers.resolve(e.data);
                }
                cleanup(requestId);
                break;

            case 'cancelled':
                console.log(`[Diffusion Worker ${workerIndex}] Request cancelled:`, requestId);
                cleanup(requestId);
                break;

            case 'status':
                console.log(`[Diffusion Worker ${workerIndex}] status:`, e.data.message);
                break;

            case 'error':
                console.error(`[Diffusion Worker ${workerIndex}] error:`, e.data.error || e.data.message);
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

// Cache pre-flight checks per URL so we don't HEAD on every dispatch.
const workerUrlPreflightCache = new Map<string, Promise<void>>();

/**
 * Verify the worker script is reachable before instantiating workers. A missing
 * bundle (e.g. `bundle-workers` not run in dev) otherwise surfaces as an empty
 * `worker.onerror` event with all fields undefined — very hard to diagnose.
 */
function preflightWorkerUrl(workerUrl: string): Promise<void> {
    let p = workerUrlPreflightCache.get(workerUrl);
    if (p) return p;
    p = fetch(workerUrl, { method: 'HEAD' }).then(res => {
        if (!res.ok) {
            const msg =
                `[Diffusion Pool] Worker script not reachable: ${workerUrl} ` +
                `(HTTP ${res.status}). ` +
                `If you're running dev, run \`npm run bundle-workers\` in the app ` +
                `directory. The dev script does not bundle workers automatically; ` +
                `only \`npm run build\` does.`;
            console.error(msg);
            throw new Error(msg);
        }
    }).catch(err => {
        workerUrlPreflightCache.delete(workerUrl);
        throw err;
    });
    workerUrlPreflightCache.set(workerUrl, p);
    return p;
}

/**
 * Lazily creates and returns the worker pool.
 */
function initializeWorkerPool(workerUrl: string): void {
    if (workerPool.length > 0 && workerPoolUrl === workerUrl) return;

    if (workerPoolUrl !== workerUrl && workerPool.length > 0) {
        workerPool.forEach(w => w.terminate());
        workerPool = [];
    }

    workerPoolUrl = workerUrl;

    preflightWorkerUrl(workerUrl).catch(() => { /* already logged above */ });

    for (let i = 0; i < poolSize; i++) {
        const worker = new Worker(workerUrl, { type: 'module' });

        worker.onerror = (e) => {
            console.error(`[Diffusion Worker ${i} Error]`, {
                url: workerUrl,
                message: e.message || '(empty — script likely failed to load; check the URL is served)',
                filename: e.filename,
                lineno: e.lineno,
                colno: e.colno,
            });
        };

        worker.onmessageerror = (e) => {
            console.error(`[Diffusion Worker ${i} Message Error] Failed to deserialize message:`, e);
        };

        worker.onmessage = createMessageHandler(i);

        workerPool.push(worker);
    }

    console.log(`[Diffusion Pool] Initialized ${poolSize} workers`);
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
 */
export function setDiffusionPoolSize(size: number): void {
    if (workerPool.length > 0) {
        console.warn('[Diffusion Pool] Cannot change pool size after initialization');
        return;
    }
    poolSize = size;
}

/**
 * Cancel all pending diffusion requests.
 */
export function cancelAllDiffusionRequests(): void {
    const pendingCount = callbacksByRequestId.size;
    if (pendingCount === 0) return;

    console.log(`[Diffusion Pool] Cancelling ${pendingCount} pending requests`);

    for (const [requestId, callbacks] of callbacksByRequestId.entries()) {
        const worker = requestIdToWorker.get(requestId);
        if (worker) {
            worker.postMessage({ requestId, type: 'stop' });
        }
        callbacks.reject(new Error('Request cancelled due to cleanup'));
    }

    callbacksByRequestId.clear();
    requestIdToWorker.clear();
}

/**
 * Destroy the diffusion worker pool entirely.
 */
export function destroyDiffusionWorkerPool(): void {
    console.log('[Diffusion Pool] Destroying worker pool');

    cancelAllDiffusionRequests();

    for (const worker of workerPool) {
        worker.terminate();
    }

    workerPool = [];
    workerPoolUrl = null;
    nextWorkerIndex = 0;
}

// ===== DiffusionModelClient Class =====

const DEFAULT_WORKER_URL = '/workers/diffusion_model.worker.js';

/**
 * Client for diffusion model sampling and training using web workers.
 *
 * @example
 * ```typescript
 * // Sampling from a trained model
 * const client = new DiffusionModelClient(
 *   '/workers/diffusion_model.worker.js',
 *   '/models/diffusion_model.json',
 *   { dim: 2, hidden: 128, T: 1000 }
 * );
 *
 * const { requestId, promise } = client.sample(
 *   100,  // num_samples
 *   200,  // num_steps
 *   {},
 *   (step, x_t) => console.log(`Step ${step}`)
 * );
 *
 * const trajectories = await promise;
 * ```
 */
export class DiffusionModelClient {
    private workerUrl: string;
    private modelJSONPath: string;
    private modelConfig: DiffusionModelConfig;
    private domainRange: DomainRange | null;

    /**
     * Create a new DiffusionModelClient.
     *
     * @param workerUrl - URL to the worker script
     * @param modelJSONPath - Path to the saved model. Empty for training.
     * @param modelConfig - Model configuration
     * @param domainRange - Optional domain bounds
     */
    constructor(
        workerUrl: string = DEFAULT_WORKER_URL,
        modelJSONPath: string = '',
        modelConfig: DiffusionModelConfig = { dim: 2, hidden: 128, T: 1000 },
        domainRange: DomainRange | null = null
    ) {
        this.workerUrl = workerUrl;
        this.modelJSONPath = modelJSONPath;
        this.modelConfig = modelConfig;
        this.domainRange = domainRange;
    }

    /**
     * Create a validated DiffusionModelClient.
     */
    static async create(
        workerUrl: string = DEFAULT_WORKER_URL,
        modelJSONPath: string = '',
        modelConfig: DiffusionModelConfig = { dim: 2, hidden: 128, T: 1000 },
        domainRange: DomainRange | null = null
    ): Promise<DiffusionModelClient> {
        if (modelJSONPath) {
            await validateModelPath(modelJSONPath);
        }
        return new DiffusionModelClient(workerUrl, modelJSONPath, modelConfig, domainRange);
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

        console.log('[Diffusion Pool] Sending message:', { type, requestId, timestamp: Date.now() });
        worker.postMessage({ requestId, type, data });

        return { requestId, promise };
    }

    /**
     * Cancel a request by ID.
     */
    stopRequest(requestId: string): void {
        const worker = requestIdToWorker.get(requestId);
        if (worker) {
            console.log('[Diffusion Pool] Sending stop request:', requestId);
            worker.postMessage({ requestId, type: 'stop' });
            cleanup(requestId);
        }
    }

    // ===== SAMPLING METHODS =====

    /**
     * Sample trajectories from random Gaussian initial points.
     */
    sample(
        numSamples: number,
        numberOfSteps: number = 100,
        options: DiffusionSamplingOptions = {},
        perStepCallback?: PerStepCallback
    ): RequestResult<number[][][]> {
        return this.dispatch<number[][][]>(
            'sample',
            {
                modelJSONPath: this.modelJSONPath,
                trainingObjective: 'Diffusion',
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
     */
    sampleFromInitialPoints(
        initialPoints: number[][],
        numberOfSteps: number = 100,
        options: DiffusionSamplingOptions = {},
        perStepCallback?: PerStepCallback
    ): RequestResult<number[][][]> {
        return this.dispatch<number[][][]>(
            'sample_from_initial_points',
            {
                modelJSONPath: this.modelJSONPath,
                trainingObjective: 'Diffusion',
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
     */
    sampleGrid(
        gridResolution: number,
        domainRange: DomainRange,
        numberOfSteps: number = 100,
        options: DiffusionSamplingOptions = {},
        perStepCallback?: PerStepCallback
    ): RequestResult<number[][][]> {
        return this.dispatch<number[][][]>(
            'sample_grid',
            {
                modelJSONPath: this.modelJSONPath,
                trainingObjective: 'Diffusion',
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

    // ===== TRAINING METHODS =====

    /**
     * Train a diffusion model from scratch.
     */
    train(
        datasetPath: string,
        trainingConfig: DiffusionTrainingConfig,
        onEpoch?: EpochCallback
    ): RequestResult<TrainingResult> {
        return this.dispatch<TrainingResult>(
            'train',
            {
                trainingObjective: 'Diffusion',
                modelConfig: this.modelConfig,
                datasetPath,
                trainingConfig
            },
            { onEpoch }
        );
    }
}
