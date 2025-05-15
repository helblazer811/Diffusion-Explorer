/*
    This file contains fixed settings that don't change. 
*/
import { FlowModel } from '$lib/diffusion/flow_matching';
import { DiffusionModel } from '$lib/diffusion/diffusion';
import { base } from '$app/paths';

/*
    This is a fixed list that says which display options are
    available for each training objective.
*/
export const trainingObjectiveToDisplayOptions = {
    "Flow Matching": {
        "Plot Types": ["Contour Plot", "Scatter Plot", "Mesh Plot"],
        "Default Plot Types": ["Contour Plot"], // Default plot types to show (can be multiple)
    }, 
    "Diffusion": {
        "Plot Types": ["Contour Plot", "Scatter Plot"],
        "Default Plot Types": ["Contour Plot"], // Default plot types to show (can be multiple)
    },
}

export const hyperparameterMenuConfig = {
    "Training Objective": {
        name: "Training Objective",
        options: [
            "Flow Matching",
            // "Diffusion"
        ],
        default: "Flow Matching",
    },
    "Sampler": {
        name: "Sampler",
        options: [
            "Euler",
        ],
        default: "Euler",
    }
};

export const pretrainedModelPaths = {
    "Flow Matching": {
        "Three Modes": base + "/models/flow_matching_three_modes/model.json",
        // "Concentric Circles": "/models/flow_matching_concentric_circles/model.json",
        "Smiley Face": base + "/models/flow_matching_smiley_face/model.json",
    }
    // "Diffusion": "/models/diffusion_model.json",
}

export const trainingObjectiveToModelClass = {
    "Flow Matching": FlowModel,
    "Diffusion": DiffusionModel
};

export const trainingObjectiveToModelConfig = {
    "Flow Matching": {
        dim: 2,
        hidden: 64,
    },
    "Diffusion": {
        dim: 2,
        hidden: 64,
    }
};

export const trainingConfig = {
    iterations: 2000,
    batchSize: 32,
}

export const datasetNameToPath = {
    "Smiley Face": base + "/datasets/smiley_face.json",
    "Three Modes": base + "/datasets/three_modes.json",
    // "Concentric Circles": "/datasets/concentric_circles.json",
};

export const interfaceSettings = {
    distributionWidth: 500,
    distributionHeight: 500,
    mainAreaHeight: 640,
    miniDistributionWidth: 40,
    displayAreaWidth: 1400,
    displayAreaHeight: 500,
    pointColor: "#4594e3",
}