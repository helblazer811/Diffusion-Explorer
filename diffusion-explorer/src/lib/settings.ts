import { FlowModel } from '$lib/diffusion/flow_matching';
import { DiffusionModel } from '$lib/diffusion/diffusion';

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
        "Plot Types": ["Contour", "Scatter", "Mesh"],
        "Default Plot Types": ["Contour", "Scatter"],
    }, 
    "Diffusion": {
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
    "Diffusion"
];

export const trainingObjectiveToSamplers: Record<string, string[]> = {
    "Flow Matching": [
        "Euler",
    ],
    "Diffusion": [
        "DDPM",
        // "DDIM" // TODO: Implement DDIM
    ]
};

export const pretrainedModelPaths: Record<string, Record<string, string>> = {
    "Flow Matching": {
        "Three Modes": "/models/flow_matching_three_modes/model.json",
        // "Concentric Circles": "/models/flow_matching_concentric_circles/model.json",
        "Smiley Face": "/models/flow_matching_smiley_face/model.json",
    },
    "Diffusion": {
        "Smiley Face": "/models/diffusion_smiley_face/model.json",
    }
};

export const cachedSamplesPaths: Record<string, Record<string, string>> = {
    "Flow Matching": {
        // "Three Modes": "/cached_samples/flow_matching_euler_three_modes.json",
        "Smiley Face": "/cached_samples/flow_matching_euler_smiley_face_samples.json",
    },
}

export const cachedGridSamplesPaths: Record<string, Record<string, string>> = {
    "Flow Matching": {
        // "Three Modes": "/cached_samples/flow_matching_euler_three_modes_grid.json",
        "Smiley Face": "/cached_samples/flow_matching_euler_smiley_face_grid.json",
    },
}

export const trainingObjectiveToModelClass: Record<string, any> = {
    "Flow Matching": FlowModel,
    "Diffusion": DiffusionModel
};

export interface ModelConfig {
    dim: number;
    hidden: number;
}

export const trainingObjectiveToModelConfig: Record<string, ModelConfig> = {
    "Flow Matching": {
        dim: 2,
        hidden: 64,
    },
    "Diffusion": {
        dim: 2,
        hidden: 64,
    }
};

export const trainingConfig: {
    epochs: number;
    batchSize: number;
    updateInterval: number;
} = {
    epochs: 1000,
    batchSize: 200,
    updateInterval: 10,
};

export const datasetNameToPath: Record<string, string> = {
    "Smiley Face": "/datasets/smiley_face.json",
    "Three Modes": "/datasets/three_modes.json",
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
    xMin: -3.0,
    xMax: 3.0,
    yMin: -3.0,
    yMax: 3.0,
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
} = {
    opacity: 0.4,
    showBorder: false,
    borderWidth: 1,
    bandwidth: 30,
    contourLevels: 4,
};

export const scatterPlotSettings: {
    pointRadius: number;
    pointColor: string;
    pointOpacity: number;
} = {
    pointRadius: 3,
    pointColor: "rgba(255, 100, 0, 1)",
    pointOpacity: 0.4,
};

export const meshPlotSettings: {
    gridResolution: number;
    gridColor: string;
} = {
    gridResolution: 7,
    gridColor: "rgba(35, 35, 35, 1.0)",
};