import { SchedulerType } from './schedulers';

// ===== Types =====

type SamplingType = 'sample' | 'sample_from_initial_points' | 'sample_grid' | 'vector_field_grid';

export interface SamplingOptions {
    cond?: number[] | any;
    guidanceScale?: number;
    return_guidance?: boolean;
    scheduler?: SchedulerType;
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
}

type PerStepCallback = (step: number, x_t: number[][]) => void;

export interface SamplingResult<T> {
    requestId: string;
    promise: Promise<T>;
}

interface SamplingMessageData {
    modelJSONPath: string;
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
}

// ===== Module-level state for worker pool =====

let poolSize = 5;

type SamplingCallbacks = {
    callback: (allSamples: any, guidance?: any) => void;
    onStep?: PerStepCallback;
};

let workerPool: Worker[] = [];
let workerPoolUrl: string | null = null;
let nextWorkerIndex = 0;
let callbacksByRequestId = new Map<string, SamplingCallbacks>();
let requestIdToWorker = new Map<string, Worker>();

/**
 * Create a message handler for a worker in the pool.
 * All workers share the same routing logic based on requestId.
 */
function createMessageHandler(workerIndex: number) {
    return (e: MessageEvent) => {
        const { requestId, type: msgType } = e.data;

        const handlers = callbacksByRequestId.get(requestId);
        if (!handlers) return;

        if (msgType === 'step' && handlers.onStep) {
            handlers.onStep(e.data.step, e.data.x_t);
        }
        else if (msgType === 'result') {
            handlers.callback(e.data.allSamples, e.data.guidance);
            callbacksByRequestId.delete(requestId);
            requestIdToWorker.delete(requestId);
        }
        else if (msgType === 'cancelled') {
            console.log(`[Sampling Worker ${workerIndex}] Request cancelled:`, requestId);
            callbacksByRequestId.delete(requestId);
            requestIdToWorker.delete(requestId);
        }
        else if (msgType === 'status') {
            console.log(`[Sampling Worker ${workerIndex}] status:`, e.data.message);
        }
        else if (msgType === 'error') {
            console.error(`[Sampling Worker ${workerIndex}] error:`, e.data.error);
            callbacksByRequestId.delete(requestId);
            requestIdToWorker.delete(requestId);
        }
    };
}

/**
 * Lazily creates and returns the worker pool.
 * All workers share the same message routing logic.
 */
function initializeWorkerPool(samplingWorkerUrl: string): void {
    // Already initialized with same URL
    if (workerPool.length > 0 && workerPoolUrl === samplingWorkerUrl) return;

    // Different URL - terminate old workers and create new pool
    if (workerPoolUrl !== samplingWorkerUrl && workerPool.length > 0) {
        workerPool.forEach(w => w.terminate());
        workerPool = [];
    }

    workerPoolUrl = samplingWorkerUrl;

    for (let i = 0; i < poolSize; i++) {
        const worker = new Worker(samplingWorkerUrl, { type: 'module' });

        worker.onerror = (e) => {
            console.error(`[Sampling Worker ${i} Error]`, {
                message: e.message,
                filename: e.filename,
                lineno: e.lineno,
                colno: e.colno
            });
        };

        worker.onmessageerror = (e) => {
            console.error(`[Sampling Worker ${i} Message Error] Failed to deserialize message:`, e);
        };

        // All workers share the same onmessage handler pattern
        worker.onmessage = createMessageHandler(i);

        workerPool.push(worker);
    }

    console.log(`[Sampling Pool] Initialized ${poolSize} workers`);
}

/**
 * Get next worker from pool using round-robin.
 */
function getNextWorker(samplingWorkerUrl: string): Worker {
    initializeWorkerPool(samplingWorkerUrl);

    const worker = workerPool[nextWorkerIndex];
    nextWorkerIndex = (nextWorkerIndex + 1) % workerPool.length;
    return worker;
}

/**
 * Set the worker pool size. Must be called before any sampling operations.
 * @param size Number of workers in the pool (default: 5)
 */
export function setSamplingPoolSize(size: number): void {
    if (workerPool.length > 0) {
        console.warn('[Sampling Pool] Cannot change pool size after initialization');
        return;
    }
    poolSize = size;
}

/**
 * Send a cancellation signal for a specific sampling request.
 * Looks up the correct worker and sends the stop message to it.
 *
 * @param requestId - The request ID to cancel
 */
function stopSamplingRequest(requestId: string): void {
    const worker = requestIdToWorker.get(requestId);
    if (worker) {
        console.log('[Sampling Pool] Sending stop request:', requestId);
        worker.postMessage({ requestId, type: 'stop' });
        callbacksByRequestId.delete(requestId);
        requestIdToWorker.delete(requestId);
    }
}

/**
 * Internal helper to communicate with the worker pool.
 *
 * Uses round-robin to select a worker from the pool and routes responses
 * based on requestId. Optionally supports streaming per-step updates via onStep.
 */
function callSamplingWorker(
    samplingWorkerUrl: string,
    type: SamplingType,
    data: SamplingMessageData,
    callback: (allSamples: any, guidance?: any) => void,
    onStep?: PerStepCallback
): string {
    const worker = getNextWorker(samplingWorkerUrl);
    const requestId = crypto.randomUUID();

    // Register callbacks and track which worker has this request
    callbacksByRequestId.set(requestId, { callback, onStep });
    requestIdToWorker.set(requestId, worker);

    // Enable streaming if onStep callback is provided
    const messageData = onStep ? { ...data, streaming: true } : data;

    console.log('[Sampling Pool] Sending message:', { type, requestId, timestamp: Date.now() });
    worker.postMessage({ requestId, type, data: messageData });

    return requestId;
}

// ===== FlowModelClient Class =====

/**
 * Client for sampling from a trained flow model using web workers.
 *
 * Provides a clean, class-based API for flow-based sampling operations.
 * Uses a shared worker pool for efficient parallel processing.
 *
 * @example
 * ```typescript
 * const client = new FlowModelClient(
 *   '/workers/sampling.worker.js',
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
     * @param workerUrl - URL to the sampling worker script
     * @param modelJSONPath - Path to the saved model (file path or IndexedDB URL)
     * @param trainingObjective - Training objective ('Flow Matching', 'Diffusion', etc.)
     * @param modelConfig - Model configuration object with dim and hidden size
     * @param domainRange - Optional domain bounds for clipping
     */
    constructor(
        workerUrl: string,
        modelJSONPath: string,
        trainingObjective: string = "Flow Matching",
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
     * Cancel a sampling request by ID.
     *
     * @param requestId - The request ID to cancel (from a previous sampling call)
     */
    stopRequest(requestId: string): void {
        stopSamplingRequest(requestId);
    }

    /**
     * Sample trajectories from random Gaussian initial points.
     *
     * Generates `numSamples` random points from a standard Gaussian distribution
     * and integrates them through the learned flow to produce trajectories.
     *
     * @param numSamples - Number of random samples to generate
     * @param numberOfSteps - Number of integration steps for the ODE solver
     * @param options - Optional sampling parameters (conditioning, guidance, scheduler)
     * @param perStepCallback - Optional callback invoked after each integration step
     * @returns Object with requestId (for cancellation) and promise (resolves to trajectories)
     */
    sample(
        numSamples: number,
        numberOfSteps: number = 100,
        options: SamplingOptions = {},
        perStepCallback?: PerStepCallback
    ): SamplingResult<number[][][]> {
        let resolvePromise: (value: number[][][]) => void;
        const promise = new Promise<number[][][]>((resolve) => {
            resolvePromise = resolve;
        });

        const requestId = callSamplingWorker(
            this.workerUrl,
            'sample',
            {
                modelJSONPath: this.modelJSONPath,
                trainingObjective: this.trainingObjective,
                modelConfig: this.modelConfig,
                numSamples,
                numberOfSteps,
                domainRange: this.domainRange ?? undefined,
                options
            },
            (allSamples) => resolvePromise(allSamples),
            perStepCallback
        );

        return { requestId, promise };
    }

    /**
     * Sample trajectories from specified initial points.
     *
     * Takes an array of initial points and integrates each through the learned
     * flow to produce trajectories. Useful for visualizing flow from specific
     * locations or for interactive click-to-sample functionality.
     *
     * @param initialPoints - Array of starting points [[x, y], ...] to integrate
     * @param numberOfSteps - Number of integration steps for the ODE solver
     * @param options - Optional sampling parameters (conditioning, guidance, scheduler)
     * @param perStepCallback - Optional callback invoked after each integration step
     * @returns Object with requestId (for cancellation) and promise (resolves to trajectories)
     */
    sampleFromInitialPoints(
        initialPoints: number[][],
        numberOfSteps: number = 100,
        options: SamplingOptions = {},
        perStepCallback?: PerStepCallback
    ): SamplingResult<number[][][]> {
        let resolvePromise: (value: number[][][]) => void;
        const promise = new Promise<number[][][]>((resolve) => {
            resolvePromise = resolve;
        });

        const requestId = callSamplingWorker(
            this.workerUrl,
            'sample_from_initial_points',
            {
                modelJSONPath: this.modelJSONPath,
                trainingObjective: this.trainingObjective,
                modelConfig: this.modelConfig,
                initialPoints,
                numberOfSteps,
                domainRange: this.domainRange ?? undefined,
                options
            },
            (allSamples) => resolvePromise(allSamples),
            perStepCallback
        );

        return { requestId, promise };
    }

    /**
     * Sample trajectories from a uniform grid of initial points.
     *
     * Creates a uniform grid of points within the specified domain and integrates
     * each through the learned flow. Useful for visualizing how the flow transforms
     * space uniformly across the domain.
     *
     * @param gridResolution - Number of points along each axis (total = gridResolution^2)
     * @param domainRange - Domain bounds defining the grid extent
     * @param numberOfSteps - Number of integration steps for the ODE solver
     * @param options - Optional sampling parameters (conditioning, guidance, scheduler)
     * @param perStepCallback - Optional callback invoked after each integration step
     * @returns Object with requestId (for cancellation) and promise (resolves to trajectories)
     */
    sampleGrid(
        gridResolution: number,
        domainRange: DomainRange,
        numberOfSteps: number = 100,
        options: SamplingOptions = {},
        perStepCallback?: PerStepCallback
    ): SamplingResult<number[][][]> {
        let resolvePromise: (value: number[][][]) => void;
        const promise = new Promise<number[][][]>((resolve) => {
            resolvePromise = resolve;
        });

        const requestId = callSamplingWorker(
            this.workerUrl,
            'sample_grid',
            {
                modelJSONPath: this.modelJSONPath,
                trainingObjective: this.trainingObjective,
                modelConfig: this.modelConfig,
                gridResolution,
                numberOfSteps,
                domainRange,
                options
            },
            (allSamples) => resolvePromise(allSamples),
            perStepCallback
        );

        return { requestId, promise };
    }

    /**
     * Sample vector field values on a uniform grid.
     *
     * This evaluates the model's forward function (velocity field) at each point
     * on a uniform grid, without performing any ODE integration. Useful for
     * visualizing flow fields.
     *
     * @param gridResolution - Number of points along each axis
     * @param domainRange - Spatial domain to sample
     * @param timeValue - Time value at which to evaluate the field (default: 0.5)
     * @param options - Optional sampling parameters
     * @returns Object with requestId (for cancellation) and promise (resolves to velocities)
     */
    vectorFieldGrid(
        gridResolution: number,
        domainRange: DomainRange,
        timeValue: number = 0.5,
        options: SamplingOptions = {}
    ): SamplingResult<number[][][]> {
        let resolvePromise: (value: number[][][]) => void;
        const promise = new Promise<number[][][]>((resolve) => {
            resolvePromise = resolve;
        });

        const requestId = callSamplingWorker(
            this.workerUrl,
            'vector_field_grid',
            {
                modelJSONPath: this.modelJSONPath,
                trainingObjective: this.trainingObjective,
                modelConfig: this.modelConfig,
                gridResolution,
                timeValue,
                domainRange,
                options
            },
            (velocities) => resolvePromise(velocities)
        );

        return { requestId, promise };
    }
}
