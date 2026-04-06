// Settings for qualifier slides - combines relevant settings from both apps

export const settings = {
  // Rectified flow app paths (prefixed with rf_)
  rf: {
    targetDistributionPath: 'rf_data/smiley_face.json',
    cachedFlowMatchingTrajectoriesPath: 'rf_cached_samples/flow_matching_trajectories.json',
    cachedFlowMatchingVectorFieldPath: 'rf_cached_samples/flow_matching_vector_field.json',
    cachedFlowMatchingGridTrajectoriesPath: 'rf_cached_samples/flow_matching_grid_trajectories.json',
    cachedFlowMatchingDenseTrajectoriesPath: 'rf_cached_samples/flow_matching_dense_trajectories.json',
    cachedRectifiedFlowTrajectoriesPath: 'rf_cached_samples/rectified_flow_trajectories.json',
    cachedRectifiedFlowGridTrajectoriesPath: 'rf_cached_samples/rectified_flow_grid_trajectories.json',
    cachedRectifiedFlowVectorFieldPath: 'rf_cached_samples/rectified_flow_vector_field.json',
    cachedOTCouplingPath: 'rf_cached_samples/ot_coupling.json',
    flowMatchingModelPath: '/rf_models/flow_matching_model.json',
    rectifiedFlowModelPath: '/rf_models/rectified_flow_model.json',
    workerUrl: '/rf_workers/flow_model.worker.js',
  },

  // Continuity equation app paths (prefixed with ce_)
  ce: {
    targetDistributionPath: 'ce_data/smiley_face.json',
    cachedTrajectoriesPath: 'ce_cached_samples/trajectories.json',
    cachedReverseTrajectoriesPath: 'ce_cached_samples/reverse_trajectories.json',
    flowModelPath: '/ce_models/flow_model.json',
    workerUrl: '/ce_workers/flow_model.worker.js',
  },

  // Model settings
  modelSettings: {
    dim: 2,
    hidden: 64,
  },

  // Slide dimensions
  slideWidth: 1920,
  slideHeight: 1080,

  // Figure dimensions for slides (wider than blog)
  figureWidth: 900,
  figureHeight: 500,

  interactiveSettings: {
    maxUserTrajectories: 5,
  },

  stylingSettings: {
    global: { figureWidth: 900 },
    layout: { sourceCenterX: 0.2, targetCenterX: 0.8 },
    label: {
      fontSize: 28, fontWeight: 400, yShiftFactor: 0.5,
      color: '#5e5e5eff', opacity: 0.9,
      outlineColor: '#f9f9f9', outlineOpacity: 0.5,
    },
    scatterPlot: {
      radius: 5, opacity: 0.25, color: '#3b82f6',
      yShiftFactor: -0.5, scaleFactor: 0.8, clippingRadius: 2.0,
    },
    figureLatex: {
      color: '#666', outline: true, outlineColor: '#fff',
      outlineWidth: 3, outlineOpacity: 0.5, fontSize: 24,
      latexLabelOffsetY: -10,
    },
    trajectory: {
      color: '#f17720', strokeWidth: 3, endpointRadius: 3,
      opacity: 0.8, fullOpacity: 1.0, previewOpacity: 0.0,
      outline: { enabled: true, color: '#333333', strokeWidth: 3, opacity: 0.5 },
    },
    contour: {
      bandwidth: 30, thresholds: 3, opacity: 0.3,
      fillColor: '#f17720', blendMode: undefined as string | undefined,
    },
  },
};
