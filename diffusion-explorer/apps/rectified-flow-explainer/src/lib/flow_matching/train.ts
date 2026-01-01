import {
  FlowModelClient,
  downloadModelFromIndexedDB
} from '@diffusion-explorer/diffusion';
import {
  settings as globalSettings,
  type RectifiedFlowData,
  type TrainingSettings
} from '../settings';

// Re-export types for convenience
export type { RectifiedFlowData, TrainingSettings };

// ========== TRAINING FUNCTIONS ==========

export async function trainModel(
  settings: TrainingSettings,
  workerUrl: string,
  onTrainingStart?: () => void,
  onTrainingEnd?: () => void
): Promise<{ modelPath: string; requestId: string }> {
  console.log('Starting model training...');
  const modelConfig = settings.modelConfig;
  const trainingConfig = {
    epochs: settings.flowMatchingTrainingConfig.epochs,
    batchSize: settings.flowMatchingTrainingConfig.batchSize,
    updateInterval: settings.flowMatchingTrainingConfig.displayInterval
  };
  // Build absolute URL for worker to fetch (workers don't have same base URL context)
  const datasetPath = new URL('/' + globalSettings.targetDistributionPointsPath, window.location.origin).href;

  onTrainingStart?.();

  // Create client for training (no model path needed)
  const client = new FlowModelClient(
    workerUrl,
    '',  // No model path for training
    'Flow Matching',
    modelConfig
  );

  console.log("Starting training with unified FlowModelClient...");
  const { requestId, promise } = client.train(
    datasetPath,
    trainingConfig,
    (epoch: number, _samples: number[][] | null, loss: number) => {
      console.log(`Epoch ${epoch}: loss = ${loss?.toFixed(6) ?? 'N/A'}`);
    }
  );

  const result = await promise;
  console.log('Training finished!', result.tfModelPath);
  onTrainingEnd?.();

  // Auto-download the trained model
  await downloadModelFromIndexedDB(result.tfModelPath, 'flow_matching_model');

  return { modelPath: result.tfModelPath, requestId };
}

export async function trainRectifiedFlow(
  settings: TrainingSettings,
  workerUrl: string,
  onEpochCallback?: (epoch: number, rectifiedStep: number) => void,
  onRectifiedStepCallback?: (rectifiedStep: number, trajectories: number[][][] | null) => void
): Promise<{ data: RectifiedFlowData; requestId: string }> {
  console.log('Starting rectified flow training...');
  const modelConfig = settings.modelConfig;
  const rectifiedFlowConfig = settings.rectifiedFlowTrainingConfig;
  // Build absolute URL for worker to fetch (workers don't have same base URL context)
  const datasetPath = new URL('/' + globalSettings.targetDistributionPointsPath, window.location.origin).href;

  // Create client for training (no model path needed)
  const client = new FlowModelClient(
    workerUrl,
    '',  // No model path for training
    'Flow Matching',
    modelConfig
  );

  console.log("Starting rectified flow training with unified FlowModelClient...");
  const { requestId, promise } = client.trainRectified(
    datasetPath,
    rectifiedFlowConfig,
    // Epoch callback
    (epoch: number, rectifiedStep: number, _intermediateSamples: number[][] | null, loss?: number) => {
      console.log(`Rectified step ${rectifiedStep}, epoch ${epoch}: loss = ${loss?.toFixed(6) ?? 'N/A'}`);
      onEpochCallback?.(epoch, rectifiedStep);
    },
    // Rectified step callback
    (rectifiedStep: number, trajectories: number[][][] | null) => {
      console.log(`Completed rectified step ${rectifiedStep}`);
      if (trajectories) {
        console.log('  Trajectories shape:', trajectories.length, 'samples');
      }
      onRectifiedStepCallback?.(rectifiedStep, trajectories);
    }
  );

  const result = await promise;
  console.log('Rectified flow training finished!', result.tfModelPath);
  console.log('Collected', result.allRectifiedTrajectories.length, 'rectified steps');

  // Auto-download the trained rectified flow model
  await downloadModelFromIndexedDB(result.tfModelPath, 'rectified_flow_model');

  const data: RectifiedFlowData = {
    allRectifiedTrajectories: result.allRectifiedTrajectories,
    modelPath: result.tfModelPath
  };

  return { data, requestId };
}
