/*
*    Web worker that runs sampling for a given model. 
*/ 
import * as tf from '@tensorflow/tfjs';
// // TODO Fix wasm implementation
// import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
// setWasmPaths('tfjs-backend-wasm/');
// import '@tensorflow/tfjs-backend-wasm'; // Import the WebGL backend for TensorFlow.js

import { backend, trainingObjectiveToModelClass } from '$lib/settings';
import { convertDataToDisplayCoordinateFrame } from '$lib/diffusion/utils';

self.onmessage = async (e) => {
    const { type, data } = e.data;
    // Destructure the data
    const modelJSONPath = data.modelJSONPath;
    const trainingObjective = data.trainingObjective;
    const modelConfig = data.modelConfig;
    const numberOfSteps = data.numberOfSteps;
    const domainRange = data.domainRange;
    const displayAreaWidth = data.displayAreaWidth;
    const distributionWidth = data.distributionWidth;
    const classes = data.classes; // Optional: can be undefined
    const return_guidance = data.return_guidance || false; // Optional: defaults to false
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
    let ourModel: any;
    if (trainingObjective == 'Conditional Diffusion') {
        ourModel = new ModelClass(
            modelConfig.dim,
            modelConfig.condDim,
            modelConfig.hidden,
        );
    } else {
        ourModel = new ModelClass(
            modelConfig.dim,
            modelConfig.hidden,
        );
    }
    // Load up a model from the given file path
    const tfModel = await tf.loadLayersModel(modelJSONPath);
    // Set the model in the model class
    ourModel.setModel(tfModel);

    if (type === 'sample') {
        const numSamples = data.numSamples; 
        // Run sampling with the model based on data.numberOfSteps and data.numSamples
        let samplingResult: any;
        if (trainingObjective == 'Conditional Diffusion') {
            console.log("Sampling with conditional diffusion model...");
            // Use passed random classes or generate them
            const numClasses = modelConfig.condDim;
            const classesTensor = classes !== undefined 
                ? tf.tensor(classes, undefined, 'int32')
                : tf.randomUniform([numSamples], 0, numClasses, 'int32');
            samplingResult = ourModel.sample(
                numSamples,
                classesTensor,
                numberOfSteps,
                0, // guidanceScale
                return_guidance
            );
        } else {
            samplingResult = ourModel.sample(
                numSamples,
                numberOfSteps,
            );
        }
        
        // Handle the result based on whether guidance is returned
        let allSamples: tf.Tensor3D;
        let guidanceData: any = null;
        
        if (return_guidance && typeof samplingResult === 'object' && samplingResult.traj) {
            // Guidance info was returned
            allSamples = samplingResult.traj;
            guidanceData = {
                epsCond: samplingResult.epsCond ? samplingResult.epsCond.arraySync() : null,
                epsUncond: samplingResult.epsUncond ? samplingResult.epsUncond.arraySync() : null,
                epsHat: samplingResult.epsHat ? samplingResult.epsHat.arraySync() : null,
            };
        } else {
            // Just trajectory was returned
            allSamples = samplingResult;
        }
        
        // Translate the data to the display coordinate frame
        const translatedData = convertDataToDisplayCoordinateFrame(
            allSamples,
            domainRange,
            distributionWidth,
            displayAreaWidth,
            numberOfSteps
        );
        // Convert the tensor to a 2D array
        const allSamplesArray = translatedData.arraySync();
        // Return the result to the main thread
        const resultMessage: any = { 
            type: 'result', 
            allSamples: allSamplesArray,
        };
        
        if (guidanceData) {
            resultMessage.guidance = guidanceData;
        }
        
        self.postMessage(resultMessage);
    } else if (type === 'sample_from_initial_points') {
        const initialPoints = data.initialPoints;
        // Convert initial points to a tensor
        const initialPointsTensor = tf.tensor(initialPoints);
        // Run sampling with the model based on data.numberOfSteps and data.numSamples
        let samplingResult: any;
        if (trainingObjective == 'Conditional Diffusion') {
            // Use passed random classes or generate them
            const numClasses = modelConfig.condDim;
            const classesTensor = classes !== undefined 
                ? tf.tensor(classes, undefined, 'int32')
                : tf.randomUniform([initialPointsTensor.shape[0]], 0, numClasses, 'int32');
            samplingResult = ourModel.sample_from_initial_points(
                initialPointsTensor,
                classesTensor,
                numberOfSteps,
                0, // guidanceScale
                return_guidance
            );
        } else {
            samplingResult = ourModel.sample_from_initial_points(
                initialPointsTensor,
                numberOfSteps,
            );
        }
        
        // Handle the result based on whether guidance is returned
        let allSamples: tf.Tensor3D;
        let guidanceData: any = null;
        
        if (return_guidance && typeof samplingResult === 'object' && samplingResult.traj) {
            // Guidance info was returned
            allSamples = samplingResult.traj;
            guidanceData = {
                epsCond: samplingResult.epsCond ? samplingResult.epsCond.arraySync() : null,
                epsUncond: samplingResult.epsUncond ? samplingResult.epsUncond.arraySync() : null,
                epsHat: samplingResult.epsHat ? samplingResult.epsHat.arraySync() : null,
            };
        } else {
            // Just trajectory was returned
            allSamples = samplingResult;
        }
        
        // Translate the data to the display coordinate frame
        const translatedData = convertDataToDisplayCoordinateFrame(
            allSamples,
            domainRange,
            distributionWidth,
            displayAreaWidth,
            numberOfSteps
        );
        // Convert the tensor to a 2D array
        const allSamplesArray = translatedData.arraySync();
        // Return the result to the main thread
        const resultMessage: any = { 
            type: 'result', 
            allSamples: allSamplesArray,
        };
        
        if (guidanceData) {
            resultMessage.guidance = guidanceData;
        }
        
        self.postMessage(resultMessage);
    } else if (type === "sample_grid") {
        // Sample a uniform grid of the given gridResolution and then sample from those initial points
        const gridResolution = data.gridResolution;
        const domainRange = data.domainRange;
        
        // Call the model's sample_grid function
        let samplingResult: any;
        if (trainingObjective == 'Conditional Diffusion') {
            // Use passed random classes or generate them
            const numClasses = modelConfig.condDim;
            const classesTensor = classes !== undefined 
                ? tf.tensor(classes, undefined, 'int32')
                : tf.randomUniform([gridResolution * gridResolution], 0, numClasses, 'int32');
            samplingResult = ourModel.sample_grid(
                gridResolution,
                domainRange,
                classesTensor,
                numberOfSteps,
                0, // guidanceScale
                return_guidance
            );
        } else {
            samplingResult = ourModel.sample_grid(
                gridResolution,
                domainRange,
                numberOfSteps,
                return_guidance
            );
        }
        
        // Handle the result based on whether guidance is returned
        let allSamples: tf.Tensor3D;
        let guidanceData: any = null;
        
        if (return_guidance && typeof samplingResult === 'object' && samplingResult.traj) {
            // Guidance info was returned
            allSamples = samplingResult.traj;
            guidanceData = {
                epsCond: samplingResult.epsCond ? samplingResult.epsCond.arraySync() : null,
                epsUncond: samplingResult.epsUncond ? samplingResult.epsUncond.arraySync() : null,
                epsHat: samplingResult.epsHat ? samplingResult.epsHat.arraySync() : null,
            };
        } else {
            // Just trajectory was returned
            allSamples = samplingResult;
        }
        
        // Translate the data to the display coordinate frame
        const translatedData = convertDataToDisplayCoordinateFrame(
            allSamples,
            domainRange,
            distributionWidth,
            displayAreaWidth,
            numberOfSteps
        );
        // Convert the tensor to a 2D array
        const allSamplesArray = translatedData.arraySync();
        // Return the result to the main thread
        const resultMessage: any = { 
            type: 'result', 
            allSamples: allSamplesArray,
        };
        
        if (guidanceData) {
            resultMessage.guidance = guidanceData;
        }
        
        self.postMessage(resultMessage);
    }
};
