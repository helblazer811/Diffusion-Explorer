/*
*    Web worker that runs sampling for a given model. 
*/ 
import * as tf from '@tensorflow/tfjs';
// // TODO Fix wasm implementation
// import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
// setWasmPaths('tfjs-backend-wasm/');
// import '@tensorflow/tfjs-backend-wasm'; // Import the WebGL backend for TensorFlow.js

import { backend, trainingObjectiveToModelClass } from '$lib/settings';

// function convertDataToDisplayCoordinateFrame(
//     data: tf.Tensor, // Tensor of shape [num_time_steps, num_samples, dim]
//     time: number,
//     domainRange: { xMin: number, xMax: number, yMin: number, yMax: number },
//     distributionWidth: number,
//     displayAreaWidth: number,
// ) {
//     // 1. Scale from the abstract coordinate frame (~ -3 to 3) to the svg viewbox coordinate frame
//     // const xScale = d3.scaleLinear()
//     //     .domain([domainRange.xMin, domainRange.xMax])
//     //     .range([0, distributionWidth]);
//     // const yScale = d3.scaleLinear()
//     //     .domain([domainRange.yMin, domainRange.yMax])
//     //     .range([0, distributionWidth]);
//     // // 2. Apply the scale to the data
//     // const dataArray = data.arraySync() as number[][]; // Convert to plain 2D array
//     // const scaledData = dataArray.map(d => [xScale(d[0]), yScale(d[1])]);
//     // // 3. Now translate the data to the correct xLocation based on the time
//     // const xLocation = time * (displayAreaWidth - distributionWidth);
//     // const translatedData = scaledData.map(d => [d[0] + xLocation, d[1]]);
//     // return translatedData;
// }

function convertDataToDisplayCoordinateFrame(
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
        self.postMessage({ 
            type: 'result', 
            allSamples: allSamplesArray,
        });
    } else if (type === "sample_grid") {
        // Sample a uniform grid of the given gridResolution and then sample from those initial points
        const gridResolution = data.gridResolution;
        const domainRange = data.domainRange;
        // First uniformly sample the x and y coordinates
        const width = domainRange.xMax - domainRange.xMin;
        const height = domainRange.yMax - domainRange.yMin;
        // Make range of data bit wider
        const xMin = domainRange.xMin + 0.0 * width;
        const xMax = domainRange.xMax - 0.0 * width;
        const yMin = domainRange.yMin + 0.0 * height;
        const yMax = domainRange.yMax - 0.0 * height;
        const x = tf.linspace(xMin, xMax, gridResolution);
        const y = tf.linspace(yMin, yMax, gridResolution);
        let initialPoints: tf.Tensor = tf.stack(tf.meshgrid(x, y), 2);
        initialPoints = initialPoints.reshape([gridResolution * gridResolution, 2]); // Flatten the points to be [gridResolution * gridResolution, 2]
        // Call the sample_from_initial_points function
        const allSamples = ourModel.sample_from_initial_points(
            initialPoints,
            numberOfSteps,
        ); // shape [num_time_steps, num_samples, dim]
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
        self.postMessage({ 
            type: 'result', 
            allSamples: allSamplesArray,
        });
    }
};
