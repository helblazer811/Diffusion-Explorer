import { writable, get } from 'svelte/store';
import * as settings from '$lib/settings';

export const numberOfSteps = writable(200);
export const numSamples = writable(500);
export const epochValue = writable(0);
export const trainingObjective = writable("Flow Matching");
export const sampler = writable("Euler");
export const datasetName = writable("Smiley Face");
export const targetDistributionSamples = writable(undefined);
export const sourceDistributionSamples = writable(undefined);
export const currentDistributionSamples = writable(undefined);
export const intermediateTrainingSamples = writable(undefined);
export const distributionVisiblity = writable({
    target: true,
    source: true,
    current: true,
    training: false,
})
export const allTimeSamples = writable(undefined);
export const model = writable(null);
export const currentTime = writable(0);
export const playbackSpeed = writable(30);
export const domainRange = writable({
    xMin: -3.0,
    xMax: 3.0,
    yMin: -3.0,
    yMax: 3.0,
});
export const activePlotTypes = writable(
    settings.trainingObjectiveToDisplayOptions[get(trainingObjective)]["Default Plot Types"]
);
export const cachedModelPaths = writable({}); // Cache for models
// TODO: perhaps package these into mutually exclusive page states, rather than independent stores
export const isPlaying = writable(false);
export const isTraining = writable(false);
export const isEditing = writable(false);
