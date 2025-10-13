import { writable, get } from 'svelte/store';
import * as settings from '$lib/settings';

export function createMainState() {
  const trainingObjective = writable("Flow Matching");

  return {
    numberOfSteps: writable(200),
    numSamples: writable(500),
    epochValue: writable(0),
    trainingObjective,
    sampler: writable("Euler"),
    datasetName: writable("Smiley Face"),
    datasetDict: writable({}),
    targetDistributionSamples: writable(undefined),
    sourceDistributionSamples: writable(undefined),
    currentDistributionSamples: writable(undefined),
    intermediateTrainingSamples: writable(undefined),
    distributionVisiblity: writable({
      target: true,
      source: true,
      current: true,
      training: false,
    }),
    allTimeSamples: writable(undefined),
    allTimeGridSamples: writable(undefined),
    model: writable(null),
    currentTime: writable(0),
    playbackSpeed: writable(30),
    activePlotTypes: writable(
      settings.trainingObjectiveToDisplayOptions[get(trainingObjective)]["Default Plot Types"]
    ),
    cachedModelPaths: writable({}), // Cache for models
    usePretrained: writable(true),
    isPlaying: writable(false),
    isTraining: writable(false),
    isEditing: writable(false),
  };
}