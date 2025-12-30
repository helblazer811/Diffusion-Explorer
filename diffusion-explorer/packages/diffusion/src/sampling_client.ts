
type SamplingType = 'sample' | 'sample_from_initial_points' | 'sample_grid' | 'vector_field_grid';

interface SamplingOptions {
    cond?: number[] | any;
    guidanceScale?: number;
    return_guidance?: boolean;
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

/**
 * Internal helper to create and communicate with a sampling worker.
 *
 * Creates a new Web Worker, sends a sampling request, and routes
 * responses to the provided callback. Optionally supports streaming
 * per-step updates via the onStep callback.
 *
 * @param samplingWorkerUrl - URL to the sampling worker script
 * @param type - Type of sampling operation to perform
 * @param data - Configuration data for the sampling operation
 * @param callback - Callback receiving sampled results
 * @param onStep - Optional callback invoked after each integration step
 * @returns The created Worker instance
 */
function callSamplingWorker(
    samplingWorkerUrl: string,
    type: SamplingType,
    data: SamplingMessageData,
    callback: (allSamples: any, guidance?: any) => void,
    onStep?: (step: number, x_t: number[][]) => void
) {
    const worker = new Worker(samplingWorkerUrl, { type: 'module' });

    // Enable streaming if onStep callback is provided
    const messageData = onStep ? { ...data, streaming: true } : data;

    worker.onmessage = (e) => {
        const { type: msgType } = e.data;
        if (msgType === 'step' && onStep) {
            onStep(e.data.step, e.data.x_t);
        } else if (msgType === 'result') {
            callback(e.data.allSamples, e.data.guidance);
        } else if (msgType === 'status') {
            console.log('Worker status:', e.data.message);
        } else if (msgType === 'error') {
            console.error('Worker error:', e.data.error);
        }
    };
    worker.postMessage({ type, data: messageData });
    return worker;
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
 * @returns The created Worker instance
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
) {
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
 * @returns The created Worker instance
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
) {
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
 * @returns The created Worker instance
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
) {
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
) {
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