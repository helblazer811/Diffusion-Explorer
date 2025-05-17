import { FlowModel } from '$lib/diffusion/flow_matching';
import { DiffusionModel } from '$lib/diffusion/diffusion';

export const backend: "webgl" | "wasm" = "webgl";

type PlotType = "Contour" | "Scatter" | "Mesh" | "Trajectories";

export interface DisplayOptions {
    "Plot Types": PlotType[];
    "Default Plot Types": PlotType[];
}

export const trainingObjectiveToDisplayOptions: Record<string, DisplayOptions> = {
    "Flow Matching": {
        "Plot Types": ["Contour", "Scatter", "Mesh", "Trajectories"],
        "Default Plot Types": ["Contour", "Trajectories"],
    }, 
    "Diffusion": {
        "Plot Types": ["Contour", "Scatter"],
        "Default Plot Types": ["Contour"],
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
        "DDIM"
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
    iterations: number;
    batchSize: number;
} = {
    iterations: 200000,
    batchSize: 200,
};

export const datasetNameToPath: Record<string, string> = {
    "Smiley Face": "/datasets/smiley_face.json",
    "Three Modes": "/datasets/three_modes.json",
    // "Concentric Circles": "/datasets/concentric_circles.json",
};

export const miniDistributionSettings: {
    pointRadius: number;
    pointColor: string;
} = {
    pointRadius: 2,
    pointColor: "rgba(25, 131, 255, 1.0)"
};

export const scatterPlotSettings: {
    pointRadius: number;
    pointColor: string;
    pointOpacity: number;
} = {
    pointRadius: 5,
    pointOpacity: 0.6,
};

export const interfaceSettings: {
    distributionWidth: number;
    distributionHeight: number;
    mainAreaHeight: number;
    miniDistributionWidth: number;
    displayAreaWidth: number;
    displayAreaHeight: number;
    pointColor: string;
    scatterPlotOpacity: number;
} = {
    distributionWidth: 500,
    distributionHeight: 500,
    mainAreaHeight: 640,
    miniDistributionWidth: 40,
    displayAreaWidth: 1200,
    displayAreaHeight: 500,
};
