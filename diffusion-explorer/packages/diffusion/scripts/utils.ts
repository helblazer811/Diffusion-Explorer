// TensorFlow.js with WASM backend (works on Apple Silicon)
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, '..');

/**
 * Initialize TensorFlow.js with WASM backend
 */
export async function initBackend(): Promise<void> {
    await tf.setBackend('wasm');
    await tf.ready();
    console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
    console.log(`TensorFlow.js Version: ${tf.version.tfjs}\n`);
}

/**
 * Load dataset from JSON file
 */
export function loadDataset(relPath: string): tf.Tensor2D {
    const absPath = path.join(ROOT, relPath);
    const rawData = fs.readFileSync(absPath, 'utf-8');
    const data = JSON.parse(rawData);
    return tf.tensor2d(data.points);
}

/**
 * Generate synthetic Gaussian mixture data for testing
 * Creates 3 Gaussians arranged in a triangle
 */
export function generateSyntheticData(numSamples: number, dim: number = 2): tf.Tensor2D {
    if (dim !== 2) {
        // For higher dimensions, just generate random Gaussians
        return tf.randomNormal([numSamples, dim]);
    }

    // 3 Gaussians in a triangle pattern
    const means = [
        [0, 4 / Math.sqrt(3)],
        [-2, -2 / Math.sqrt(3)],
        [2, -2 / Math.sqrt(3)]
    ];
    const std = 0.5;

    const samplesPerComponent = Math.floor(numSamples / 3);
    const samples: number[][] = [];

    for (let i = 0; i < 3; i++) {
        const numThisComponent = i === 2 ? numSamples - 2 * samplesPerComponent : samplesPerComponent;
        for (let j = 0; j < numThisComponent; j++) {
            samples.push([
                means[i][0] + std * gaussianRandom(),
                means[i][1] + std * gaussianRandom()
            ]);
        }
    }

    return tf.tensor2d(samples);
}

/**
 * Box-Muller transform for standard normal samples
 */
function gaussianRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Save model to filesystem (manual serialization for WASM backend)
 */
export async function saveModel(model: tf.LayersModel, dir: string, name: string): Promise<string> {
    const outputDir = path.join(ROOT, dir);

    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get model topology and weights
    const topoJSON = model.toJSON();
    const modelTopology = typeof topoJSON === 'string' ? JSON.parse(topoJSON) : topoJSON;
    const weights = model.getWeights();

    // Create model JSON with modelTopology wrapper
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

        // Convert to ArrayBuffer
        const buffer = new ArrayBuffer(data.byteLength);
        new (data.constructor as Float32ArrayConstructor)(buffer).set(data as Float32Array);
        weightDataArrays.push(buffer);
    }

    // Concatenate all weight buffers
    const totalBytes = weightDataArrays.reduce((sum, buf) => sum + buf.byteLength, 0);
    const combinedBuffer = new ArrayBuffer(totalBytes);
    const combinedView = new Uint8Array(combinedBuffer);
    let offset = 0;
    for (const buf of weightDataArrays) {
        combinedView.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
    }

    // Add weights manifest to model JSON
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

    return path.join(outputDir, name);
}

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
}
