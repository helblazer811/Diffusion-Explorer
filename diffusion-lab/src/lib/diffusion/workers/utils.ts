
export function callSamplingWorkerThread(
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    numSamples: number,
    numberOfSteps: number,
    callback: Function,
) {
    // Create the worker
    const samplingWorker = new Worker(
        new URL('./sampling.worker.ts', import.meta.url), // NOTE: This needs to be a relative path
        { type: 'module' }
    );
    // Add a listener to the sampling worker thread to receive the samples
    samplingWorker.onmessage = (e) => {
        const { type, result: res } = e.data;
        if (type === 'result') {
            callback(e.data.allSamples);
        } else if (type === 'status') {
            console.log('Worker status:', e.data.message);
        } else if (type === 'error') {
            console.error('Worker error:', e.data.message);
        }
    };
    // Call the dummy worker thread 
    console.log("Calling the worker thread to sample...");
    // Send a message
    samplingWorker.postMessage({
        type: 'sample',
        data: {
            modelJSONPath: modelJSONPath,
            trainingObjective: trainingObjective,
            modelConfig: modelConfig,
            numSamples: numSamples,
            numberOfSteps: numberOfSteps,
        }
    });
}

export function callSamplingWorkerThreadFromInitialPoints(
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    initialPoints: number[][],
    numberOfSteps: number,
    callback: Function,
) {
    // Create the worker
    const samplingWorker = new Worker(
        new URL('./sampling.worker.ts', import.meta.url), // NOTE: This needs to be a relative path
        { type: 'module' }
    );
    // Add a listener to the sampling worker thread to receive the samples
    samplingWorker.onmessage = (e) => {
        const { type, result: res } = e.data;
        if (type === 'result') {
            callback(e.data.allSamples);
        } else if (type === 'status') {
            console.log('Worker status:', e.data.message);
        } else if (type === 'error') {
            console.error('Worker error:', e.data.message);
        }
    };
    // Call the dummy worker thread 
    console.log("Calling the worker thread to sample...");
    // Send a message
    samplingWorker.postMessage({
        type: 'sample_from_initial_points',
        data: {
            modelJSONPath: modelJSONPath,
            trainingObjective: trainingObjective,
            modelConfig: modelConfig,
            initialPoints: initialPoints,
            numberOfSteps: numberOfSteps,
        }
    });
}