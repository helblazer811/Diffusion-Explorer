import { FlowModel } from '$lib/diffusion/flow_matching';
import { DiffusionModel } from '$lib/diffusion/diffusion';
import { base } from '$app/paths';

export const backend: "webgl" | "wasm" = "webgl";

type PlotType = "Contour Plot" | "Scatter Plot" | "Mesh Plot";

export interface DisplayOptions {
    "Plot Types": PlotType[];
    "Default Plot Types": PlotType[];
}

export const trainingObjectiveToDisplayOptions: Record<string, DisplayOptions> = {
    "Flow Matching": {
        "Plot Types": ["Contour Plot", "Scatter Plot", "Mesh Plot"],
        "Default Plot Types": ["Contour Plot"],
    }, 
    "Diffusion": {
        "Plot Types": ["Contour Plot", "Scatter Plot"],
        "Default Plot Types": ["Contour Plot"],
    },
};

export interface HyperparameterMenuEntry {
    name: string;
    options: string[];
}

export const hyperparameterMenuConfig: Record<string, HyperparameterMenuEntry> = {
    "Training Objective": {
        name: "Training Objective",
        options: [
            "Flow Matching",
            // "Diffusion"
        ]
    },
    "Sampler": {
        name: "Sampler",
        options: [
            "Euler",
        ]
    }
};

export const pretrainedModelPaths: Record<string, Record<string, string>> = {
    "Flow Matching": {
        "Three Modes": base + "/models/flow_matching_three_modes/model.json",
        // "Concentric Circles": "/models/flow_matching_concentric_circles/model.json",
        "Smiley Face": base + "/models/flow_matching_smiley_face/model.json",
    }
    // "Diffusion": "/models/diffusion_model.json",
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
    iterations: 2000,
    batchSize: 32,
};

export const datasetNameToPath: Record<string, string> = {
    "Smiley Face": base + "/datasets/smiley_face.json",
    "Three Modes": base + "/datasets/three_modes.json",
    // "Concentric Circles": "/datasets/concentric_circles.json",
};

export const interfaceSettings: {
    distributionWidth: number;
    distributionHeight: number;
    mainAreaHeight: number;
    miniDistributionWidth: number;
    displayAreaWidth: number;
    displayAreaHeight: number;
    pointColor: string;
} = {
    distributionWidth: 500,
    distributionHeight: 500,
    mainAreaHeight: 640,
    miniDistributionWidth: 40,
    displayAreaWidth: 1400,
    displayAreaHeight: 500,
    pointColor: "#4594e3",
};
