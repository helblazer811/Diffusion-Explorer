/**
 * Rectified Flow Training Worker
 *
 * Self-contained worker that implements the complete rectified flow training pipeline:
 * 1. Phase 1: Train with independent coupling (random pairing)
 * 2. Phases 2-k: Sample trajectories, induce coupling from endpoints, retrain
 *
 * The worker owns the entire training loop and communicates progress via messages.
 */

import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
setWasmPaths('/tfjs-backend-wasm/');
import '@tensorflow/tfjs-backend-wasm';
import { FlowModel } from '../flow_matching';

const backend = 'webgl';

/**
 * Load dataset from a JSON file
 */
async function loadDataset(path: string): Promise<tf.Tensor2D> {
  const response = await fetch(path);
  const data = await response.json();
  return tf.tensor2d(data.points);
}

/**
 * Save model to IndexedDB and return the path
 */
async function saveModel(model: tf.LayersModel, phase: number): Promise<string> {
  const timestamp = new Date().getTime();
  const modelName = `rectified_flow_phase_${phase}_${timestamp}`;
  const modelPath = `indexeddb://${modelName}`;
  await model.save(modelPath);
  return modelPath;
}

/**
 * Construct independent coupling by randomly shuffling target pairs
 */
function constructIndependentCoupling(
  source: tf.Tensor2D,
  target: tf.Tensor2D
): { coupledSource: tf.Tensor2D; coupledTarget: tf.Tensor2D } {
  return tf.tidy(() => {
    const N = source.shape[0];
    // Create shuffled indices using util.shuffle (shuffles in-place)
    const indices = Array.from({ length: N }, (_, i) => i);
    tf.util.shuffle(indices); // Shuffle in place
    const shuffledTensor = tf.tensor1d(indices, 'int32');
    return {
      coupledSource: source,
      coupledTarget: tf.gather(target, shuffledTensor) as tf.Tensor2D
    };
  });
}

/**
 * Construct induced coupling using trajectory endpoints
 */
function constructInducedCoupling(
  originalSource: tf.Tensor2D,
  trajectoryEndpoints: tf.Tensor2D
): { coupledSource: tf.Tensor2D; coupledTarget: tf.Tensor2D } {
  return {
    coupledSource: originalSource,
    coupledTarget: trajectoryEndpoints
  };
}

/**
 * Train flow matching model with a given coupling
 */
async function trainFlowMatchingWithCoupling(
  coupledSource: tf.Tensor2D,
  coupledTarget: tf.Tensor2D,
  modelConfig: { dim: number; hidden: number },
  trainingConfig: { epochs: number; batchSize: number; displayInterval: number },
  currentPhase: number
): Promise<FlowModel> {
  const model = new FlowModel(modelConfig.dim, modelConfig.hidden);
  const optimizer = tf.train.adam(0.001);
  const lossFn = (pred: tf.Tensor, target: tf.Tensor) => {
    return tf.losses.meanSquaredError(target, pred);
  };

  for (let epoch = 0; epoch < trainingConfig.epochs; epoch++) {
    // Iterate over batches
    for (let i = 0; i < coupledSource.shape[0]; i += trainingConfig.batchSize) {
      tf.tidy(() => {
        const batchEnd = Math.min(i + trainingConfig.batchSize, coupledSource.shape[0]);
        const indices = tf.range(i, batchEnd, 1, 'int32');

        // Get coupled pairs for this batch
        const x_0 = tf.gather(coupledSource, indices);
        const x_1 = tf.gather(coupledTarget, indices);

        // Sample random timesteps for batch
        const t = tf.randomUniform([x_0.shape[0], 1]);

        // Flow matching interpolation: x_t = (1-t)*x_0 + t*x_1
        const x_t = x_0.mul(tf.sub(1, t)).add(x_1.mul(t));

        // Target velocity: dx_t = x_1 - x_0
        const dx_t = x_1.sub(x_0);

        // Optimize
        optimizer.minimize(() => {
          const pred = model.forward(x_t, t) as tf.Tensor2D;
          return lossFn(pred, dx_t) as tf.Scalar;
        });
      });
    }

    // Send progress update
    if (epoch % trainingConfig.displayInterval === 0) {
      self.postMessage({
        type: 'progress',
        data: {
          phase: currentPhase,
          epoch: epoch,
          totalEpochs: trainingConfig.epochs
        }
      });
    }

    // Yield control to handle messages
    await tf.nextFrame();
  }

  return model;
}

/**
 * Sample trajectories from a trained model starting from initial points
 */
function sampleTrajectories(
  model: FlowModel,
  initialPoints: tf.Tensor2D,
  numSteps: number
): tf.Tensor3D {
  return tf.tidy(() => {
    const dt = 1.0 / numSteps;
    const allSamples: tf.Tensor2D[] = [initialPoints];
    let x_t = initialPoints;

    for (let step = 0; step < numSteps; step++) {
      const t = step / numSteps;
      const tTensor = tf.fill([x_t.shape[0], 1], t) as tf.Tensor2D;

      // Midpoint method for ODE integration
      const v_t = model.forward(x_t, tTensor) as tf.Tensor2D;
      const x_mid = x_t.add(v_t.mul(dt)) as tf.Tensor2D;

      const t_mid = t + dt / 2;
      const t_midTensor = tf.fill([x_t.shape[0], 1], t_mid) as tf.Tensor2D;
      const v_mid = model.forward(x_mid, t_midTensor) as tf.Tensor2D;

      x_t = x_t.add(v_mid.mul(dt)) as tf.Tensor2D;
      allSamples.push(x_t);
    }

    return tf.stack(allSamples) as tf.Tensor3D; // [numSteps+1, numSamples, dim]
  }) as tf.Tensor3D;
}

/**
 * Main message handler
 */
self.onmessage = async (e) => {
  const { type, config } = e.data;

  if (type !== 'start') {
    self.postMessage({
      type: 'error',
      data: { message: `Unknown message type: ${type}` }
    });
    return;
  }

  try {
    // Set up TensorFlow backend
    await tf.setBackend(backend);
    await tf.ready();

    // Extract configuration
    const {
      modelConfig,
      datasetPath,
      trainingConfig,
      numRectifiedPhases,
      samplingConfig,
      storageMode
    } = config;

    // Load target distribution
    const targetData = await loadDataset(datasetPath);
    const numSamples = samplingConfig.numSamples;
    const dim = modelConfig.dim;

    // Generate and store original source distribution (never modified!)
    const originalSource = tf.randomNormal([numSamples, dim]);

    // Storage for all phases (if storageMode === 'all_phases')
    const allModels: string[] = [];
    const allTrajectories: number[][][][] = [];

    let currentModel: FlowModel | null = null;
    let finalTrajectories: tf.Tensor3D | null = null;

    // Phase 1: Independent Coupling
    {
      const phase = 1;

      // Randomly shuffle target to create independent coupling
      const { coupledSource, coupledTarget } = constructIndependentCoupling(
        originalSource,
        targetData
      );

      // Train model on independent coupling
      currentModel = await trainFlowMatchingWithCoupling(
        coupledSource as tf.Tensor2D,
        coupledTarget as tf.Tensor2D,
        modelConfig,
        trainingConfig,
        phase
      );

      // Sample trajectories from trained model
      const trajectories = sampleTrajectories(
        currentModel,
        originalSource as tf.Tensor2D,
        samplingConfig.numSteps
      );

      // Save model (access protected property with type assertion)
      const modelPath = await saveModel((currentModel as any).model, phase);

      // Store if needed
      if (storageMode === 'all_phases') {
        allModels.push(modelPath);
        allTrajectories.push(trajectories.arraySync() as number[][][]);
      }

      // Send phase complete message
      self.postMessage({
        type: 'phaseComplete',
        data: {
          phase,
          modelPath,
          trajectories: trajectories.arraySync()
        }
      });

      // Clean up coupling tensors (they were created in tidy, but let's be explicit)
      coupledSource.dispose();
      coupledTarget.dispose();

      // Keep trajectories for next phase
      finalTrajectories = trajectories;
    }

    // Phases 2 to k: Rectified Flow Phases
    for (let phase = 2; phase <= numRectifiedPhases; phase++) {
      // Get trajectory endpoints from previous phase (last timestep)
      const lastIndex = finalTrajectories!.shape[0] - 1;
      const trajectoryEndpoints = finalTrajectories!.gather([lastIndex], 0).squeeze([0]) as tf.Tensor2D;

      // Construct induced coupling
      const { coupledSource, coupledTarget } = constructInducedCoupling(
        originalSource,
        trajectoryEndpoints
      );

      // Note: FlowModel doesn't have a dispose method
      // Models will be garbage collected when references are lost

      // Train new model on induced coupling
      currentModel = await trainFlowMatchingWithCoupling(
        coupledSource as tf.Tensor2D,
        coupledTarget as tf.Tensor2D,
        modelConfig,
        trainingConfig,
        phase
      );

      // Dispose old trajectories before sampling new ones
      if (finalTrajectories) {
        finalTrajectories.dispose();
      }

      // Sample new trajectories
      finalTrajectories = sampleTrajectories(
        currentModel,
        originalSource as tf.Tensor2D,
        samplingConfig.numSteps
      );

      // Save model (access protected property with type assertion)
      const modelPath = await saveModel((currentModel as any).model, phase);

      // Store if needed
      if (storageMode === 'all_phases') {
        allModels.push(modelPath);
        allTrajectories.push(finalTrajectories.arraySync() as number[][][]);
      }

      // Send phase complete message
      self.postMessage({
        type: 'phaseComplete',
        data: {
          phase,
          modelPath,
          trajectories: finalTrajectories.arraySync()
        }
      });

      // Clean up
      coupledTarget.dispose();
      trajectoryEndpoints.dispose();
    }

    // Get final model path (last model saved)
    const finalModelPath = await saveModel(
      (currentModel as any).model,
      numRectifiedPhases
    );

    // Send completion message
    self.postMessage({
      type: 'complete',
      data: {
        finalModelPath,
        ...(storageMode === 'all_phases' ? { allModels } : {}),
        finalTrajectories: finalTrajectories!.arraySync(),
        ...(storageMode === 'all_phases' ? { allTrajectories } : {})
      }
    });

    // Final cleanup
    originalSource.dispose();
    targetData.dispose();
    if (finalTrajectories) {
      finalTrajectories.dispose();
    }
    // Note: FlowModel doesn't have dispose, will be garbage collected

  } catch (error) {
    // Send error message
    self.postMessage({
      type: 'error',
      data: { message: error instanceof Error ? error.message : String(error) }
    });
  }
};
