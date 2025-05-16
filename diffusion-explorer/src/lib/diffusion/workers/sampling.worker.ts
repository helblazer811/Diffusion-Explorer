/*
*    Web worker that runs sampling for a given model. 
*/ 
import * as tf from '@tensorflow/tfjs';
// // TODO Fix wasm implementation
// import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
// setWasmPaths('tfjs-backend-wasm/');
// import '@tensorflow/tfjs-backend-wasm'; // Import the WebGL backend for TensorFlow.js

import { backend, trainingObjectiveToModelClass } from '$lib/settings';

self.onmessage = async (e) => {
    const { type, data } = e.data;
    // Destructure the data
    const modelJSONPath = data.modelJSONPath;
    const trainingObjective = data.trainingObjective;
    const modelConfig = data.modelConfig;
    const numberOfSteps = data.numberOfSteps;
    // Set up the backend
    if (backend === 'wasm') {
        // Set up tf wasm backend
        await tf.setBackend('wasm');
        await tf.ready();
    } else if (backend === 'webgl') {
        // Set up tf wasm backend
        await tf.setBackend('webgl');
        await tf.ready();
    } else {
        throw new Error('Invalid backend specified');
    }
    // Load up the model based on the passed model name
    const ModelClass = trainingObjectiveToModelClass[trainingObjective];
    const ourModel = new ModelClass(
        modelConfig.dim,
        modelConfig.hidden,
    );
    // Load up a model from the given file path
    const tfModel = await tf.loadLayersModel(modelJSONPath);
    // Set the model in the model class
    ourModel.setModel(tfModel);

    if (type === 'sample') {
        const numSamples = data.numSamples; 
        // Run sampling with the model based on data.numberOfSteps and data.numSamples
        const allSamples = ourModel.sample(
            numSamples,
            numberOfSteps,
        ); // shape [num_time_steps, num_samples, dim]
        // Convert the tensor to a 2D array
        const allSamplesArray = allSamples.arraySync();
        // Return the result to the main thread
        self.postMessage({ 
            type: 'result', 
            allSamples: allSamplesArray,
        });
    } else if (type === 'sample_from_initial_points') {
        const initialPoints = data.initialPoints;
        // Convert initial points to a tensor
        const initialPointsTensor = tf.tensor(initialPoints);
        // Run sampling with the model based on data.numberOfSteps and data.numSamples
        const allSamples = ourModel.sample_from_initial_points(
            initialPointsTensor,
            numberOfSteps,
        ); // shape [num_time_steps, num_samples, dim]
        // Convert the tensor to a 2D array
        const allSamplesArray = allSamples.arraySync();
        // Return the result to the main thread
        self.postMessage({ 
            type: 'result', 
            allSamples: allSamplesArray,
        });
    }
};
