/**
 * Diffusion Model Training Script
 *
 * This script trains a DiffusionModel on synthetic data to verify the implementation works.
 * Run with: npm run train:diffusion
 */

import { DiffusionModel } from '../diffusion/diffusion';
import { initBackend, generateSyntheticData, saveModel, formatDuration, ROOT } from './utils';

// Configuration
const CONFIG = {
    outputDir: 'models',
    modelName: 'diffusion_test',
    dim: 2,
    hidden: 128,
    T: 200,           // Reduced from 1000 for faster testing
    betaStart: 1e-4,
    betaEnd: 2e-2,
    epochs: 500,
    batchSize: 256,
    updateInterval: 50,
    numSamples: 2000,
};

async function main(): Promise<void> {
    console.log('\n========================================');
    console.log('  Diffusion Model Training');
    console.log('========================================\n');

    const startTime = Date.now();

    // Initialize backend
    await initBackend();

    // Generate synthetic data
    console.log(`Generating ${CONFIG.numSamples} synthetic samples...`);
    const dataset = generateSyntheticData(CONFIG.numSamples, CONFIG.dim);
    console.log(`  Dataset shape: [${dataset.shape.join(', ')}]\n`);

    // Create model
    console.log(`Creating DiffusionModel (dim=${CONFIG.dim}, hidden=${CONFIG.hidden}, T=${CONFIG.T})\n`);
    const model = new DiffusionModel(
        CONFIG.dim,
        CONFIG.hidden,
        CONFIG.T,
        CONFIG.betaStart,
        CONFIG.betaEnd
    );

    // Training callback
    let lastLogTime = Date.now();
    const epochCallback = (epoch: number, _samples: number[][] | null, loss?: number) => {
        if (epoch % CONFIG.updateInterval === 0 || epoch === CONFIG.epochs - 1) {
            const now = Date.now();
            const elapsed = formatDuration(now - startTime);
            const epochTime = formatDuration(now - lastLogTime);
            lastLogTime = now;

            const lossStr = loss !== undefined ? loss.toFixed(6) : 'N/A';
            console.log(`  Epoch ${epoch.toString().padStart(4)} | Loss: ${lossStr} | Time: ${epochTime.padStart(8)} | Total: ${elapsed}`);
        }
    };

    // Train
    console.log(`Starting training (${CONFIG.epochs} epochs, batch size ${CONFIG.batchSize})`);
    console.log('----------------------------------------');

    await model.train(
        dataset,
        CONFIG.epochs,
        CONFIG.batchSize,
        CONFIG.updateInterval,
        () => false,
        epochCallback
    );

    console.log('----------------------------------------');
    console.log(`Training completed in ${formatDuration(Date.now() - startTime)}\n`);

    // Test sampling
    console.log('Testing sampling...');
    const numSteps = 50;  // Use fewer steps for faster sampling
    const samples = await model.sample(100, numSteps);
    if (samples) {
        console.log(`  Generated ${samples.shape[1]} samples over ${samples.shape[0]} steps`);
        console.log(`  Final samples shape: [${samples.shape.join(', ')}]`);
        samples.dispose();
    }
    console.log('  Sampling works!\n');

    // Save model
    console.log(`Saving model to: ${CONFIG.outputDir}/${CONFIG.modelName}`);
    const modelPath = await saveModel((model as any).model, CONFIG.outputDir, CONFIG.modelName);
    console.log('  Model saved successfully!\n');

    // Cleanup
    dataset.dispose();

    console.log('========================================');
    console.log('  Training Complete!');
    console.log(`  Total time: ${formatDuration(Date.now() - startTime)}`);
    console.log(`  Model saved to: ${modelPath}`);
    console.log('========================================\n');
}

// Run
main().catch((err) => {
    console.error('Training failed:', err);
    process.exit(1);
});
