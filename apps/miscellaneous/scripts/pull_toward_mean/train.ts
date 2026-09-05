import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlowModel } from '../../../../packages/diffusion/src/flow_matching/flow_matching';
import { createTwoMoons } from '../../src/routes/pull_toward_mean/diffusion';

const CONFIG = { dim: 2, hidden: 128, epochs: 600, batchSize: 256, trainingSamples: 4096 };
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assetDir = path.join(appDir, 'static/pull_toward_mean');
const modelDir = path.join(assetDir, 'models');
const dataDir = path.join(assetDir, 'data');

async function saveModel(model: tf.LayersModel): Promise<void> {
	fs.mkdirSync(modelDir, { recursive: true });
	const topology = model.toJSON();
	const weights = model.getWeights();
	const encoded = await tf.io.encodeWeights(weights.map((tensor, index) => ({
		name: model.weights[index].name,
		tensor
	})));
	const modelJson = {
		format: 'layers-model',
		generatedBy: `TensorFlow.js tfjs-layers v${tf.version.tfjs}`,
		convertedBy: null,
		modelTopology: typeof topology === 'string' ? JSON.parse(topology) : topology,
		weightsManifest: [{ paths: ['flow_model.weights.bin'], weights: encoded.specs }],
		userDefinedMetadata: { dataset: 'two-moons', objective: 'independent-coupling flow matching', ...CONFIG }
	};
	fs.writeFileSync(path.join(modelDir, 'flow_model.json'), JSON.stringify(modelJson));
	fs.writeFileSync(path.join(modelDir, 'flow_model.weights.bin'), Buffer.from(encoded.data));
	weights.forEach((weight) => weight.dispose());
}

async function main(): Promise<void> {
	await tf.setBackend('wasm');
	await tf.ready();
	console.log(`Training two-moons flow-matching model with ${tf.getBackend()} backend`);
	const points = createTwoMoons(CONFIG.trainingSamples, 481516);
	fs.mkdirSync(dataDir, { recursive: true });
	fs.writeFileSync(path.join(dataDir, 'two_moons.json'), JSON.stringify({ points }));
	const data = tf.tensor2d(points.map(({ x, y }) => [x, y]));
	const model = new FlowModel(CONFIG.dim, CONFIG.hidden);

	await model.train(data, CONFIG.epochs, CONFIG.batchSize, CONFIG.epochs + 1, () => false,
		(epoch, _samples, loss) => {
			if (epoch % 25 === 0 || epoch === CONFIG.epochs - 1) {
				console.log(`epoch ${String(epoch + 1).padStart(3)} / ${CONFIG.epochs}   loss ${loss?.toFixed(6)}`);
			}
		});

	await saveModel((model as unknown as { model: tf.LayersModel }).model);
	data.dispose();
	console.log(`Saved trained model to ${path.relative(appDir, modelDir)}/flow_model.json`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
