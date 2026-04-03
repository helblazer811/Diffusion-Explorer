// TensorFlow.js with WASM backend (works on Apple Silicon)
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { trainFlowMatching, CONFIG as FM_CONFIG } from './train-flow-matching.js';
import { trainRectifiedFlow, CONFIG as RF_CONFIG } from './train-rectified-flow.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

interface TrainOptions {
  force?: boolean; // Force retrain even if exists
}

// Check if model files exist
function modelExists(modelDir: string, modelName: string): boolean {
  const jsonPath = path.join(ROOT, modelDir, `${modelName}.json`);
  const weightsPath = path.join(ROOT, modelDir, `${modelName}.weights.bin`);
  return fs.existsSync(jsonPath) && fs.existsSync(weightsPath);
}

async function main(options: TrainOptions = {}) {
  console.log('\n========================================');
  console.log('  Model Training Orchestrator');
  console.log('========================================\n');

  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}\n`);

  const { force = false } = options;

  if (force) {
    console.log('Force mode enabled - will retrain all models\n');
  }

  // Flow Matching Model
  const fmExists = modelExists(FM_CONFIG.modelOutputDir, FM_CONFIG.modelName);
  if (force || !fmExists) {
    await trainFlowMatching();
  } else {
    console.log(`Skipping flow matching (model exists at ${FM_CONFIG.modelOutputDir}/${FM_CONFIG.modelName})`);
  }

  // Rectified Flow Model
  const rfExists = modelExists(RF_CONFIG.modelOutputDir, RF_CONFIG.modelName);
  if (force || !rfExists) {
    await trainRectifiedFlow();
  } else {
    console.log(`Skipping rectified flow (model exists at ${RF_CONFIG.modelOutputDir}/${RF_CONFIG.modelName})`);
  }

  console.log('\n========================================');
  console.log('  All Training Complete!');
  console.log('========================================\n');
}

// Parse args: --force to retrain all
const force = process.argv.includes('--force');
main({ force }).catch((err) => {
  console.error('Training failed:', err);
  process.exit(1);
});
