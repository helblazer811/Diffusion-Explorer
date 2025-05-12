/*
*    Web worker that runs training for a given model. 
*/ 
import { FlowModel } from '$lib/diffusion/flow_matching';
import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
setWasmPaths('/tfjs-backend-wasm/');
import '@tensorflow/tfjs-backend-wasm'; // Import the WebGL backend for TensorFlow.js

const modelTypeToModelClass = {
    'Flow Matching': FlowModel,
};

async function loadDataset(path: string) {
    return fetch(path)
        .then(response => response.json())
        .then(data => {
            // Convert the data to a tensor
            const pointsTensor = tf.tensor(data.points);
            return pointsTensor;
        });
}

self.onmessage = async (e) => {
    const { type, data } = e.data;
    // Destructure the data
    const { modelType, modelConfig, datasetPath, trainingConfig } = data;

    if (type === 'train') {
        // Set up tf wasm backend
        await tf.setBackend('wasm');
        await tf.ready();
        // Initialize the empty model 
        const ModelClass = modelTypeToModelClass[modelType];
        const ourModel = new ModelClass(
            modelConfig.dim,
            modelConfig.hidden,
        );
        // Load the dataset
        const pointsTensor = await loadDataset(datasetPath);
        // Run training
        ourModel.train(
            pointsTensor,
            trainingConfig["iterations"],
            trainingConfig["batchSize"],
        )
        // Save the model in the browser IndexedDB
        const modelSaveName = 'indexeddb://' + modelType.replace(/\s+/g, '_') + '_' + Date.now();
        // Pull out just the tf model to save
        const tfModel = ourModel.model;
        // Save the model to IndexedDB
        await tfModel.save(modelSaveName);
        // Return the result to the main thread
        self.postMessage({ 
            type: 'result', 
            tfModelPath: modelSaveName,
            // allSamples: allSamplesArray,
        });
    } else {
        console.error('Unknown message type:', type);
    }
};
