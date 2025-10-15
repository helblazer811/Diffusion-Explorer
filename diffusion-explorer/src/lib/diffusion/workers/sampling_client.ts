type SamplingType = 'sample' | 'sample_from_initial_points' | 'sample_grid';

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
    numberOfSteps: number;
    domainRange: { xMin: number, xMax: number; yMin: number, yMax: number };
    distributionWidth: number;
    displayAreaWidth: number;
    options?: SamplingOptions;
}

function callWorker(
    workerUrl: string,
    type: SamplingType,
    data: SamplingMessageData,
    callback: (allSamples: any, guidance?: any) => void
) {
    const worker = new Worker(new URL(workerUrl, import.meta.url), { type: 'module' });

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
    return worker;
}

// Lightweight wrappers
export function callSamplingWorkerThread(
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    numSamples: number,
    numberOfSteps: number,
    domainRange: { xMin: number, xMax: number; yMin: number, yMax: number },
    distributionWidth: number,
    displayAreaWidth: number,
    callback: (allSamples: any, guidance?: any) => void,
    classes?: number[],
    return_guidance?: boolean
) {
    const options: SamplingOptions = {};
    if (classes !== undefined) options.cond = classes;
    if (return_guidance !== undefined) options.return_guidance = return_guidance;
    
    return callWorker('./sampling.worker.ts', 'sample', {
        modelJSONPath,
        trainingObjective,
        modelConfig,
        numSamples,
        numberOfSteps,
        domainRange,
        distributionWidth,
        displayAreaWidth,
        options
    }, callback);
}

export function callSamplingWorkerThreadFromInitialPoints(
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    initialPoints: number[][],
    numberOfSteps: number,
    domainRange: { xMin: number, xMax: number; yMin: number, yMax: number },
    distributionWidth: number,
    displayAreaWidth: number,
    callback: (allSamples: any, guidance?: any) => void,
    classes?: number[],
    return_guidance?: boolean
) {
    const options: SamplingOptions = {};
    if (classes !== undefined) options.cond = classes;
    if (return_guidance !== undefined) options.return_guidance = return_guidance;
    
    return callWorker('./sampling.worker.ts', 'sample_from_initial_points', {
        modelJSONPath,
        trainingObjective,
        modelConfig,
        initialPoints,
        numberOfSteps,
        domainRange,
        distributionWidth,
        displayAreaWidth,
        options
    }, callback);
}

export function callSamplingWorkerThreadGrid(
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    gridResolution: number,
    numberOfSteps: number,
    domainRange: { xMin: number, xMax: number; yMin: number, yMax: number },
    distributionWidth: number,
    displayAreaWidth: number,
    callback: (allSamples: any, guidance?: any) => void,
    classes?: number[],
    return_guidance?: boolean
) {
    const options: SamplingOptions = {};
    if (classes !== undefined) options.cond = classes;
    if (return_guidance !== undefined) options.return_guidance = return_guidance;
    
    return callWorker('./sampling.worker.ts', 'sample_grid', {
        modelJSONPath,
        trainingObjective,
        modelConfig,
        gridResolution,
        numberOfSteps,
        domainRange,
        distributionWidth,
        displayAreaWidth,
        options
    }, callback);
}