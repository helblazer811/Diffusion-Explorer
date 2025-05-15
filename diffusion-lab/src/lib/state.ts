import { writable } from 'svelte/store';
import * as settings from '$lib/settings';

export const numberOfSteps = writable(150);
export const numSamples = writable(500);
export const trainingObjective = writable(settings.hyperparameterMenuConfig["Training Objective"].default);
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
    settings.trainingObjectiveToDisplayOptions[
        settings.hyperparameterMenuConfig["Training Objective"].default
    ]["Default Plot Types"]
);