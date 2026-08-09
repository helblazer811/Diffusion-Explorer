import * as d3 from "d3";

// ========== SETTINGS OBJECT ==========

export const settings = {
  // Developer mode: when true, figures render a TimelineInspector below them.
  // Code-only toggle for now. Should be false on commits to main.
  devMode: false,

  // ========== STYLING SETTINGS ==========
  stylingSettings: {
    global: {
      figureWidth: 800
    },
    colors: {
      point: "#f97316"
    },
    point: {
      radius: 5,
      trailRadius: 4,
      particleRadius: 12
    },
    path: {
      connectorWidth: 2,
      pathlineWidth: 10
    }
  }
};

// ========== HEATMAP COLOR SCHEME ==========

// Shared color ramp for target-density heatmaps across all figures. Maps a
// normalized density value t ∈ [0, 1] to an RGB triple. The d3.interpolateBlues
// scale is squeezed into [0.15, 0.70] so the lightest cells stay readable
// against white and the darkest don't crowd the foreground points.
const HEATMAP_COLOR_LO = 0.15;
const HEATMAP_COLOR_HI = 0.70;

export function heatmapColor(t: number): { r: number; g: number; b: number } {
  const u = HEATMAP_COLOR_LO + (HEATMAP_COLOR_HI - HEATMAP_COLOR_LO) * t;
  return d3.color(d3.interpolateBlues(u))?.rgb() ?? d3.rgb(255, 255, 255);
}
