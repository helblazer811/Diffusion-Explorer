import { writable, get, readable } from 'svelte/store';
import * as settings from '$lib/settings';

export const numberOfSteps = readable(200);
export const numSamples = readable(500);
export const trainingObjective = readable("Conditional Diffusion");
export const sampler = readable("DDPM");
export const datasetName = readable("Three Modes");
export const datasetDict = writable({});
export const targetDistributionSamples = writable(undefined);
export const sourceDistributionSamples = writable(undefined);
export const currentDistributionSamples = writable(undefined);
export const distributionVisiblity = readable({
    target: true,
    source: true,
    current: true,
    training: false,
})
export const allTimeSamples = writable(undefined);
export const allTimeGridSamples = writable(undefined);
export const model = writable(null);
export const currentTime = writable(0);
export const playbackSpeed = readable(30);
export const activePlotTypes = readable(["Contour", "Scatter"]);
export const cachedModelPaths = writable({}); // Cache for models
export const usePretrained = readable(true);
// TODO: perhaps package these into mutually exclusive page states, rather than independent stores
export const isPlaying = writable(false);