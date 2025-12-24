// ========== INTERFACES ==========

export interface VectorFieldData {
  gridResolution: number;
  timeSteps: number[];
  domainRange: { xMin: number; xMax: number; yMin: number; yMax: number };
  velocities: number[][][];
  gridPoints: number[][];
}

export interface RectifiedFlowData {
  allRectifiedTrajectories: number[][][][]; // [rectified_step][num_timesteps][num_samples][dim]
  modelPath: string;
}

export interface RectifiedFlowConfig {
  num_rectified_steps: number;
  epochs_per_rectified_step: number;
  batchSize: number;
  num_simulation_steps: number;
  sourceDistributionPath: string | null;
}

export interface TrainingSettings {
  trainingObjectiveToModelConfig: {
    [key: string]: { dim: number; hidden: number };
  };
  datasetNameToPath: {
    [key: string]: string;
  };
  trainingConfig: {
    epochs: number;
    batchSize: number;
    verbose: boolean;
    displayInterval: number;
  };
  domainRange: { xMin: number; xMax: number; yMin: number; yMax: number } | null;
}

// ========== SETTINGS OBJECT ==========

export const settings = {
  // Sampling configuration
  numSamples: 100,
  numSteps: 300,

  // Target distribution
  targetDistributionPointsPath: '/data/smiley_face.json',

  // Cached data paths
  cachedTrajectoriesPath: "cached_samples/smiley_face_trajectories.json",
  cachedVectorFieldPath: "cached_samples/smiley_face_vector_field.json",
  cachedRectifiedFlowTrajectoriesPath: "cached_samples/smiley_face_rectified_flow_trajectories.json",

  // Vector field configuration
  vectorFieldGridResolution: 12,
  vectorFieldTimeSteps: 200,

  // Worker URLs
  trainWorkerUrl: 'src/lib/flow_matching_workers/train.worker.js',
  samplingWorkerUrl: 'src/lib/flow_matching_workers/sampling.worker.js',

  // Training objective
  trainingObjective: 'Flow Matching',

  // Rectified flow configuration
  rectifiedFlowConfig: {
    num_rectified_steps: 3,
    epochs_per_rectified_step: 100,
    batchSize: 32,
    num_simulation_steps: 200,
    sourceDistributionPath: null
  } as RectifiedFlowConfig,

  // Training settings
  training: {
    trainingObjectiveToModelConfig: {
      "Flow Matching": { dim: 2, hidden: 64 }
    },
    datasetNameToPath: {
      smiley_face: '/data/smiley_face.json'
    },
    trainingConfig: {
      epochs: 500,
      batchSize: 1024,
      verbose: true,
      displayInterval: 100
    },
    domainRange: null
  } as TrainingSettings,

  // Global styling
  globalStyling: {
    figureWidth: 750
  },

  // Label styling
  labelStyling: {
    fontSize: 22,
    yShiftFactor: 0.5,
    color: '#666'
  },

  // Scatter plot styling
  scatterPlotStyling: {
    radius: 5,
    opacity: 0.25,
    color: '#3b82f6',
    yShiftFactor: -0.5
  }
};
