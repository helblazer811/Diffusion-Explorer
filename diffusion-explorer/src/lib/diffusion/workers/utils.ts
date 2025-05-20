
import * as tf from '@tensorflow/tfjs';

export function convertDataToDisplayCoordinateFrame(
    data: tf.Tensor, // shape: [T, N, 2]
    domainRange: { xMin: number, xMax: number, yMin: number, yMax: number },
    distributionWidth: number,
    displayAreaWidth: number,
    numSteps: number,
): tf.Tensor {
    return tf.tidy(() => {
        const min = tf.tensor([domainRange.xMin, domainRange.yMin]);
        const range = tf.tensor([domainRange.xMax - domainRange.xMin, domainRange.yMax - domainRange.yMin]);
        const offsetScale = tf.tensor([displayAreaWidth - distributionWidth, 0]);

        const dataNorm = data.sub(min).div(range);           // [T, N, 2]
        const dataScaled = dataNorm.mul(distributionWidth);  // [T, N, 2]

        const time = tf.linspace(0, 1, numSteps).reshape([numSteps, 1, 1]); // [T, 1, 1]
        const offset = time.mul(offsetScale);                // [T, 1, 2]
        const result = dataScaled.add(offset);               // [T, N, 2]

        return result;
    });
}

export function callSamplingWorkerThread(
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    numSamples: number,
    numberOfSteps: number,
    domainRange: { xMin: number, xMax: number, yMin: number, yMax: number },
    distributionWidth: number,
    displayAreaWidth: number,
    callback: Function,
) {
    console.log("Calling the worker thread to sample...");
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
            domainRange: domainRange,
            distributionWidth: distributionWidth,
            displayAreaWidth: displayAreaWidth,
        }
    });
}

export function callSamplingWorkerThreadFromInitialPoints(
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    initialPoints: number[][],
    numberOfSteps: number,
    domainRange: { xMin: number, xMax: number, yMin: number, yMax: number },
    distributionWidth: number,
    displayAreaWidth: number,
    callback: Function,
) {
    console.log("Calling the worker thread to sample from initial points...");
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
            domainRange: domainRange,
            distributionWidth: distributionWidth,
            displayAreaWidth: displayAreaWidth,
        }
    });
}

export function callSamplingWorkerThreadGrid(
    modelJSONPath: string,
    trainingObjective: string,
    modelConfig: object,
    gridResolution: number,
    numberOfSteps: number,
    domainRange: { xMin: number, xMax: number, yMin: number, yMax: number },
    distributionWidth: number,
    displayAreaWidth: number,
    callback: Function,
) {
    console.log("Calling the worker thread to sample a grid...");
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
        type: 'sample_grid',
        data: {
            modelJSONPath: modelJSONPath,
            trainingObjective: trainingObjective,
            modelConfig: modelConfig,
            gridResolution: gridResolution,
            numberOfSteps: numberOfSteps,
            domainRange: domainRange,
            distributionWidth: distributionWidth,
            displayAreaWidth: displayAreaWidth,
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