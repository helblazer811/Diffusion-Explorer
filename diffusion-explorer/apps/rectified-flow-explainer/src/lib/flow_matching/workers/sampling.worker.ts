/*
 *    Web worker that runs sampling for a given model.
 *    Supports cooperative cancellation via "stop" messages.
 */
import * as tf from "@tensorflow/tfjs";
import { FlowModel, generateUniformGridSamples } from "@diffusion-explorer/diffusion";

const backend = "webgl";
const trainingObjectiveToModelClass = {
  "Flow Matching": FlowModel,
};

// ===== Cancellation state =====
// Track cancelled request IDs - each request is independently cancellable
const cancelledRequests = new Set<string>();

// Global unhandled rejection handler for async errors
self.addEventListener('unhandledrejection', (event) => {
  console.error('[Sampling Worker] Unhandled promise rejection:', event.reason);
  self.postMessage({
    type: 'error',
    error: `Unhandled rejection: ${event.reason?.message || String(event.reason)}`
  });
});

// Global error handler
self.addEventListener('error', (event) => {
  console.error('[Sampling Worker] Uncaught error:', {
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

self.onmessage = async (e) => {
  const { requestId, type, data } = e.data;

  // Handle cancellation message - add to cancelled set
  if (type === "stop") {
    cancelledRequests.add(requestId);
    console.log("[Sampling Worker] Cancel requested:", requestId);
    return;
  }

  // Each request checks only if its own ID is cancelled
  const shouldStop = () => cancelledRequests.has(requestId);

  try {
    console.log('[Sampling Worker] Received message:', { requestId, type, timestamp: Date.now() });

    // Destructure the data
    const modelJSONPath = data.modelJSONPath;
    const trainingObjective = data.trainingObjective;
    const modelConfig = data.modelConfig;
    const numberOfSteps = data.numberOfSteps;
    const timeValue = data.timeValue;
    const domainRange = data.domainRange || null;
    const options = data.options || {};
    const streaming = data.streaming || false;

    // Create perStepCallback if streaming is enabled
    const perStepCallback = streaming
      ? (step: number, x_t: number[][]) => {
          // Don't send step updates if cancelled or superseded by newer job
          if (!shouldStop()) {
            self.postMessage({ requestId, type: 'step', step, x_t });
          }
        }
      : undefined;

    // Set up the backend
    if (backend === "webgl") {
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
    ourModel.setModel(tfModel);

    let allSamples: tf.Tensor3D | null = null;
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

      // Run sampling with the model (now async with shouldStop)
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

      // Run sampling with the model (now async with shouldStop)
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

      // Run sampling with the model (now async with shouldStop)
      allSamples = await ourModel.sample_grid(
        gridResolution,
        gridDomainRange,
        numberOfSteps,
        samplingOptions,
        perStepCallback,
        shouldStop
      );

    } else if (type === "vector_field_grid") {
      // Vector field evaluation doesn't need cancellation (single forward pass)
      const gridResolution = data.gridResolution;
      const gridDomainRange = data.domainRange;

      // Generate uniform grid of points as tensor
      const gridPoints = generateUniformGridSamples(gridResolution, gridDomainRange, true);
      const numPoints = gridPoints.shape[0];

      // Create time tensor filled with the specified time value
      const t = tf.fill([numPoints, 1], timeValue || 0.5);

      // Evaluate the vector field at all grid points
      const velocities = ourModel.forward(gridPoints, t);

      // Convert to arrays
      const gridPointsArray = gridPoints.arraySync();
      const velocitiesArray = velocities.arraySync();

      // Clean up
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

    } else {
      throw new Error(`Unknown message type: ${type}`);
    }

    // Check if cancelled or null result
    if (shouldStop() || allSamples === null) {
      console.log('[Sampling Worker] Request cancelled:', requestId);
      self.postMessage({ requestId, type: 'cancelled' });
      return;
    }

    // Convert the tensor to a 2D array
    const allSamplesArray = allSamples.arraySync();
    allSamples.dispose();

    // Return the result to the main thread
    const resultMessage: any = {
      requestId,
      type: "result",
      allSamples: allSamplesArray,
    };

    if (guidanceData) {
      resultMessage.guidance = guidanceData;
    }

    console.log('[Sampling Worker] Sending result:', { requestId, type: 'result', timestamp: Date.now() });
    self.postMessage(resultMessage);

  } catch (error) {
    // Don't send error if we were cancelled or superseded
    if (!shouldStop()) {
      console.error('[Sampling Worker] Error in message handler:', error);
      self.postMessage({
        requestId,
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  } finally {
    // Cleanup - remove from cancelled set if it was there
    cancelledRequests.delete(requestId);
  }
};
