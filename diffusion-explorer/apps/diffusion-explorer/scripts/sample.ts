/**
 * Generate cached samples for a single trained model
 *
 * Usage:
 *   tsx scripts/sample.ts --objective "Flow Matching" --dataset "smiley_face"
 *   tsx scripts/sample.ts --objective "Diffusion" --dataset "three_modes"
 */

import * as fs from 'fs';
import * as path from 'path';
import { FlowModel, DiffusionModel } from '@diffusion-explorer/diffusion';
import {
    initBackend,
    loadModel,
    formatDuration,
    parseArgs,
    ensureDir,
    getModelPath,
    getSamplesPath,
    TRAINING_CONFIGS,
    SAMPLING_CONFIG,
    DOMAIN_RANGE,
    OBJECTIVES,
    DATASETS,
    type Objective,
    type Dataset,
} from './utils';

/**
 * Generate cached samples for the given objective and dataset
 */
export async function sampleModel(objective: Objective, dataset: Dataset): Promise<{ samplesPath: string; gridPath: string } | null> {
    const config = TRAINING_CONFIGS[objective];
    const modelJsonPath = getModelPath(objective, dataset);
    const samplesPath = getSamplesPath(objective, dataset, 'samples');
    const gridPath = getSamplesPath(objective, dataset, 'grid');

    console.log('\n========================================');
    console.log(`  Sampling: ${objective} on ${dataset}`);
    console.log('========================================\n');

    // Check if model exists
    if (!fs.existsSync(modelJsonPath)) {
        console.log(`  Skipping - model not found at ${modelJsonPath}`);
        return null;
    }

    const startTime = Date.now();

    // Create wrapper model FIRST (before loading, to avoid variable name conflicts)
    // The wrapper creates its own internal tf.Sequential which we'll replace
    let model: FlowModel | DiffusionModel;

    if (objective === 'Flow Matching') {
        model = new FlowModel(config.dim, config.hidden);
    } else {
        const { T = 1000, betaStart = 1e-4, betaEnd = 2e-2, networkType = 'simple' } = config;
        model = new DiffusionModel(config.dim, config.hidden, T, betaStart, betaEnd, networkType);
    }

    // Dispose the wrapper's auto-created model to free its variables
    (model as any).model.dispose();

    // Now load the saved model (variable names are now available)
    console.log(`Loading model: ${modelJsonPath}`);
    const tfModel = await loadModel(modelJsonPath);

    // Assign the loaded model to the wrapper
    (model as any).model = tfModel;

    // Ensure output directory exists
    ensureDir(path.dirname(samplesPath));

    // Generate random samples
    console.log(`\nGenerating ${SAMPLING_CONFIG.numSamples} random samples (${SAMPLING_CONFIG.numSteps} steps)...`);
    let sampleStartTime = Date.now();

    const samples = await model.sample(
        SAMPLING_CONFIG.numSamples,
        SAMPLING_CONFIG.numSteps
    );

    if (samples) {
        const rawData = samples.arraySync();
        fs.writeFileSync(samplesPath, JSON.stringify(rawData));
        console.log(`  Shape: [${samples.shape.join(', ')}]`);
        console.log(`  Saved: ${samplesPath}`);
        console.log(`  Time: ${formatDuration(Date.now() - sampleStartTime)}`);
        samples.dispose();
    }

    // Generate grid samples
    console.log(`\nGenerating ${SAMPLING_CONFIG.gridResolution}x${SAMPLING_CONFIG.gridResolution} grid samples (${SAMPLING_CONFIG.numSteps} steps)...`);
    sampleStartTime = Date.now();

    const gridSamples = await model.sample_grid(
        SAMPLING_CONFIG.gridResolution,
        DOMAIN_RANGE,
        SAMPLING_CONFIG.numSteps
    );

    if (gridSamples) {
        const rawData = gridSamples.arraySync();
        fs.writeFileSync(gridPath, JSON.stringify(rawData));
        console.log(`  Shape: [${gridSamples.shape.join(', ')}]`);
        console.log(`  Saved: ${gridPath}`);
        console.log(`  Time: ${formatDuration(Date.now() - sampleStartTime)}`);
        gridSamples.dispose();
    }

    // Cleanup
    tfModel.dispose();

    console.log(`\nTotal sampling time: ${formatDuration(Date.now() - startTime)}`);

    return { samplesPath, gridPath };
}

// Main
async function main(): Promise<void> {
    const { objective, dataset } = parseArgs();

    // Validate arguments
    if (!objective || !dataset) {
        console.log('Usage: tsx scripts/sample.ts --objective <objective> --dataset <dataset>\n');
        console.log('Objectives:', OBJECTIVES.join(', '));
        console.log('Datasets:', DATASETS.join(', '));
        console.log('\nExample:');
        console.log('  tsx scripts/sample.ts --objective "Flow Matching" --dataset "smiley_face"');
        process.exit(1);
    }

    // Initialize backend
    await initBackend();

    // Sample
    const result = await sampleModel(objective, dataset);

    if (result) {
        console.log('\n========================================');
        console.log('  Sampling Complete!');
        console.log(`  Samples: ${result.samplesPath}`);
        console.log(`  Grid: ${result.gridPath}`);
        console.log('========================================\n');
    }
}

// Only run main() when this file is executed directly
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error('Sampling failed:', err);
        process.exit(1);
    });
}
