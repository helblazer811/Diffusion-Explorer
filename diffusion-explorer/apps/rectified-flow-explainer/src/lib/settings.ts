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

  // Worker URLs (bundled to static/workers/ for production)
  trainWorkerUrl: '/workers/train.worker.js',
  samplingWorkerUrl: '/workers/sampling.worker.js',

  // Model paths (null means train from scratch, otherwise load from path)
  flowMatchingModelPath: "/models/flow_matching_model.json" as string | null,
  rectifiedFlowModelPath: "/models/rectified_flow_model.json" as string | null,

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
      // Important: use > 1000 epochs for good sampling quality
      epochs: 2000,
      batchSize: 1024,
      verbose: true,
      displayInterval: 100
    },
    rectifiedFlowTrainingConfig: {
      num_rectified_steps: 4,
      epochs_per_rectified_step: 2000,
      batchSize: 1024,
      num_simulation_steps: 200
    }
  } as TrainingSettings,

  // ========== STYLING SETTINGS ==========
  stylingSettings: {
    // Global styling
    global: {
      figureWidth: 800
    },
    // Layout for source/target distribution positioning
    layout: {
      sourceCenterX: 0.25,  // Source distribution centered at 25% of width
      targetCenterX: 0.75   // Target distribution centered at 75% of width
    },
    // Label styling
    label: {
      fontSize: 28,
      fontWeight: 400,
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
      color: '#666',
      outline: true,
      outlineColor: '#fff',
      outlineWidth: 3,
      outlineOpacity: 0.5,
      fontSize: 20,
      latexLabelOffsetY: -10
    },
    // Trajectory styling
    trajectory: {
      color: '#f17720',           // Orange
      strokeWidth: 3,
      endpointRadius: 3,          // Endpoint circle radius
      progressOpacity: 0.8,       // Animated paths
      previewOpacity: 0.0,        // Preview path opacity (0 = hidden)
      outline: {
        enabled: true,
        color: '#ffffff',         // Black outline
        width: 0,                 // Outline width (should be > strokeWidth)
        opacity: 1.0              // Outline opacity
      }
    },
    // Contour plot styling
    contour: {
      bandwidth: 15,
      thresholds: 3,
      opacity: 0.3,
      fillColor: '#f17720',
      blendMode: undefined as string | undefined
    }
  }
};
