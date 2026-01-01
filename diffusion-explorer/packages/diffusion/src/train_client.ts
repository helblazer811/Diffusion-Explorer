
export function callTrainingWorkerThread(
    trainWorkerUrl: string,
    trainingObjective: string,
    modelConfig: object,
    datasetPath: string,
    trainingConfig: object,
    finishCallback: Function,
    epochCallback: Function
) {
    // Create the worker
    const trainingWorker = new Worker(
        trainWorkerUrl,
        { type: 'module' }
    );

    // Error handler for worker-level errors (script load failures, uncaught exceptions)
    trainingWorker.onerror = (e) => {
        console.error('[Training Worker Error]', {
            message: e.message,
            filename: e.filename,
            lineno: e.lineno,
            colno: e.colno
        });
    };

    // Handler for message deserialization errors
    trainingWorker.onmessageerror = (e) => {
        console.error('[Training Worker Message Error] Failed to deserialize message:', e);
    };

    // Add listeners that receive messages from the worker thread on the main thread (client)
    trainingWorker.onmessage = (e) => {
        const { type, result: res } = e.data;
        if (type === 'result') {
            finishCallback(e.data.tfModelPath);
        } else if (type === 'epoch_chunk') {
            // Received a chunk of data from the worker thread
            epochCallback(e.data.epoch, e.data.intermediateSamples, e.data.loss);
        } else if (type === 'status') {
            console.log('[Training Worker] status:', e.data.message);
        } else if (type === 'error') {
            console.error('[Training Worker] error:', e.data.message);
        }
    };
    // Send a message to start training
    console.log('[Training Worker] Sending message:', { type: 'train', timestamp: Date.now() });
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

export function callRectifiedFlowTrainingWorker(
    trainWorkerUrl: string,
    trainingObjective: string,
    modelConfig: object,
    datasetPath: string,
    rectifiedConfig: object,
    finishCallback: Function,
    epochCallback: Function,
    rectifiedStepCallback: Function
) {
    // Create the worker
    const trainingWorker = new Worker(
        trainWorkerUrl,
        { type: 'module' }
    );

    // Error handler for worker-level errors (script load failures, uncaught exceptions)
    trainingWorker.onerror = (e) => {
        console.error('[Rectified Training Worker Error]', {
            message: e.message,
            filename: e.filename,
            lineno: e.lineno,
            colno: e.colno
        });
    };

    // Handler for message deserialization errors
    trainingWorker.onmessageerror = (e) => {
        console.error('[Rectified Training Worker Message Error] Failed to deserialize message:', e);
    };

    // Add listeners that receive messages from the worker thread
    trainingWorker.onmessage = (e) => {
        const { type } = e.data;
        if (type === 'result') {
            finishCallback(e.data.tfModelPath, e.data.allRectifiedTrajectories);
        } else if (type === 'epoch_chunk') {
            // Received epoch update during a rectified step
            epochCallback(e.data.epoch, e.data.rectifiedStep, e.data.intermediateSamples, e.data.loss);
        } else if (type === 'rectified_step_complete') {
            // Received completion of a rectified step with trajectories
            rectifiedStepCallback(e.data.rectifiedStep, e.data.trajectories);
        } else if (type === 'status') {
            console.log('[Rectified Training Worker] status:', e.data.message);
        } else if (type === 'error') {
            console.error('[Rectified Training Worker] error:', e.data.message);
        }
    };

    // Send message to start rectified flow training
    console.log('[Rectified Training Worker] Sending message:', { type: 'train_rectified', timestamp: Date.now() });
    trainingWorker.postMessage({
        type: 'train_rectified',
        data: {
            trainingObjective: trainingObjective,
            modelConfig: modelConfig,
            datasetPath: datasetPath,
            rectifiedConfig: rectifiedConfig,
        }
    });

    // Return the worker so that a "stop_training" message can be sent to it
    return trainingWorker;
}