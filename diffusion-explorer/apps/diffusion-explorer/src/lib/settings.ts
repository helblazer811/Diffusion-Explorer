import { base } from '$app/paths';

import { FlowModel, DiffusionModel, ConditionalDiffusionModel, type NetworkType } from '@diffusion-explorer/diffusion';

export const backend: "webgl" | "wasm" = "webgl";

type PlotType = "Contour" | "Scatter" | "Mesh" | "Path";

export const plotTypes: PlotType[] = ["Contour", "Scatter", "Mesh", "Path"];

export const downloadSamplesIfNotCached: boolean = false;

export interface DisplayOptions {
    "Plot Types": PlotType[];
    "Default Plot Types": PlotType[];
}

export const trainingObjectiveToDisplayOptions: Record<string, DisplayOptions> = {
    "Flow Matching": {
        "Plot Types": ["Contour", "Scatter", "Mesh", "Path"],
        "Default Plot Types": ["Contour", "Scatter", "Path"],
    }, 
    "Diffusion": {
        "Plot Types": ["Contour", "Scatter", "Path"],
        "Default Plot Types": ["Contour", "Scatter", "Path"],
    },
    "Conditional Diffusion": {
        "Plot Types": ["Contour", "Scatter"],
        "Default Plot Types": ["Contour", "Scatter"],
    },
};

export interface HyperparameterMenuEntry {
    name: string;
    options: string[];
}

export const trainingObjectives: string[] = [
    "Flow Matching",
    "Diffusion",
    "Conditional Diffusion",
];

export const trainingObjectiveToSamplers: Record<string, string[]> = {
    "Flow Matching": [
        "Euler",
    ],
    "Diffusion": [
        "DDPM",
        // "DDIM" // TODO: Implement DDIM
    ],
    "Conditional Diffusion": [
        "DDPM",
    ],
};

export const pretrainedModelPaths: Record<string, Record<string, string>> = {
    "Flow Matching": {
        "Three Modes": `/models/flow_matching_three_modes/model.json`,
        // "Concentric Circles": "/models/flow_matching_concentric_circles/model.json",
        "Smiley Face": `/models/flow_matching_smiley_face/model.json`,
    },
    "Diffusion": {
        "Smiley Face": `/models/diffusion_smiley_face/model.json`,
    },
    "Conditional Diffusion": {
        "Three Modes": `/models/conditional_diffusion_three_modes/model.json`,
    }
};

export const cachedSamplesPaths: Record<string, Record<string, string>> = {
    "Flow Matching": {
        "Three Modes": "/cached_samples/flow_matching_three_modes_samples.json",
        "Smiley Face": "/cached_samples/flow_matching_smiley_face_samples.json",
    },
    "Diffusion": {
        "Smiley Face": "/cached_samples/diffusion_smiley_face_samples.json",
    },
}

export const cachedGridSamplesPaths: Record<string, Record<string, string>> = {
    "Flow Matching": {
        "Three Modes": "/cached_samples/flow_matching_three_modes_grid.json",
        "Smiley Face": "/cached_samples/flow_matching_smiley_face_grid.json",
    },
    "Diffusion": {
        "Smiley Face": "/cached_samples/diffusion_smiley_face_grid.json",
    },
}

export const trainingObjectiveToModelClass: Record<string, any> = {
    "Flow Matching": FlowModel,
    "Diffusion": DiffusionModel,
    "Conditional Diffusion": ConditionalDiffusionModel,
};

export interface ModelConfig {
    dim: number;
    hidden: number;
    condDim?: number;
    networkType?: NetworkType;  // 'simple' or 'improved' (for diffusion models)
}

export const trainingObjectiveToModelConfig: Record<string, ModelConfig> = {
    "Flow Matching": {
        dim: 2,
        hidden: 64,
    },
    "Diffusion": {
        dim: 2,
        hidden: 128,
        networkType: 'improved',  // Use improved network with positional embeddings
    },
    "Conditional Diffusion": {
        dim: 2,
        condDim: 3, // TODO: make this dynamic based on dataset
        hidden: 64,
    },
};

export const trainingConfig: {
    epochs: number;
    batchSize: number;
    updateInterval: number;
} = {
    epochs: 4000,
    batchSize: 1000,
    updateInterval: 50,
};

export const datasetNameToPath: Record<string, string> = {
    "Smiley Face": `/datasets/smiley_face.json`,
    "Three Modes": `/datasets/three_modes.json`,
    // "Concentric Circles": "/datasets/concentric_circles.json",
};

export const miniDistributionSettings: {
    width: number;
    height: number;
    pointRadius: number;
    pointColor: string;
} = {
    width: 26,
    height: 26,
    pointRadius: 1,
    pointColor: "rgba(25, 131, 255, 1.0)"
};

export const interfaceSettings: {
    distributionWidth: number;
    distributionHeight: number;
    mainAreaHeight: number;
    displayAreaWidth: number;
    displayAreaHeight: number;
    pointColor: string;
    scatterPlotOpacity: number;
} = {
    distributionWidth: 500,
    distributionHeight: 500,
    mainAreaHeight: 640,
    displayAreaWidth: 1300,
    displayAreaHeight: 500,
};

export const domainRange: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
} = {
    xMin: -3,
    xMax: 3,
    yMin: -3,
    yMax: 3,
};

/* Styling for the various plots */

export const contourPlotSettings: {
    opacity: number;
    showBorder: boolean;
    fillColor: string;
    borderColor: string;
    borderWidth: number;
    bandwidth: number;
    contourLevels: number;
    // Colors for different distribution types
    sourceColor: string;
    targetColor: string;
    currentColor: string;
    trainingColor: string;
} = {
    opacity: 0.2,
    showBorder: false,
    fillColor: "#1983FF",
    borderColor: "#333",
    borderWidth: 1,
    bandwidth: 5,  // ~5% of grid size (100), for detailed contours
    contourLevels: 4,
    // Distribution-specific colors (hex) - use with opacity separately
    sourceColor: "#1983FF",      // Blue
    targetColor: "#1983FF",      // Blue
    currentColor: "#FF6400",     // Orange
    trainingColor: "#FF6400",    // Orange
};

export const scatterPlotSettings: {
    pointRadius: number;
    pointColor: string;
    pointOpacity: number;
} = {
    pointRadius: 5,
    pointColor: "rgba(255, 100, 0, 1)",
    pointOpacity: 0.6,
};

export const meshPlotSettings: {
    gridResolution: number;
    gridColor: string;
} = {
    gridResolution: 15,
    gridColor: "rgba(35, 35, 35, 1.0)",
};

export const titleSettings: {
    fontSize: number;
    color: string;
    fontFamily: string;
} = {
    fontSize: 28,
    color: "#555555",
    fontFamily: "Inter, sans-serif",
};