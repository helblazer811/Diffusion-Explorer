// ========== INTERFACES ==========

export interface VectorFieldData {
  gridResolution: number;
  timeSteps: number[];
  domainRange: { xMin: number; xMax: number; yMin: number; yMax: number };
  velocities: number[][][];
  gridPoints: number[][];
}

export interface RectifiedFlowData {
  allRectifiedTrajectories: number[][][][];
  modelPath: string;
}

export interface TrainingSettings {
  modelConfig: { dim: number; hidden: number };
  domainRange: { xMin: number; xMax: number; yMin: number; yMax: number } | null;
  flowMatchingTrainingConfig: {
    epochs: number;
    batchSize: number;
    verbose: boolean;
    displayInterval: number;
  };
  rectifiedFlowTrainingConfig: {
    num_rectified_steps: number;
    epochs_per_rectified_step: number;
    batchSize: number;
    num_simulation_steps: number;
  };
}

// ========== SETTINGS OBJECT ==========

export const settings = {
  // Target distribution (relative path - base will be prepended at runtime)
  targetDistributionPointsPath: 'data/smiley_face.json',

  // Cached data paths (null means generate fresh, string path means try to load)
  // These are relative paths - base will be prepended at runtime
  cachedFlowMatchingTrajectoriesPath: "cached_samples/flow_matching_trajectories.json" as string | null,
  cachedFlowMatchingVectorFieldPath: "cached_samples/flow_matching_vector_field.json" as string | null,
  cachedFlowMatchingGridTrajectoriesPath: "cached_samples/flow_matching_grid_trajectories.json" as string | null,
  cachedRectifiedFlowTrajectoriesPath: "cached_samples/rectified_flow_trajectories.json" as string | null,
  cachedRectifiedFlowGridTrajectoriesPath: "cached_samples/rectified_flow_grid_trajectories.json" as string | null,
  cachedRectifiedFlowVectorFieldPath: "cached_samples/rectified_flow_vector_field.json" as string | null,

  // Worker URLs
  trainWorkerUrl: 'src/lib/flow_matching_workers/train.worker.js',
  samplingWorkerUrl: 'src/lib/flow_matching_workers/sampling.worker.js',

  // Model paths (null means train from scratch, otherwise load from path)
  flowMatchingModelPath: null as string | null,
  rectifiedFlowModelPath: null as string | null,

  // ========== SAMPLING SETTINGS ==========
  samplingSettings: {
    // Flow matching trajectory sampling
    flowMatching: {
      numSamples: 100,
      numSteps: 300
    },
    // Flow matching grid sampling
    flowMatchingGrid: {
      gridResolution: 6,
      gridDomainRange: { xMin: -1.5, xMax: 1.5, yMin: -1.5, yMax: 1.5 },
      numSteps: 300
    },
    // Flow matching vector field sampling
    flowMatchingVectorField: {
      gridResolution: 8,
      numTimeSteps: 200,
      domainRange: { xMin: -2.5, xMax: 2.5, yMin: -2.5, yMax: 2.5 }
    },
    // Rectified flow trajectory sampling
    rectifiedFlow: {
      numSamples: 100,
      numSteps: 300
    },
    // Rectified flow grid sampling
    rectifiedFlowGrid: {
      gridResolution: 6,
      gridDomainRange: { xMin: -1.5, xMax: 1.5, yMin: -1.5, yMax: 1.5 },
      numSteps: 300
    },
    // Rectified flow vector field sampling
    rectifiedFlowVectorField: {
      gridResolution: 8,
      numTimeSteps: 300,
      domainRange: { xMin: -2.5, xMax: 2.5, yMin: -2.5, yMax: 2.5 }
    }
  },

  // ========== TRAINING SETTINGS ==========
  trainingSettings: {
    modelConfig: { dim: 2, hidden: 64 },
    domainRange: null,
    flowMatchingTrainingConfig: {
      epochs: 500,
      batchSize: 1024,
      verbose: true,
      displayInterval: 100
    },
    rectifiedFlowTrainingConfig: {
      num_rectified_steps: 3,
      epochs_per_rectified_step: 200,
      batchSize: 64,
      num_simulation_steps: 200
    }
  } as TrainingSettings,

  // ========== STYLING SETTINGS ==========
  stylingSettings: {
    // Global styling
    global: {
      figureWidth: 750
    },
    // Layout for source/target distribution positioning
    layout: {
      sourceCenterX: 0.2,  // Source distribution centered at 20% of width
      targetCenterX: 0.8   // Target distribution centered at 80% of width
    },
    // Label styling
    label: {
      fontSize: 22,
      yShiftFactor: 0.5,
      color: '#666',
      outlineColor: '#f9f9f9',
      outlineOpacity: 0.5
    },
    // Scatter plot styling
    scatterPlot: {
      radius: 5,
      opacity: 0.25,
      color: '#3b82f6',
      yShiftFactor: -0.5,
      scaleFactor: 0.8,
      clippingRadius: 2.0
    },
    // Figure LaTeX styling
    figureLatex: {
      color: '#666'
    }
  }
};
