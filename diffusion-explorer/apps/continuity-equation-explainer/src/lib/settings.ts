// ========== SETTINGS OBJECT ==========

export const settings = {
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
      clippingRadius: 1.8
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
      opacity: 0.8,               // Animated paths
      previewOpacity: 0.0,        // Preview path opacity (0 = hidden)
      outline: {
        enabled: true,
        color: '#333333',         // Dark gray outline (visible against light background)
        strokeWidth: 3,           // Outline stroke width (added to trajectory strokeWidth)
        opacity: 0.5              // Outline opacity
      }
    },
    // Contour plot styling
    contour: {
      bandwidth: 30,
      thresholds: [0.4, 0.6, 0.8] as number | number[],
      opacity: 0.3,
      fillColor: '#f17720',
      blendMode: undefined as string | undefined
    }
  }
};
