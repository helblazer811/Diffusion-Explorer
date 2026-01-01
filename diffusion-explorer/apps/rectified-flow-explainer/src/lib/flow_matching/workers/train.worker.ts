/*
 *    Web worker that runs training for a given model.
 */
import * as tf from "@tensorflow/tfjs";
// TODO Fix the wasm implementation
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
setWasmPaths("/tfjs-backend-wasm/");
import "@tensorflow/tfjs-backend-wasm"; // Import the WebGL backend for TensorFlow.js

// import { DiffusionModel } from "../diffusion";
import { FlowModel } from "@diffusion-explorer/diffusion";
// import { ConditionalDiffusionModel } from "../conditional_diffusion";

const backend = "webgl";
const trainingObjectiveToModelClass = {
  "Flow Matching": FlowModel,
  // "Conditional Diffusion": ConditionalDiffusionModel,
};

async function loadDataset(path: string) {
  return fetch(path)
    .then((response) => response.json())
    .then((data) => {
      // Convert the data to a tensor
      const pointsTensor = tf.tensor(data.points);
      // If there is classes then also convert it to a tensor
      const classesTensor = data.classes ? tf.tensor(data.classes) : null;

      return { pointsTensor, classesTensor };
    });
}

async function saveModel(model: tf.LayersModel, path: string) {
  // Save the model to IndexedDB
  const modelSaveName =
    "indexeddb://" + path.replace(/\s+/g, "_") + "_" + Date.now();
  await model.save(modelSaveName);
  return modelSaveName;
}

// Make a boolean that tracks if the training is stopped
// It is important to be out of the on message function so the value persists across message receives
let trainingStopped = false;

// Global unhandled rejection handler for async errors
self.addEventListener('unhandledrejection', (event) => {
  console.error('[Training Worker] Unhandled promise rejection:', event.reason);
  self.postMessage({
    type: 'error',
    message: `Unhandled rejection: ${event.reason?.message || String(event.reason)}`
  });
});

// Global error handler
self.addEventListener('error', (event) => {
  console.error('[Training Worker] Uncaught error:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
  self.postMessage({
    type: 'error',
    message: `Uncaught error: ${event.message} at ${event.filename}:${event.lineno}`
  });
});

self.onmessage = async (e) => {
  try {
  const { type, data } = e.data;
  console.log("[Training Worker] Received message:", { type, timestamp: Date.now() });

  if (type === "train") {
    // Destructure the data
    const { trainingObjective, modelConfig, datasetPath, trainingConfig } = data;
    // Set up tf wasm backend
    if (backend === "wasm") {
      await tf.setBackend("wasm");
      await tf.ready();
    } else if (backend === "webgl") {
      await tf.setBackend("webgl");
      await tf.ready();
    } else {
      throw new Error("Invalid backend specified");
    }
    // Initialize the empty model
    const ModelClass = trainingObjectiveToModelClass[trainingObjective];
    let ourModel;
    // Load the dataset
    const { pointsTensor, classesTensor } = await loadDataset(datasetPath);
    // If the model is a conditional diffusion model then we need to pass in the classes
    if (trainingObjective === "Conditional Diffusion") {
      if (classesTensor === null) {
        throw new Error(
          "Classes tensor is null for conditional diffusion model"
        );
      }
      console.log("Training conditional diffusion model...");
      ourModel = new ModelClass(
        modelConfig.dim,
        modelConfig.condDim,
        modelConfig.hidden
      );
      await ourModel.train(
        pointsTensor,
        classesTensor,
        trainingConfig["epochs"],
        trainingConfig["batchSize"],
        trainingConfig["updateInterval"],
        // Stop training function that handles halting the training
        () => {
          return trainingStopped;
        },
        (epoch, intermediateSamples, loss) => {
          // Send the intermediate samples and loss to the main thread
          self.postMessage({
            type: "epoch_chunk",
            epoch: epoch,
            intermediateSamples: intermediateSamples,
            loss: loss,
          });
        }
      );
    } else if (
      trainingObjective === "Flow Matching" ||
      trainingObjective === "Diffusion"
    ) {
      ourModel = new ModelClass(modelConfig.dim, modelConfig.hidden);
      // Run training
      await ourModel.train(
        pointsTensor,
        trainingConfig["epochs"],
        trainingConfig["batchSize"],
        trainingConfig["updateInterval"],
        // Stop training function that handles halting the training
        () => {
          return trainingStopped;
        },
        (epoch, intermediateSamples, loss) => {
          // Send the intermediate samples and loss to the main thread
          self.postMessage({
            type: "epoch_chunk",
            epoch: epoch,
            intermediateSamples: intermediateSamples,
            loss: loss,
          });
        }
      );
    } else {
      throw new Error("Invalid training objective" + trainingObjective);
    }

    const modelSaveName = await saveModel(ourModel.model, trainingObjective);
    console.log("[Training Worker] Sending result:", { type: 'result', timestamp: Date.now() });
    self.postMessage({
      type: "result",
      tfModelPath: modelSaveName,
    });
  } else if (type === "train_rectified") {
    // Destructure the data for rectified flow training
    const { trainingObjective, modelConfig, datasetPath, rectifiedConfig } = data;

    // Set up tf backend
    if (backend === "wasm") {
      await tf.setBackend("wasm");
      await tf.ready();
    } else if (backend === "webgl") {
      await tf.setBackend("webgl");
      await tf.ready();
    } else {
      throw new Error("Invalid backend specified");
    }

    // Initialize the model
    const ModelClass = trainingObjectiveToModelClass[trainingObjective];
    const ourModel = new ModelClass(modelConfig.dim, modelConfig.hidden);

    // Load the dataset (target distribution)
    const { pointsTensor } = await loadDataset(datasetPath);

    // Generate or load source distribution
    let sourceDistribution: tf.Tensor2D | null = null;
    if (rectifiedConfig.sourceDistributionPath) {
      const { pointsTensor: sourceTensor } = await loadDataset(rectifiedConfig.sourceDistributionPath);
      sourceDistribution = sourceTensor as tf.Tensor2D;
    }
    // If no source path provided, sourceDistribution remains null (will generate Gaussian)

    // Store trajectories from each rectified step
    const allRectifiedTrajectories: number[][][][] = [];

    // Run rectified flow training
    await ourModel.train_rectified(
      pointsTensor as tf.Tensor2D,
      sourceDistribution,
      rectifiedConfig.num_rectified_steps,
      rectifiedConfig.epochs_per_rectified_step,
      rectifiedConfig.batchSize,
      rectifiedConfig.num_simulation_steps,
      // Stop training function
      () => trainingStopped,
      // End epoch callback
      (epoch: number, rectifiedStep: number, intermediateSamples: number[][] | null, loss?: number) => {
        self.postMessage({
          type: "epoch_chunk",
          epoch: epoch,
          rectifiedStep: rectifiedStep,
          intermediateSamples: intermediateSamples,
          loss: loss,
        });
      },
      // End rectified step callback
      (rectifiedStep: number, trajectories: number[][][] | null) => {
        // Store the trajectories for this rectified step
        if (trajectories) {
          allRectifiedTrajectories.push(trajectories);
        }

        self.postMessage({
          type: "rectified_step_complete",
          rectifiedStep: rectifiedStep,
          trajectories: trajectories,
        });
      }
    );

    // Save the trained model
    const modelSaveName = await saveModel(ourModel.model, trainingObjective);

    // Send final result with all trajectories
    console.log("[Training Worker] Sending result:", { type: 'result', timestamp: Date.now() });
    self.postMessage({
      type: "result",
      tfModelPath: modelSaveName,
      allRectifiedTrajectories: allRectifiedTrajectories,
    });
  } else if (type === "stop_training") {
    // Figure out how to stop the training
    console.log("[Training Worker] Received stop_training signal");
    trainingStopped = true;
  } else {
    console.error("[Training Worker] Unknown message type:", type);
  }
  } catch (error) {
    console.error('[Training Worker] Error in message handler:', error);
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
};
