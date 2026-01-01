/*
 *    Unified web worker for sampling and training flow models.
 *    Supports cooperative cancellation via "stop" messages.
 */
import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
setWasmPaths("/tfjs-backend-wasm/");
import "@tensorflow/tfjs-backend-wasm";

import { FlowModel, generateUniformGridSamples } from "@diffusion-explorer/diffusion";

const backend = "webgl";
const trainingObjectiveToModelClass: Record<string, typeof FlowModel> = {
  "Flow Matching": FlowModel,
};

// ===== Request tracking for cancellation =====
const activeRequests = new Map<string, { cancelled: boolean }>();

// Global unhandled rejection handler
self.addEventListener('unhandledrejection', (event) => {
  console.error('[FlowModel Worker] Unhandled promise rejection:', event.reason);
  self.postMessage({
    type: 'error',
    error: `Unhandled rejection: ${event.reason?.message || String(event.reason)}`
  });
});

// Global error handler
self.addEventListener('error', (event) => {
  console.error('[FlowModel Worker] Uncaught error:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
  self.postMessage({
    type: 'error',
    error: `Uncaught error: ${event.message} at ${event.filename}:${event.lineno}`
  });
});

// ===== Helper functions =====

async function loadDataset(path: string) {
  const response = await fetch(path);
  const data = await response.json();
  const pointsTensor = tf.tensor(data.points);
  const classesTensor = data.classes ? tf.tensor(data.classes) : null;
  return { pointsTensor, classesTensor };
}

async function saveModel(model: tf.LayersModel, path: string) {
  const modelSaveName = "indexeddb://" + path.replace(/\s+/g, "_") + "_" + Date.now();
  await model.save(modelSaveName);
  return modelSaveName;
}

async function initializeBackend() {
  if (backend === "webgl") {
    await tf.setBackend("webgl");
    await tf.ready();
  } else if (backend === "wasm") {
    await tf.setBackend("wasm");
    await tf.ready();
  } else {
    throw new Error("Invalid backend specified");
  }
}

// ===== Sampling handlers =====

async function handleSamplingRequest(
  requestId: string,
  type: string,
  data: any
) {
  const shouldStop = () => activeRequests.get(requestId)?.cancelled ?? false;

  const modelJSONPath = data.modelJSONPath;
  const trainingObjective = data.trainingObjective;
  const modelConfig = data.modelConfig;
  const numberOfSteps = data.numberOfSteps;
  const timeValue = data.timeValue;
  const options = data.options || {};
  const streaming = data.streaming || false;

  // Create perStepCallback if streaming is enabled
  const perStepCallback = streaming
    ? (step: number, x_t: number[][]) => {
        if (!shouldStop()) {
          self.postMessage({ requestId, type: 'step', step, x_t });
        }
      }
    : undefined;

  await initializeBackend();

  // Load the model
  const ModelClass = trainingObjectiveToModelClass[trainingObjective];
  const ourModel = ModelClass.fromConfig(modelConfig);
  const tfModel = await tf.loadLayersModel(modelJSONPath);
  ourModel.setModel(tfModel);

  let allSamples: tf.Tensor3D | null = null;
  let guidanceData = null;

  // Prepare sampling options
  const samplingOptions = { ...options };
  if (Array.isArray(samplingOptions.cond)) {
    samplingOptions.cond = tf.tensor(samplingOptions.cond, undefined, "int32");
  }

  if (type === "sample") {
    const numSamples = data.numSamples;
    allSamples = await ourModel.sample(
      numSamples,
      numberOfSteps,
      samplingOptions,
      perStepCallback,
      shouldStop
    );
  } else if (type === "sample_from_initial_points") {
    const initialPoints = data.initialPoints;
    const initialPointsTensor = tf.tensor(initialPoints) as tf.Tensor2D;
    allSamples = await ourModel.sample_from_initial_points(
      initialPointsTensor,
      numberOfSteps,
      samplingOptions,
      perStepCallback,
      shouldStop
    );
  } else if (type === "sample_grid") {
    const gridResolution = data.gridResolution;
    const gridDomainRange = data.domainRange;
    allSamples = await ourModel.sample_grid(
      gridResolution,
      gridDomainRange,
      numberOfSteps,
      samplingOptions,
      perStepCallback,
      shouldStop
    );
  } else if (type === "vector_field_grid") {
    // Vector field evaluation - single forward pass
    const gridResolution = data.gridResolution;
    const gridDomainRange = data.domainRange;

    const gridPoints = generateUniformGridSamples(gridResolution, gridDomainRange, true);
    const numPoints = gridPoints.shape[0];
    const t = tf.fill([numPoints, 1], timeValue || 0.5);

    const velocities = ourModel.forward(gridPoints, t);
    const gridPointsArray = gridPoints.arraySync();
    const velocitiesArray = velocities.arraySync();

    gridPoints.dispose();
    t.dispose();
    velocities.dispose();

    self.postMessage({
      requestId,
      type: "result",
      velocities: velocitiesArray,
      gridPoints: gridPointsArray
    });
    return;
  }

  // Check if cancelled or null result
  if (shouldStop() || allSamples === null) {
    console.log('[FlowModel Worker] Request cancelled:', requestId);
    self.postMessage({ requestId, type: 'cancelled' });
    return;
  }

  // Convert tensor to array and send result
  const allSamplesArray = allSamples.arraySync();
  allSamples.dispose();

  const resultMessage: any = {
    requestId,
    type: "result",
    allSamples: allSamplesArray,
  };

  if (guidanceData) {
    resultMessage.guidance = guidanceData;
  }

  console.log('[FlowModel Worker] Sending result:', { requestId, type: 'result', timestamp: Date.now() });
  self.postMessage(resultMessage);
}

// ===== Training handlers =====

async function handleTrainRequest(requestId: string, data: any) {
  const shouldStop = () => activeRequests.get(requestId)?.cancelled ?? false;

  const { trainingObjective, modelConfig, datasetPath, trainingConfig } = data;

  await initializeBackend();

  const ModelClass = trainingObjectiveToModelClass[trainingObjective];
  const ourModel = new ModelClass(modelConfig.dim, modelConfig.hidden);

  const { pointsTensor, classesTensor } = await loadDataset(datasetPath);

  if (trainingObjective === "Conditional Diffusion") {
    if (classesTensor === null) {
      throw new Error("Classes tensor is null for conditional diffusion model");
    }
    await (ourModel as any).train(
      pointsTensor,
      classesTensor,
      trainingConfig.epochs,
      trainingConfig.batchSize,
      trainingConfig.updateInterval,
      shouldStop,
      (epoch: number, intermediateSamples: number[][], loss: number) => {
        self.postMessage({
          requestId,
          type: "epoch_chunk",
          epoch,
          intermediateSamples,
          loss,
        });
      }
    );
  } else {
    await ourModel.train(
      pointsTensor as tf.Tensor2D,
      trainingConfig.epochs,
      trainingConfig.batchSize,
      trainingConfig.updateInterval,
      shouldStop,
      (epoch: number, intermediateSamples: number[][], loss: number) => {
        self.postMessage({
          requestId,
          type: "epoch_chunk",
          epoch,
          intermediateSamples,
          loss,
        });
      }
    );
  }

  const modelSaveName = await saveModel(ourModel.model, trainingObjective);
  console.log('[FlowModel Worker] Training complete:', { requestId, timestamp: Date.now() });
  self.postMessage({
    requestId,
    type: "result",
    tfModelPath: modelSaveName,
  });
}

async function handleRectifiedTrainRequest(requestId: string, data: any) {
  const shouldStop = () => activeRequests.get(requestId)?.cancelled ?? false;

  const { trainingObjective, modelConfig, datasetPath, rectifiedConfig } = data;

  await initializeBackend();

  const ModelClass = trainingObjectiveToModelClass[trainingObjective];
  const ourModel = new ModelClass(modelConfig.dim, modelConfig.hidden);

  const { pointsTensor } = await loadDataset(datasetPath);

  // Load source distribution if provided
  let sourceDistribution: tf.Tensor2D | null = null;
  if (rectifiedConfig.sourceDistributionPath) {
    const { pointsTensor: sourceTensor } = await loadDataset(rectifiedConfig.sourceDistributionPath);
    sourceDistribution = sourceTensor as tf.Tensor2D;
  }

  const allRectifiedTrajectories: number[][][][] = [];

  await ourModel.train_rectified(
    pointsTensor as tf.Tensor2D,
    sourceDistribution,
    rectifiedConfig.num_rectified_steps,
    rectifiedConfig.epochs_per_rectified_step,
    rectifiedConfig.batchSize,
    rectifiedConfig.num_simulation_steps,
    shouldStop,
    (epoch: number, rectifiedStep: number, intermediateSamples: number[][] | null, loss?: number) => {
      self.postMessage({
        requestId,
        type: "epoch_chunk",
        epoch,
        rectifiedStep,
        intermediateSamples,
        loss,
      });
    },
    (rectifiedStep: number, trajectories: number[][][] | null) => {
      if (trajectories) {
        allRectifiedTrajectories.push(trajectories);
      }
      self.postMessage({
        requestId,
        type: "rectified_step_complete",
        rectifiedStep,
        trajectories,
      });
    }
  );

  const modelSaveName = await saveModel(ourModel.model, trainingObjective);
  console.log('[FlowModel Worker] Rectified training complete:', { requestId, timestamp: Date.now() });
  self.postMessage({
    requestId,
    type: "result",
    tfModelPath: modelSaveName,
    allRectifiedTrajectories,
  });
}

// ===== Main message router =====

self.onmessage = async (e) => {
  const { requestId, type, data } = e.data;

  // Handle stop/cancellation messages
  if (type === "stop" || type === "stop_training") {
    const req = activeRequests.get(requestId);
    if (req) {
      req.cancelled = true;
    }
    console.log("[FlowModel Worker] Cancel requested:", requestId || "all");
    self.postMessage({ requestId, type: 'cancelled' });
    return;
  }

  // Track new request
  activeRequests.set(requestId, { cancelled: false });

  try {
    console.log('[FlowModel Worker] Received message:', { requestId, type, timestamp: Date.now() });

    switch (type) {
      case 'sample':
      case 'sample_from_initial_points':
      case 'sample_grid':
      case 'vector_field_grid':
        await handleSamplingRequest(requestId, type, data);
        break;

      case 'train':
        await handleTrainRequest(requestId, data);
        break;

      case 'train_rectified':
        await handleRectifiedTrainRequest(requestId, data);
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    const shouldStop = () => activeRequests.get(requestId)?.cancelled ?? false;
    if (!shouldStop()) {
      console.error('[FlowModel Worker] Error in message handler:', error);
      self.postMessage({
        requestId,
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  } finally {
    activeRequests.delete(requestId);
  }
};
