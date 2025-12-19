
import { samplingWorkerUrl } from './index';

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
}

function callWorker(
    type: SamplingType,
    data: SamplingMessageData,
    callback: (allSamples: any, guidance?: any) => void
) {
    const worker = new Worker(samplingWorkerUrl, { type: 'module' });
    console.log(samplingWorkerUrl)

    worker.onmessage = (e) => {
        const { type: msgType } = e.data;
        if (msgType === 'result') {
            callback(e.data.allSamples, e.data.guidance);
        } else if (msgType === 'status') {
            console.log('Worker status:', e.data.message);
        } else if (msgType === 'error') {
            console.error('Worker error:', e.data.message);
        }
    };
    worker.postMessage({ type, data });
    console.log(worker);
    return worker;
}

// Lightweight wrappers
export function callSamplingWorkerThread(
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    numSamples: number,
    numberOfSteps: number,
    callback: (allSamples: any, guidance?: any) => void,
    domainRange: { xMin: number, xMax: number; yMin: number, yMax: number } | null = null,
    options: SamplingOptions = {}
) {
    return callWorker(
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
        callback
    );
}

export function callSamplingWorkerThreadFromInitialPoints(
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    initialPoints: number[][],
    numberOfSteps: number,
    callback: (allSamples: any, guidance?: any) => void,
    domainRange: { xMin: number, xMax: number; yMin: number, yMax: number } | null = null,
    options: SamplingOptions = {}
) {
    return callWorker(
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
        callback
    );
}

export function callSamplingWorkerThreadGrid(
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    gridResolution: number,
    numberOfSteps: number,
    domainRange: { xMin: number, xMax: number; yMin: number, yMax: number },
    callback: (allSamples: any, guidance?: any) => void,
    options: SamplingOptions = {}
) {
    return callWorker(
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
        callback
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
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    gridResolution: number,
    domainRange: { xMin: number, xMax: number; yMin: number, yMax: number },
    callback: (velocities: number[][][]) => void,
    timeValue: number = 0.5,
    options: SamplingOptions = {}
) {
    return callWorker(
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