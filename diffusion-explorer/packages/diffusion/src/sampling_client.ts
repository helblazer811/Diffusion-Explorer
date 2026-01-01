import { SchedulerType } from './schedulers';

type SamplingType = 'sample' | 'sample_from_initial_points' | 'sample_grid' | 'vector_field_grid';

interface SamplingOptions {
    cond?: number[] | any;
    guidanceScale?: number;
    return_guidance?: boolean;
    scheduler?: SchedulerType;
}

interface SamplingMessageData {
    modelJSONPath: string;
    trainingObjective: string;
    modelConfig: object;
    numSamples?: number;
    initialPoints?: number[][];
    gridResolution?: number;
    numberOfSteps?: number;
    timeValue?: number;
    domainRange?: { xMin: number, xMax: number; yMin: number, yMax: number };
    options?: SamplingOptions;
    streaming?: boolean;
}

// ===== Module-level state for singleton worker =====

type SamplingCallbacks = {
    callback: (allSamples: any, guidance?: any) => void;
    onStep?: (step: number, x_t: number[][]) => void;
};

let samplingWorker: Worker | null = null;
let callbacksByRequestId = new Map<string, SamplingCallbacks>();

/**
 * Lazily creates and returns the singleton sampling worker.
 * Sets up message routing based on requestId.
 */
function getSamplingWorker(samplingWorkerUrl: string): Worker {
    if (samplingWorker) return samplingWorker;

    samplingWorker = new Worker(samplingWorkerUrl, { type: 'module' });

    samplingWorker.onerror = (e) => {
        console.error('[Sampling Worker Error]', {
            message: e.message,
            filename: e.filename,
            lineno: e.lineno,
            colno: e.colno
        });
    };

    samplingWorker.onmessageerror = (e) => {
        console.error('[Sampling Worker Message Error] Failed to deserialize message:', e);
    };

    samplingWorker.onmessage = (e) => {
        const { requestId, type: msgType } = e.data;

        const handlers = callbacksByRequestId.get(requestId);
        if (!handlers) return;

        if (msgType === 'step' && handlers.onStep) {
            handlers.onStep(e.data.step, e.data.x_t);
        }
        else if (msgType === 'result') {
            handlers.callback(e.data.allSamples, e.data.guidance);
            callbacksByRequestId.delete(requestId);
        }
        else if (msgType === 'cancelled') {
            console.log('[Sampling Worker] Request cancelled:', requestId);
            callbacksByRequestId.delete(requestId);
        }
        else if (msgType === 'status') {
            console.log('[Sampling Worker] status:', e.data.message);
        }
        else if (msgType === 'error') {
            console.error('[Sampling Worker] error:', e.data.error);
            callbacksByRequestId.delete(requestId);
        }
    };

    return samplingWorker;
}

/**
 * Send a cancellation signal for a specific sampling request.
 * The worker will stop processing and ignore any pending results.
 *
 * @param requestId - The request ID to cancel
 */
export function stopSamplingRequest(requestId: string): void {
    if (samplingWorker) {
        console.log('[Sampling Client] Sending stop request:', requestId);
        samplingWorker.postMessage({ requestId, type: 'stop' });
        callbacksByRequestId.delete(requestId);
    }
}

/**
 * Internal helper to communicate with the singleton sampling worker.
 *
 * Uses a lazily-created shared worker and routes responses based on
 * requestId. Optionally supports streaming per-step updates via onStep.
 *
 * @param samplingWorkerUrl - URL to the sampling worker script
 * @param type - Type of sampling operation to perform
 * @param data - Configuration data for the sampling operation
 * @param callback - Callback receiving sampled results
 * @param onStep - Optional callback invoked after each integration step
 * @returns The request ID for this sampling operation (can be used with stopSamplingRequest)
 */
function callSamplingWorker(
    samplingWorkerUrl: string,
    type: SamplingType,
    data: SamplingMessageData,
    callback: (allSamples: any, guidance?: any) => void,
    onStep?: (step: number, x_t: number[][]) => void
): string {
    const worker = getSamplingWorker(samplingWorkerUrl);
    const requestId = crypto.randomUUID();

    // Register callbacks for this request
    callbacksByRequestId.set(requestId, { callback, onStep });

    // Enable streaming if onStep callback is provided
    const messageData = onStep ? { ...data, streaming: true } : data;

    console.log('[Sampling Worker] Sending message:', { type, requestId, timestamp: Date.now() });
    worker.postMessage({ requestId, type, data: messageData });

    return requestId;
}

/**
 * Sample trajectories from random Gaussian initial points.
 *
 * Generates `numSamples` random points from a standard Gaussian distribution
 * and integrates them through the learned flow to produce trajectories.
 *
 * @param samplingWorkerUrl - URL to the sampling worker script
 * @param modelJSONPath - Path to the saved model (file path or IndexedDB URL)
 * @param trainingObjective - Training objective ('Flow Matching', 'Diffusion', etc.)
 * @param modelConfig - Model configuration object with dim and hidden size
 * @param numSamples - Number of random samples to generate
 * @param numberOfSteps - Number of integration steps for the ODE solver
 * @param callback - Callback receiving trajectories [timestep][sample][dim]
 * @param domainRange - Optional domain bounds for clipping
 * @param options - Optional sampling parameters (conditioning, guidance)
 * @param onStep - Optional callback invoked after each integration step for streaming
 * @returns The request ID for this sampling operation (can be used with stopSamplingRequest)
 */
export function callSamplingWorkerThread(
    samplingWorkerUrl: string,
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    numSamples: number,
    numberOfSteps: number,
    callback: (allSamples: any, guidance?: any) => void,
    domainRange: { xMin: number, xMax: number; yMin: number, yMax: number } | null = null,
    options: SamplingOptions = {},
    onStep?: (step: number, x_t: number[][]) => void
): string {
    return callSamplingWorker(
        samplingWorkerUrl,
        'sample',
        {
            modelJSONPath,
            trainingObjective,
            modelConfig,
            numSamples,
            numberOfSteps,
            domainRange,
            options
        },
        callback,
        onStep
    );
}

/**
 * Sample trajectories from specified initial points.
 *
 * Takes an array of initial points and integrates each through the learned
 * flow to produce trajectories. Useful for visualizing flow from specific
 * locations or for interactive click-to-sample functionality.
 *
 * @param samplingWorkerUrl - URL to the sampling worker script
 * @param modelJSONPath - Path to the saved model (file path or IndexedDB URL)
 * @param trainingObjective - Training objective ('Flow Matching', 'Diffusion', etc.)
 * @param modelConfig - Model configuration object with dim and hidden size
 * @param initialPoints - Array of starting points [[x, y], ...] to integrate
 * @param numberOfSteps - Number of integration steps for the ODE solver
 * @param callback - Callback receiving trajectories [timestep][sample][dim]
 * @param domainRange - Optional domain bounds for clipping
 * @param options - Optional sampling parameters (conditioning, guidance)
 * @param onStep - Optional callback invoked after each integration step for streaming
 * @returns The request ID for this sampling operation (can be used with stopSamplingRequest)
 */
export function callSamplingWorkerThreadFromInitialPoints(
    samplingWorkerUrl: string,
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    initialPoints: number[][],
    numberOfSteps: number,
    callback: (allSamples: any, guidance?: any) => void,
    domainRange: { xMin: number, xMax: number; yMin: number, yMax: number } | null = null,
    options: SamplingOptions = {},
    onStep?: (step: number, x_t: number[][]) => void
): string {
    return callSamplingWorker(
        samplingWorkerUrl,
        'sample_from_initial_points',
        {
            modelJSONPath,
            trainingObjective,
            modelConfig,
            initialPoints,
            numberOfSteps,
            domainRange,
            options
        },
        callback,
        onStep
    );
}

/**
 * Sample trajectories from a uniform grid of initial points.
 *
 * Creates a uniform grid of points within the specified domain and integrates
 * each through the learned flow. Useful for visualizing how the flow transforms
 * space uniformly across the domain.
 *
 * @param samplingWorkerUrl - URL to the sampling worker script
 * @param modelJSONPath - Path to the saved model (file path or IndexedDB URL)
 * @param trainingObjective - Training objective ('Flow Matching', 'Diffusion', etc.)
 * @param modelConfig - Model configuration object with dim and hidden size
 * @param gridResolution - Number of points along each axis (total = gridResolution^2)
 * @param numberOfSteps - Number of integration steps for the ODE solver
 * @param domainRange - Domain bounds defining the grid extent
 * @param callback - Callback receiving trajectories [timestep][sample][dim]
 * @param options - Optional sampling parameters (conditioning, guidance)
 * @param onStep - Optional callback invoked after each integration step for streaming
 * @returns The request ID for this sampling operation (can be used with stopSamplingRequest)
 */
export function callSamplingWorkerThreadGrid(
    samplingWorkerUrl: string,
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    gridResolution: number,
    numberOfSteps: number,
    domainRange: { xMin: number, xMax: number; yMin: number, yMax: number },
    callback: (allSamples: any, guidance?: any) => void,
    options: SamplingOptions = {},
    onStep?: (step: number, x_t: number[][]) => void
): string {
    return callSamplingWorker(
        samplingWorkerUrl,
        'sample_grid',
        {
            modelJSONPath,
            trainingObjective,
            modelConfig,
            gridResolution,
            numberOfSteps,
            domainRange,
            options
        },
        callback,
        onStep
    );
}

/**
 * Sample vector field values on a uniform grid
 *
 * This evaluates the model's forward function (velocity field) at each point
 * on a uniform grid, without performing any ODE integration. Useful for
 * visualizing flow fields.
 *
 * @param modelJSONPath - Path to the saved model in IndexedDB
 * @param trainingObjective - Training objective ('Flow Matching', etc.)
 * @param modelConfig - Model configuration object
 * @param gridResolution - Number of points along each axis
 * @param domainRange - Spatial domain to sample
 * @param callback - Callback receiving velocity vectors [gridRes*gridRes, dim]
 * @param timeValue - Time value at which to evaluate the field (default: 0.5)
 * @param options - Optional sampling parameters
 * @returns The request ID for this sampling operation (can be used with stopSamplingRequest)
 */
export function callSamplingWorkerThreadVectorFieldGrid(
    samplingWorkerUrl: string,
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    gridResolution: number,
    domainRange: { xMin: number, xMax: number; yMin: number, yMax: number },
    callback: (velocities: number[][][]) => void,
    timeValue: number = 0.5,
    options: SamplingOptions = {}
): string {
    return callSamplingWorker(
        samplingWorkerUrl,
        'vector_field_grid',
        {
            modelJSONPath,
            trainingObjective,
            modelConfig,
            gridResolution,
            timeValue,
            domainRange,
            options
        },
        callback
    );
}