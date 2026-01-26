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

export interface OTCouplingData {
  sourcePoints: number[][];
  targetPoints: number[][];
  matching: number[]; // matching[i] = target index for source i
  epsilon: number;
  numSamples: number;
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
  cachedRecursiveRectifiedFlowTrajectoriesPath: null, //"cached_samples/recursive_rectified_flow_grid_trajectories.json" as string | null,
  cachedOTCouplingPath: "cached_samples/ot_coupling.json" as string | null,

  // Worker URL (bundled to static/workers/ for production)
  // Note: These are relative paths. The page component prefixes with base when creating clients.
  flowModelWorkerUrl: '/workers/flow_model.worker.js',

  // Model paths (null means train from scratch, otherwise load from path)
  // Note: These are relative paths. The page component prefixes with base when creating clients.
  flowMatchingModelPath: "/models/flow_matching_model.json" as string | null,
  rectifiedFlowModelPath: "/models/rectified_flow_model.json" as string | null,

  // ========== SAMPLING SETTINGS ==========
  // Used for target distribution loading and interactive sampling
  samplingSettings: {
    numSamples: 150,  // Number of samples to load from target distribution
    numSteps: 300     // Integration steps for interactive sampling
  },

  // ========== INTERACTIVE SETTINGS ==========
  interactiveSettings: {
    maxUserTrajectories: 5,  // Maximum concurrent user-drawn trajectories
  },

  // ========== MODEL SETTINGS ==========
  // Model architecture settings for FlowModelClient initialization
  modelSettings: {
    dim: 2,
    hidden: 64,
    domainRange: null as { xMin: number; xMax: number; yMin: number; yMax: number } | null
  },

  // ========== TRAINING SETTINGS (for test_pathlines) ==========
  trainingSettings: {
    modelConfig: { dim: 2, hidden: 64 },
    domainRange: null as { xMin: number; xMax: number; yMin: number; yMax: number } | null,
    flowMatchingTrainingConfig: {
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
  },

  // ========== STYLING SETTINGS ==========
  stylingSettings: {
    // Global styling
    global: {
      figureWidth: 800
    },
    // Layout for source/target distribution positioning
    layout: {
      sourceCenterX: 0.2,   // Source distribution centered at 20% of width
      targetCenterX: 0.8    // Target distribution centered at 80% of width
    },
    // Label styling
    label: {
      fontSize: 28,
      fontWeight: 400,
      yShiftFactor: 0.5,
      color: '#5e5e5eff',
      opacity: 0.9,
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
      fontSize: 24,
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
      bandwidth: 30,
      thresholds: 3,
      opacity: 0.3,
      fillColor: '#f17720',
      blendMode: undefined as string | undefined
    }
  }
};
