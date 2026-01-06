/**
 * Shared utilities for training and sampling scripts
 */

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, '..');

// ============== Configuration ==============

export const OBJECTIVES = ['Flow Matching', 'Diffusion'] as const;
export type Objective = typeof OBJECTIVES[number];

export const DATASETS = ['smiley_face', 'three_modes'] as const;
export type Dataset = typeof DATASETS[number];

export const DOMAIN_RANGE = {
    xMin: -3,
    xMax: 3,
    yMin: -3,
    yMax: 3,
};

export interface TrainingConfig {
    dim: number;
    hidden: number;
    epochs: number;
    batchSize: number;
    updateInterval: number;
    T?: number;              // For diffusion models
    betaStart?: number;      // For diffusion models
    betaEnd?: number;        // For diffusion models
    networkType?: 'simple' | 'improved';  // For diffusion models
}

export const TRAINING_CONFIGS: Record<Objective, TrainingConfig> = {
    'Flow Matching': {
        dim: 2,
        hidden: 64,
        epochs: 2000,
        batchSize: 1024,
        updateInterval: 100,
    },
    'Diffusion': {
        dim: 2,
        hidden: 128,
        epochs: 3000,
        batchSize: 1024,
        updateInterval: 100,
        T: 1000,
        betaStart: 1e-4,
        betaEnd: 2e-2,
        networkType: 'improved',
    },
};

export interface SamplingConfig {
    numSamples: number;
    numSteps: number;
    gridResolution: number;
}

export const SAMPLING_CONFIG: SamplingConfig = {
    numSamples: 500,
    numSteps: 100,
    gridResolution: 15,
};

// ============== Path Helpers ==============

/**
 * Convert objective name to snake_case for file paths
 */
export function objectiveToSnakeCase(objective: Objective): string {
    return objective.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Get dataset path
 */
export function getDatasetPath(dataset: Dataset): string {
    return path.join(ROOT, 'static', 'datasets', `${dataset}.json`);
}

/**
 * Get model output directory
 */
export function getModelDir(objective: Objective, dataset: Dataset): string {
    const objectiveSnake = objectiveToSnakeCase(objective);
    return path.join(ROOT, 'static', 'models', `${objectiveSnake}_${dataset}`);
}

/**
 * Get model JSON path
 */
export function getModelPath(objective: Objective, dataset: Dataset): string {
    return path.join(getModelDir(objective, dataset), 'model.json');
}

/**
 * Get cached samples output path
 */
export function getSamplesPath(objective: Objective, dataset: Dataset, type: 'samples' | 'grid'): string {
    const objectiveSnake = objectiveToSnakeCase(objective);
    return path.join(ROOT, 'static', 'cached_samples', `${objectiveSnake}_${dataset}_${type}.json`);
}

// ============== Backend ==============

/**
 * Initialize TensorFlow.js with WASM backend
 */
export async function initBackend(): Promise<void> {
    await tf.setBackend('wasm');
    await tf.ready();
    console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
    console.log(`TensorFlow.js Version: ${tf.version.tfjs}\n`);
}

// ============== Dataset ==============

/**
 * Load dataset from JSON file
 */
export function loadDataset(datasetPath: string): tf.Tensor2D {
    const rawData = fs.readFileSync(datasetPath, 'utf-8');
    const data = JSON.parse(rawData);
    return tf.tensor2d(data.points);
}

// ============== Model Serialization ==============

/**
 * Ensure directory exists
 */
export function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Save model to filesystem (manual serialization for WASM backend)
 */
export async function saveModel(model: tf.LayersModel, outputDir: string, name: string): Promise<string> {
    ensureDir(outputDir);

    // Get model topology and weights
    const topoJSON = model.toJSON();
    const modelTopology = typeof topoJSON === 'string' ? JSON.parse(topoJSON) : topoJSON;
    const weights = model.getWeights();

    // Create model JSON
    const modelJSON: tf.io.ModelJSON = {
        modelTopology,
    } as tf.io.ModelJSON;

    // Serialize weights to binary
    const weightSpecs: tf.io.WeightsManifestEntry[] = [];
    const weightDataArrays: ArrayBuffer[] = [];

    for (let i = 0; i < weights.length; i++) {
        const weight = weights[i];
        const weightName = model.weights[i].name;
        const data = await weight.data();

        weightSpecs.push({
            name: weightName,
            shape: weight.shape,
            dtype: weight.dtype as 'float32' | 'int32' | 'bool' | 'string' | 'complex64',
        });

        const buffer = new ArrayBuffer(data.byteLength);
        new (data.constructor as Float32ArrayConstructor)(buffer).set(data as Float32Array);
        weightDataArrays.push(buffer);
    }

    // Concatenate weight buffers
    const totalBytes = weightDataArrays.reduce((sum, buf) => sum + buf.byteLength, 0);
    const combinedBuffer = new ArrayBuffer(totalBytes);
    const combinedView = new Uint8Array(combinedBuffer);
    let offset = 0;
    for (const buf of weightDataArrays) {
        combinedView.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
    }

    // Add weights manifest
    const weightsManifest: tf.io.WeightsManifestConfig = [{
        paths: [`${name}.weights.bin`],
        weights: weightSpecs,
    }];
    modelJSON.weightsManifest = weightsManifest;

    // Write files
    const jsonPath = path.join(outputDir, `${name}.json`);
    const weightsPath = path.join(outputDir, `${name}.weights.bin`);

    fs.writeFileSync(jsonPath, JSON.stringify(modelJSON));
    fs.writeFileSync(weightsPath, Buffer.from(combinedBuffer));

    // Cleanup
    weights.forEach(w => w.dispose());

    return jsonPath;
}

/**
 * Load model from filesystem (manual deserialization for WASM backend)
 */
export async function loadModel(modelJsonPath: string): Promise<tf.LayersModel> {
    // Read model topology
    const modelJSON = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));

    // Read weights binary
    const weightsManifest = modelJSON.weightsManifest;
    if (!weightsManifest || weightsManifest.length === 0) {
        throw new Error('No weights manifest found in model JSON');
    }

    const modelDir = path.dirname(modelJsonPath);
    const weightSpecs: tf.io.WeightsManifestEntry[] = [];
    const weightDataArrays: ArrayBuffer[] = [];

    for (const group of weightsManifest) {
        weightSpecs.push(...group.weights);
        for (const weightPath of group.paths) {
            const fullPath = path.join(modelDir, weightPath);
            const buffer = fs.readFileSync(fullPath);
            weightDataArrays.push(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
        }
    }

    // Concatenate weight buffers
    const totalBytes = weightDataArrays.reduce((sum, buf) => sum + buf.byteLength, 0);
    const combinedBuffer = new ArrayBuffer(totalBytes);
    const combinedView = new Uint8Array(combinedBuffer);
    let offset = 0;
    for (const buf of weightDataArrays) {
        combinedView.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
    }

    // Create model from topology
    const modelTopology = modelJSON.modelTopology || modelJSON;
    const model = await tf.models.modelFromJSON({ modelTopology });

    // Decode and set weights
    const weightTensors = tf.io.decodeWeights(combinedBuffer, weightSpecs);
    const weightValues: tf.Tensor[] = [];
    for (const weight of model.weights) {
        const tensor = weightTensors[weight.name];
        if (tensor) {
            weightValues.push(tensor);
        } else {
            const baseName = weight.originalName || weight.name;
            const found = weightTensors[baseName];
            if (found) {
                weightValues.push(found);
            } else {
                throw new Error(`Weight not found: ${weight.name}`);
            }
        }
    }
    model.setWeights(weightValues);

    // Cleanup
    Object.values(weightTensors).forEach(t => t.dispose());

    return model;
}

// ============== Helpers ==============

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
}

/**
 * Parse command line arguments
 */
export function parseArgs(): { objective?: Objective; dataset?: Dataset } {
    const args = process.argv.slice(2);
    let objective: Objective | undefined;
    let dataset: Dataset | undefined;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--objective' && args[i + 1]) {
            const val = args[i + 1];
            if (OBJECTIVES.includes(val as Objective)) {
                objective = val as Objective;
            } else {
                console.error(`Invalid objective: ${val}. Valid options: ${OBJECTIVES.join(', ')}`);
                process.exit(1);
            }
            i++;
        } else if (args[i] === '--dataset' && args[i + 1]) {
            const val = args[i + 1];
            if (DATASETS.includes(val as Dataset)) {
                dataset = val as Dataset;
            } else {
                console.error(`Invalid dataset: ${val}. Valid options: ${DATASETS.join(', ')}`);
                process.exit(1);
            }
            i++;
        }
    }

    return { objective, dataset };
}
