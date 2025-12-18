/**
 * Client for Rectified Flow Training Worker
 *
 * Manages the lifecycle of the rectified flow training worker and provides
 * a simple callback-based API for tracking training progress.
 */

export interface RectifiedFlowConfig {
  trainingObjective: string;
  modelConfig: {
    dim: number;
    hidden: number;
  };
  datasetPath: string;
  trainingConfig: {
    epochs: number;
    batchSize: number;
    verbose: boolean;
    displayInterval: number;
  };
  numRectifiedPhases: number;
  samplingConfig: {
    numSteps: number;
    numSamples: number;
  };
  storageMode: 'final_only' | 'all_phases';
}

export interface RectifiedFlowCallbacks {
  onProgress?: (data: { phase: number; epoch: number; totalEpochs: number }) => void;
  onPhaseComplete?: (data: { phase: number; modelPath: string; trajectories: number[][][] }) => void;
  onComplete: (data: {
    finalModelPath: string;
    allModels?: string[];
    finalTrajectories: number[][][];
    allTrajectories?: number[][][][];
  }) => void;
  onError?: (error: string) => void;
}

/**
 * Start rectified flow training in a web worker
 *
 * @param config - Configuration for training including model, dataset, and rectified flow parameters
 * @param callbacks - Callbacks for progress, phase completion, and final results
 * @returns Worker instance that can be terminated to stop training
 */
export function startRectifiedFlowTraining(
  config: RectifiedFlowConfig,
  callbacks: RectifiedFlowCallbacks
): Worker {
  // Create the worker
  const worker = new Worker(
    new URL('./rectifiedFlowTrain.worker.ts', import.meta.url),
    { type: 'module' }
  );

  // Set up message handler
  worker.onmessage = (event) => {
    const { type, data } = event.data;

    switch (type) {
      case 'progress':
        callbacks.onProgress?.(data);
        break;

      case 'phaseComplete':
        callbacks.onPhaseComplete?.(data);
        break;

      case 'complete':
        callbacks.onComplete(data);
        break;

      case 'error':
        callbacks.onError?.(data.message);
        break;

      default:
        console.warn('Unknown message type from worker:', type);
    }
  };

  // Handle worker errors
  worker.onerror = (error) => {
    callbacks.onError?.(error.message || 'Worker error occurred');
  };

  // Start training by sending config to worker
  worker.postMessage({ type: 'start', config });

  return worker;
}
