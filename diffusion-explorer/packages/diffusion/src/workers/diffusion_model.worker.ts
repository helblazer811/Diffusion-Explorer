/*
 *    Unified web worker for sampling and training diffusion models.
 *    Supports cooperative cancellation via "stop" messages.
 */
import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
setWasmPaths("/tfjs-backend-wasm/");
import "@tensorflow/tfjs-backend-wasm";

import { DiffusionModel } from '../diffusion/diffusion';

const backend = "webgl";

// ===== Request tracking for cancellation =====
const activeRequests = new Map<string, { cancelled: boolean }>();

// Global unhandled rejection handler
self.addEventListener('unhandledrejection', (event) => {
  console.error('[Diffusion Worker] Unhandled promise rejection:', event.reason);
  self.postMessage({
    type: 'error',
    error: `Unhandled rejection: ${event.reason?.message || String(event.reason)}`
  });
});

// Global error handler
self.addEventListener('error', (event) => {
  console.error('[Diffusion Worker] Uncaught error:', {
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
  return { pointsTensor };
}

async function saveModel(model: tf.LayersModel, name: string) {
  const modelSaveName = "indexeddb://" + name.replace(/\s+/g, "_") + "_" + Date.now();
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
  const modelConfig = data.modelConfig;
  const numberOfSteps = data.numberOfSteps;
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

  // Create diffusion model with config
  const T = modelConfig.T ?? 1000;
  const betaStart = modelConfig.betaStart ?? 1e-4;
  const betaEnd = modelConfig.betaEnd ?? 2e-2;
  const ourModel = new DiffusionModel(modelConfig.dim, modelConfig.hidden, T, betaStart, betaEnd);

  // Load the saved model
  const tfModel = await tf.loadLayersModel(modelJSONPath);
  (ourModel as any).model = tfModel;

  let allSamples: tf.Tensor3D | null = null;

  if (type === "sample") {
    const numSamples = data.numSamples;
    allSamples = await ourModel.sample(
      numSamples,
      numberOfSteps,
      options,
      perStepCallback,
      shouldStop
    );
  } else if (type === "sample_from_initial_points") {
    const initialPoints = data.initialPoints;
    const initialPointsTensor = tf.tensor(initialPoints) as tf.Tensor2D;
    allSamples = await ourModel.sample_from_initial_points(
      initialPointsTensor,
      numberOfSteps,
      options,
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
      options,
      perStepCallback,
      shouldStop
    );
  }

  // Check if cancelled or null result
  if (shouldStop() || allSamples === null) {
    console.log('[Diffusion Worker] Request cancelled:', requestId);
    self.postMessage({ requestId, type: 'cancelled' });
    return;
  }

  // Convert tensor to array and send result
  const allSamplesArray = allSamples.arraySync();
  allSamples.dispose();

  console.log('[Diffusion Worker] Sending result:', { requestId, type: 'result', timestamp: Date.now() });
  self.postMessage({
    requestId,
    type: "result",
    allSamples: allSamplesArray,
  });
}

// ===== Training handlers =====

async function handleTrainRequest(requestId: string, data: any) {
  const shouldStop = () => activeRequests.get(requestId)?.cancelled ?? false;

  const { modelConfig, datasetPath, trainingConfig } = data;

  await initializeBackend();

  const T = modelConfig.T ?? 1000;
  const betaStart = modelConfig.betaStart ?? 1e-4;
  const betaEnd = modelConfig.betaEnd ?? 2e-2;
  const ourModel = new DiffusionModel(modelConfig.dim, modelConfig.hidden, T, betaStart, betaEnd);

  const { pointsTensor } = await loadDataset(datasetPath);

  await ourModel.train(
    pointsTensor as tf.Tensor2D,
    trainingConfig.epochs,
    trainingConfig.batchSize,
    trainingConfig.updateInterval,
    shouldStop,
    (epoch: number, intermediateSamples: number[][] | null, loss?: number) => {
      self.postMessage({
        requestId,
        type: "epoch_chunk",
        epoch,
        intermediateSamples,
        loss,
      });
    }
  );

  const modelSaveName = await saveModel((ourModel as any).model, 'Diffusion');
  console.log('[Diffusion Worker] Training complete:', { requestId, timestamp: Date.now() });
  self.postMessage({
    requestId,
    type: "result",
    tfModelPath: modelSaveName,
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
    console.log("[Diffusion Worker] Cancel requested:", requestId || "all");
    self.postMessage({ requestId, type: 'cancelled' });
    return;
  }

  // Track new request
  activeRequests.set(requestId, { cancelled: false });

  try {
    console.log('[Diffusion Worker] Received message:', { requestId, type, timestamp: Date.now() });

    switch (type) {
      case 'sample':
      case 'sample_from_initial_points':
      case 'sample_grid':
        await handleSamplingRequest(requestId, type, data);
        break;

      case 'train':
        await handleTrainRequest(requestId, data);
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    const shouldStop = () => activeRequests.get(requestId)?.cancelled ?? false;
    if (!shouldStop()) {
      console.error('[Diffusion Worker] Error in message handler:', error);
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
