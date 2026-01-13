import { writable, derived, get } from 'svelte/store';
import * as settings from '$lib/settings';

// ============================================================================
// Type Definitions
// ============================================================================

export type AppMode = 'idle' | 'training' | 'editing';

export interface ModeState {
  mode: AppMode;
}

export interface TrainingState {
  epoch: number;
  intermediateSamples: number[][] | undefined;
}

export interface PlaybackState {
  time: number;
  speed: number;
  isPlaying: boolean;
}

export interface DistributionData {
  source: number[][] | undefined;
  target: number[][] | undefined;
  current: number[][] | undefined;
  allTime: number[][][] | undefined;
  allTimeGrid: number[][][][] | undefined;
}

export interface Visibility {
  source: boolean;
  target: boolean;
  current: boolean;
  training: boolean;
}

export interface Config {
  trainingObjective: string;
  sampler: string;
  datasetName: string;
  numberOfSteps: number;
  numSamples: number;
  activePlotTypes: string[];
}

export interface ModelState {
  cachedPaths: Record<string, Record<string, string>>;
  usePretrained: boolean;
}

// ============================================================================
// Store Factory
// ============================================================================

export function createMainState() {
  // App mode (mutually exclusive states)
  const modeState = writable<ModeState>({ mode: 'idle' });

  // Training-specific state
  const trainingState = writable<TrainingState>({
    epoch: 0,
    intermediateSamples: undefined,
  });

  // Playback state
  const playbackState = writable<PlaybackState>({
    time: 0,
    speed: 30,
    isPlaying: false,
  });

  // Distribution sample data
  const distributionData = writable<DistributionData>({
    source: undefined,
    target: undefined,
    current: undefined,
    allTime: undefined,
    allTimeGrid: undefined,
  });

  // Visibility settings
  const visibility = writable<Visibility>({
    source: true,
    target: true,
    current: true,
    training: false,
  });

  // User config/settings
  const config = writable<Config>({
    trainingObjective: 'Flow Matching',
    sampler: 'Euler',
    datasetName: 'Smiley Face',
    numberOfSteps: 200,
    numSamples: 500,
    activePlotTypes: settings.trainingObjectiveToDisplayOptions['Flow Matching']['Default Plot Types'],
  });

  // Model state
  const modelState = writable<ModelState>({
    cachedPaths: {},
    usePretrained: true,
  });

  // Loaded datasets (separate, since it's just data)
  const datasetDict = writable<Record<string, number[][]>>({});

  // ============================================================================
  // Derived stores for convenience
  // ============================================================================

  // Convenience derived stores
  const isTraining = derived(modeState, $m => $m.mode === 'training');
  const isEditing = derived(modeState, $m => $m.mode === 'editing');
  const isPlaying = derived(playbackState, $p => $p.isPlaying);

  return {
    // Grouped stores
    modeState,
    trainingState,
    playbackState,
    distributionData,
    visibility,
    config,
    modelState,
    datasetDict,

    // Derived convenience stores
    isTraining,
    isEditing,
    isPlaying,
  };
}

export type MainState = ReturnType<typeof createMainState>;
