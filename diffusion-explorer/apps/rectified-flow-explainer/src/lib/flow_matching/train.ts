import * as tf from '@tensorflow/tfjs';
import {
  callTrainingWorkerThread,
  callRectifiedFlowTrainingWorker,
} from '@diffusion-explorer/diffusion';
import {
  settings as globalSettings,
  type RectifiedFlowData,
  type TrainingSettings
} from '../settings';

// Re-export types for convenience
export type { RectifiedFlowData, TrainingSettings };

// ========== HELPER FUNCTIONS ==========

/**
 * Download a trained model from IndexedDB to the user's device.
 * Triggers a browser download of two files: {downloadName}.json and {downloadName}.weights.bin
 * @param modelPath The IndexedDB path (e.g., "indexeddb://Flow_Matching_123456")
 * @param downloadName The base filename for download (e.g., "flow_matching_model")
 */
export async function downloadModelFromIndexedDB(
  modelPath: string,
  downloadName: string
): Promise<void> {
  try {
    const model = await tf.loadLayersModel(modelPath);
    await model.save(`downloads://${downloadName}`);
    console.log(`Model downloaded as ${downloadName}.json and ${downloadName}.weights.bin`);
  } catch (error) {
    console.error(`Failed to download model from ${modelPath}:`, error);
  }
}

// ========== TRAINING FUNCTIONS ==========

export async function trainModel(
  settings: TrainingSettings,
  trainWorkerUrl: string,
  onTrainingStart?: () => void,
  onTrainingEnd?: () => void
): Promise<{ modelPath: string; worker: Worker }> {
  console.log('Starting model training...');
  const modelConfig = settings.modelConfig;
  const trainingConfig = settings.flowMatchingTrainingConfig;
  // Build absolute URL for worker to fetch (workers don't have same base URL context)
  const datasetPath = new URL('/' + globalSettings.targetDistributionPointsPath, window.location.origin).href;

  onTrainingStart?.();

  return new Promise((resolve) => {
    console.log("Starting training worker thread...");
    const worker = callTrainingWorkerThread(
      trainWorkerUrl,
      'Flow Matching',
      modelConfig,
      datasetPath,
      trainingConfig,
      async (tfModelPath: string) => {
        console.log('Training finished!', tfModelPath);
        onTrainingEnd?.();
        // Auto-download the trained model
        await downloadModelFromIndexedDB(tfModelPath, 'flow_matching_model');
        resolve({ modelPath: tfModelPath, worker });
      },
      (epoch: number, _samples: unknown, loss: number) => {
        console.log(`Epoch ${epoch}: loss = ${loss?.toFixed(6) ?? 'N/A'}`);
      }
    );
  });
}

export async function trainRectifiedFlow(
  settings: TrainingSettings,
  trainWorkerUrl: string,
  onEpochCallback?: (epoch: number, rectifiedStep: number) => void,
  onRectifiedStepCallback?: (rectifiedStep: number, trajectories: number[][] | null) => void
): Promise<{ data: RectifiedFlowData; worker: Worker }> {
  console.log('Starting rectified flow training...');
  const modelConfig = settings.modelConfig;
  const rectifiedFlowConfig = settings.rectifiedFlowTrainingConfig;
  // Build absolute URL for worker to fetch (workers don't have same base URL context)
  const datasetPath = new URL('/' + globalSettings.targetDistributionPointsPath, window.location.origin).href;

  return new Promise((resolve) => {
    console.log("Starting rectified flow training worker thread...");
    const worker = callRectifiedFlowTrainingWorker(
      trainWorkerUrl,
      'Flow Matching', // trainingObjective is constant
      modelConfig,
      datasetPath,
      rectifiedFlowConfig,
      // Finish callback
      async (tfModelPath: string, allRectifiedTrajectories: number[][][][]) => {
        console.log('Rectified flow training finished!', tfModelPath);
        console.log('Collected', allRectifiedTrajectories.length, 'rectified steps');

        // Auto-download the trained rectified flow model
        await downloadModelFromIndexedDB(tfModelPath, 'rectified_flow_model');

        const data: RectifiedFlowData = {
          allRectifiedTrajectories,
          modelPath: tfModelPath
        };

        resolve({ data, worker });
      },
      // Epoch callback
      (epoch: number, rectifiedStep: number, _intermediateSamples: number[][] | null, loss?: number) => {
        console.log(`Rectified step ${rectifiedStep}, epoch ${epoch}: loss = ${loss?.toFixed(6) ?? 'N/A'}`);
        onEpochCallback?.(epoch, rectifiedStep);
      },
      // Rectified step callback
      (rectifiedStep: number, trajectories: number[][] | null) => {
        console.log(`Completed rectified step ${rectifiedStep}`);
        if (trajectories) {
          console.log('  Trajectories shape:', trajectories.length, 'samples');
        }
        onRectifiedStepCallback?.(rectifiedStep, trajectories);
      }
    );
  });
}
