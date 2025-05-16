import { writable, get } from 'svelte/store';
import * as settings from '$lib/settings';

export const numberOfSteps = writable(100);
export const numSamples = writable(50);
export const trainingObjective = writable("Diffusion");
export const sampler = writable("DDPM");
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
    xMin: -3.0,
    xMax: 3.0,
    yMin: -3.0,
    yMax: 3.0,
});
export const activePlotTypes = writable(
    settings.trainingObjectiveToDisplayOptions[get(trainingObjective)]["Default Plot Types"]
);