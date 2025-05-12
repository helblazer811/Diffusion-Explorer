import { writable } from 'svelte/store';
import { FlowModel } from '$lib/diffusion/flow_matching';
import {base} from '$app/paths';

// Default values various parts of the UI

export const hyperparameterMenuConfig = {
    "Training Objective": {
        name: "Training Objective",
        options: [
            "Flow Matching",
            // "Diffusion"
        ],
        default: "Flow Matching",
    },
    // "Number of Steps": {
    //     name: "Number of Steps",
    //     options: [
    //         50,
    //         100,
    //         1000
    //     ],
    //     default: 100,
    // },
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

export const modelTypeToModelClass = {
    "Flow Matching": FlowModel
};

export const modelConfig = {
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

export const userInterfaceConfig = {};

export const interfaceSettings = {
    distributionWidth: 500,
    distributionHeight: 500,
    mainAreaHeight: 640,
    miniDistributionWidth: 75,
    displayAreaWidth: 1100,
    displayAreaHeight: 500,
    pointColor: "#4594e3",
}

// Writeable stores for the UI state

export const UIState = writable({
    modelType: hyperparameterMenuConfig["Training Objective"].default,
    numberOfSteps: 200, // Number of steps to take in the sampler
    numSamples: 2000, // Number of samples to generate
    // sourceDistributionSamples: undefined, // This holds a tensorflow tensor containing samples from the source distribution
    // targetDistributionSamples: undefined, // This holds a tensorflow tensor containing samples from the target distribution
    // currentDistributionSamples: undefined, // This holds a tensorflow tensor containing samples from the current distribution
    // allTimeSamples: undefined, // This holds a tensorflow tensor contianing samples from multiple timesteps
    // domainRange: {
    //     xMin: -3,
    //     xMax: 3,
    //     yMin: -3,
    //     yMax: 3,
    // }
});

export const datasetName = writable("Smiley Face");
export const targetDistributionSamples = writable(undefined);
export const sourceDistributionSamples = writable(undefined);
export const currentDistributionSamples = writable(undefined);
export const allTimeSamples = writable(undefined);
export const model = writable(null);
export const currentTime = writable(0);
export const isPlaying = writable(false);
export const playbackSpeed = writable(30);
export const domainRange = writable({
    xMin: -3.5,
    xMax: 3.5,
    yMin: -3.5,
    yMax: 3.5,
});