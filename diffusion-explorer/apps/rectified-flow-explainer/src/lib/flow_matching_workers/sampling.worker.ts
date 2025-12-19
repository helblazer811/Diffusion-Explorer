/*
 *    Web worker that runs sampling for a given model.
 */
import * as tf from "@tensorflow/tfjs";
// // TODO Fix wasm implementation
// import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
// setWasmPaths('tfjs-backend-wasm/');
// import '@tensorflow/tfjs-backend-wasm'; // Import the WebGL backend for TensorFlow.js
// import { DiffusionModel } from "../diffusion";
import { FlowModel, sampleUniformGrid } from "@diffusion-explorer/diffusion";
// import { ConditionalDiffusionModel } from "../conditional_diffusion";
// import { sampleUniformGrid } from "../../../../../packages/diffusion/src/utils";

const backend = "webgl";
const trainingObjectiveToModelClass = {
  "Flow Matching": FlowModel,
  // Diffusion: DiffusionModel,
  // "Conditional Diffusion": ConditionalDiffusionModel,
};

self.onmessage = async (e) => {
  const { type, data } = e.data;
  // Destructure the data

  const modelJSONPath = data.modelJSONPath;
  const trainingObjective = data.trainingObjective;
  const modelConfig = data.modelConfig;
  const numberOfSteps = data.numberOfSteps;
  const timeValue = data.timeValue;
  const domainRange = data.domainRange || null;
  const options = data.options || {}; // Optional parameters object

  // Set up the backend
  if (backend === "wasm") {
    // Set up tf wasm backend
    await tf.setBackend("wasm");
    await tf.ready();
  } else if (backend === "webgl") {
    // Set up tf wasm backend
    await tf.setBackend("webgl");
    await tf.ready();
  } else {
    throw new Error("Invalid backend specified");
  }
  // Load up the model based on the passed model name
  const ModelClass = trainingObjectiveToModelClass[trainingObjective];
  const ourModel = ModelClass.fromConfig(modelConfig);

  // Load up a model from the given file path
  const tfModel = await tf.loadLayersModel(modelJSONPath);
  // Set the model in the model class
  ourModel.setModel(tfModel);

  let allSamples;
  let guidanceData = null;

  if (type === "sample") {
    const numSamples = data.numSamples;

    // Prepare options for sampling
    const samplingOptions = { ...options };

    // Convert array-based cond to tensor if needed
    if (Array.isArray(samplingOptions.cond)) {
      samplingOptions.cond = tf.tensor(
        samplingOptions.cond,
        undefined,
        "int32"
      );
    }

    // Run sampling with the model
    const samplingResult = ourModel.sample(
      numSamples,
      numberOfSteps,
      samplingOptions
    );

    // Handle the result based on whether guidance is returned
    const return_guidance = options.return_guidance || false;
    if (
      return_guidance &&
      typeof samplingResult === "object" &&
      samplingResult.traj
    ) {
      // Guidance info was returned
      allSamples = samplingResult.traj;
      guidanceData = {
        epsCond: samplingResult.epsCond
          ? samplingResult.epsCond.arraySync()
          : null,
        epsUncond: samplingResult.epsUncond
          ? samplingResult.epsUncond.arraySync()
          : null,
        epsHat: samplingResult.epsHat
          ? samplingResult.epsHat.arraySync()
          : null,
      };
    } else {
      // Just trajectory was returned
      allSamples = samplingResult;
    }
  } else if (type === "sample_from_initial_points") {
    const initialPoints = data.initialPoints;
    // Convert initial points to a tensor
    const initialPointsTensor = tf.tensor(initialPoints);

    // Prepare options for sampling
    const samplingOptions = { ...options };

    // Convert array-based cond to tensor if needed
    if (Array.isArray(samplingOptions.cond)) {
      samplingOptions.cond = tf.tensor(
        samplingOptions.cond,
        undefined,
        "int32"
      );
    }

    // Run sampling with the model
    const samplingResult = ourModel.sample_from_initial_points(
      initialPointsTensor,
      numberOfSteps,
      samplingOptions
    );

    // Handle the result based on whether guidance is returned
    const return_guidance = options.return_guidance || false;
    if (
      return_guidance &&
      typeof samplingResult === "object" &&
      samplingResult.traj
    ) {
      // Guidance info was returned
      allSamples = samplingResult.traj;
      guidanceData = {
        epsCond: samplingResult.epsCond
          ? samplingResult.epsCond.arraySync()
          : null,
        epsUncond: samplingResult.epsUncond
          ? samplingResult.epsUncond.arraySync()
          : null,
        epsHat: samplingResult.epsHat
          ? samplingResult.epsHat.arraySync()
          : null,
      };
    } else {
      // Just trajectory was returned
      allSamples = samplingResult;
    }
  } else if (type === "sample_grid") {
    // Sample a uniform grid of the given gridResolution and then sample from those initial points
    const gridResolution = data.gridResolution;
    const domainRange = data.domainRange;

    // Prepare options for sampling
    const samplingOptions = { ...options };

    // Convert array-based cond to tensor if needed
    if (Array.isArray(samplingOptions.cond)) {
      samplingOptions.cond = tf.tensor(
        samplingOptions.cond,
        undefined,
        "int32"
      );
    }

    // Call the model's sample_grid function
    const samplingResult = ourModel.sample_grid(
      gridResolution,
      domainRange,
      numberOfSteps,
      samplingOptions
    );

    // Handle the result based on whether guidance is returned
    const return_guidance = options.return_guidance || false;
    if (
      return_guidance &&
      typeof samplingResult === "object" &&
      samplingResult.traj
    ) {
      // Guidance info was returned
      allSamples = samplingResult.traj;
      guidanceData = {
        epsCond: samplingResult.epsCond
          ? samplingResult.epsCond.arraySync()
          : null,
        epsUncond: samplingResult.epsUncond
          ? samplingResult.epsUncond.arraySync()
          : null,
        epsHat: samplingResult.epsHat
          ? samplingResult.epsHat.arraySync()
          : null,
      };
    } else {
      // Just trajectory was returned
      allSamples = samplingResult;
    }
  } else if (type === "vector_field_grid") {
    // Sample vector field on a grid (no ODE integration, just forward evaluation)
    const gridResolution = data.gridResolution;
    const domainRange = data.domainRange;

    // Generate uniform grid of points
    const gridPoints = sampleUniformGrid(gridResolution, domainRange) as tf.Tensor2D;
    const numPoints = gridPoints.shape[0];

    // Create time tensor filled with the specified time value
    const t = tf.fill([numPoints, 1], timeValue || 0.5);

    // Evaluate the vector field at all grid points
    const velocities = ourModel.forward(gridPoints, t);

    // Convert to array and return
    const velocitiesArray = velocities.arraySync();

    // Clean up
    gridPoints.dispose();
    t.dispose();
    velocities.dispose();

    self.postMessage({
      type: "result",
      allSamples: velocitiesArray
    });
    return;
  } else {
    throw new Error(`Unknown message type: ${type}`);
  }

  // Convert the tensor to a 2D array
  const allSamplesArray = allSamples.arraySync();
  // Return the result to the main thread
  const resultMessage = {
    type: "result",
    allSamples: allSamplesArray,
  };

  if (guidanceData) {
    resultMessage.guidance = guidanceData;
  }

  self.postMessage(resultMessage);
};
