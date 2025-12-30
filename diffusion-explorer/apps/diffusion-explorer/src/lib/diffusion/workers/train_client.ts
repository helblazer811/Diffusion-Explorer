import { trainWorkerUrl } from '../index';

export function callTrainingWorkerThread(
    trainingObjective: string,
    modelConfig: object,
    datasetPath: string,
    trainingConfig: object,
    finishCallback: Function,
    epochCallback: Function
) {
    // Assert worker URL exists
    if (!trainWorkerUrl) {
        throw new Error(`Training worker URL is undefined or null: ${trainWorkerUrl}`);
    }
    console.log('Creating training worker with URL:', trainWorkerUrl);

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
            epochCallback(e.data.epoch, e.data.intermediateSamples);
        } else if (type === 'status') {
            console.log('Worker status:', e.data.message);
        } else if (type === 'error') {
            console.error('Worker error:', e.data.message);
        }
    };
    // Call the dummy worker thread 
    // Send a message
    console.log('Sending training config to worker thread...');
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