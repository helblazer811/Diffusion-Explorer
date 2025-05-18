
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
    // console.log("Calling the worker thread to sample...");
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
    // console.log("Calling the worker thread to sample...");
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

export function callTrainingWorkerThread(
    trainingObjective: string,
    modelConfig: object,
    datasetPath: string,
    trainingConfig: object,
    finishCallback: Function,
    epochCallback: Function
) {
    // Create the worker
    const trainingWorker = new Worker(
        new URL('./train.worker.ts', import.meta.url), // NOTE: This needs to be a relative path
        { type: 'module' }
    );
    // Add listeners that recieve messages from the worker thread on the main thread (client)
    trainingWorker.onmessage = (e) => {
        const { type, result: res } = e.data;
        if (type === 'result') {
            finishCallback(e.data.tfModelPath);
        } else if (type === 'epoch_chunk') {
            // Recieved a chunk of data from the worker thread
            epochCallback(e.data.epoch, e.data.intermediateSamples);
        } else if (type === 'status') {
            console.log('Worker status:', e.data.message);
        } else if (type === 'error') {
            console.error('Worker error:', e.data.message);
        }
    };
    // Call the dummy worker thread 
    // console.log("Calling the worker thread to train...");
    // Send a message
    trainingWorker.postMessage({
        type: 'train',
        data: {
            trainingObjective: trainingObjective,
            modelConfig: modelConfig,
            datasetPath: datasetPath,
            trainingConfig: trainingConfig,
        }
    });
    // Return the worker so that a "stop_training" message can be sent to it
    return trainingWorker;
}