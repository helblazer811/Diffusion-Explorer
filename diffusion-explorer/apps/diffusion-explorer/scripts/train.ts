/**
 * Train a single model
 *
 * Usage:
 *   tsx scripts/train.ts --objective "Flow Matching" --dataset "smiley_face"
 *   tsx scripts/train.ts --objective "Diffusion" --dataset "three_modes"
 */

import { FlowModel, DiffusionModel } from '@diffusion-explorer/diffusion';
import {
    initBackend,
    loadDataset,
    saveModel,
    formatDuration,
    parseArgs,
    getDatasetPath,
    getModelDir,
    TRAINING_CONFIGS,
    OBJECTIVES,
    DATASETS,
    type Objective,
    type Dataset,
} from './utils';

/**
 * Train a model for the given objective and dataset
 */
export async function trainModel(objective: Objective, dataset: Dataset): Promise<string> {
    const config = TRAINING_CONFIGS[objective];
    const datasetPath = getDatasetPath(dataset);
    const modelDir = getModelDir(objective, dataset);

    console.log('\n========================================');
    console.log(`  Training: ${objective} on ${dataset}`);
    console.log('========================================\n');

    const startTime = Date.now();

    // Load dataset
    console.log(`Loading dataset: ${datasetPath}`);
    const data = loadDataset(datasetPath);
    console.log(`  Dataset shape: [${data.shape.join(', ')}]\n`);

    // Create model
    let model: FlowModel | DiffusionModel;

    if (objective === 'Flow Matching') {
        console.log(`Creating FlowModel (dim=${config.dim}, hidden=${config.hidden})`);
        model = new FlowModel(config.dim, config.hidden);
    } else {
        const { T = 1000, betaStart = 1e-4, betaEnd = 2e-2, networkType = 'simple' } = config;
        console.log(`Creating DiffusionModel (dim=${config.dim}, hidden=${config.hidden}, T=${T}, networkType=${networkType})`);
        model = new DiffusionModel(config.dim, config.hidden, T, betaStart, betaEnd, networkType);
    }

    // Training callback
    let lastLogTime = Date.now();
    const epochCallback = (epoch: number, _samples: number[][] | null, loss?: number) => {
        if (epoch % config.updateInterval === 0 || epoch === config.epochs - 1) {
            const now = Date.now();
            const elapsed = formatDuration(now - startTime);
            const epochTime = formatDuration(now - lastLogTime);
            lastLogTime = now;

            const lossStr = loss !== undefined ? loss.toFixed(6) : 'N/A';
            console.log(`  Epoch ${epoch.toString().padStart(4)} | Loss: ${lossStr} | Batch: ${epochTime.padStart(8)} | Total: ${elapsed}`);
        }
    };

    // Train
    console.log(`\nStarting training (${config.epochs} epochs, batch size ${config.batchSize})`);
    console.log('----------------------------------------');

    await model.train(
        data,
        config.epochs,
        config.batchSize,
        config.updateInterval,
        () => false,
        epochCallback
    );

    console.log('----------------------------------------');
    console.log(`Training completed in ${formatDuration(Date.now() - startTime)}\n`);

    // Save model
    console.log(`Saving model to: ${modelDir}`);
    const modelPath = await saveModel((model as any).model, modelDir, 'model');
    console.log(`  Model saved: ${modelPath}\n`);

    // Cleanup
    data.dispose();

    return modelPath;
}

// Main - only run when executed directly (not when imported)
async function main(): Promise<void> {
    const { objective, dataset } = parseArgs();

    // Validate arguments
    if (!objective || !dataset) {
        console.log('Usage: tsx scripts/train.ts --objective <objective> --dataset <dataset>\n');
        console.log('Objectives:', OBJECTIVES.join(', '));
        console.log('Datasets:', DATASETS.join(', '));
        console.log('\nExample:');
        console.log('  tsx scripts/train.ts --objective "Flow Matching" --dataset "smiley_face"');
        process.exit(1);
    }

    // Initialize backend
    await initBackend();

    // Train
    const modelPath = await trainModel(objective, dataset);

    console.log('========================================');
    console.log('  Training Complete!');
    console.log(`  Model: ${modelPath}`);
    console.log('========================================\n');
}

// Only run main() when this file is executed directly
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error('Training failed:', err);
        process.exit(1);
    });
}
