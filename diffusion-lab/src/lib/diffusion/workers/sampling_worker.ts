/*
*    Web worker that runs sampling for a given model. 
*/ 
import { FlowModel } from '$lib/diffusion/flow_matching';
import * as tf from '@tensorflow/tfjs';
// // import { base } from '$app/paths';
// import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
// // TODO I manually change DiffusionLab here which is a "temporary" fix
// setWasmPaths('DiffusionLab/tfjs-backend-wasm/');
// import '@tensorflow/tfjs-backend-wasm'; // Import the WebGL backend for TensorFlow.js

const modelTypeToModelClass = {
    'Flow Matching': FlowModel,
};

self.onmessage = async (e) => {
    const { type, data } = e.data;

    if (type === 'sample') {
        const modelJSONPath = data.modelJSONPath;
        const modelType = data.modelType;
        const modelConfig = data.modelConfig;
        const numberOfSteps = data.numberOfSteps;
        const numSamples = data.numSamples;
        // Set up tf wasm backend
        // try {
        //     await tf.setBackend('wasm');
        //     await tf.ready();
        //     console.log('Using WASM backend');
        // } catch (e) {
        //     await tf.setBackend('webgl');
        //     await tf.ready();
        //     console.log('Using WebGL backend');
        // }
        await tf.setBackend('webgl');
        await tf.ready();
        // await tf.setBackend('wasm');
        // await tf.ready();
        // Load up the model based on the passed model name
        const ModelClass = modelTypeToModelClass[modelType];
        const ourModel = new ModelClass(
            modelConfig.dim,
            modelConfig.hidden,
        );
        // Load up a model from the given file path
        const tfModel = await tf.loadLayersModel(modelJSONPath);
        // Set the model in the model class
        ourModel.setModel(tfModel);
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
    }
};
