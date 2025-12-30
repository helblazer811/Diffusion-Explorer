
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
    // Add listeners that recieve messages from the worker thread on the main thread (client)
    trainingWorker.onmessage = (e) => {
        const { type, result: res } = e.data;
        if (type === 'result') {
            finishCallback(e.data.tfModelPath);
        } else if (type === 'epoch_chunk') {
            // Recieved a chunk of data from the worker thread
            epochCallback(e.data.epoch, e.data.intermediateSamples, e.data.loss);
        } else if (type === 'status') {
            console.log('Worker status:', e.data.message);
        } else if (type === 'error') {
            console.error('Worker error:', e.data.message);
        }
    };
    // Call the dummy worker thread
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
            console.log('Worker status:', e.data.message);
        } else if (type === 'error') {
            console.error('Worker error:', e.data.message);
        }
    };

    // Send message to start rectified flow training
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