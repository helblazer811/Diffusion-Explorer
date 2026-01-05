import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import { FlowModel } from '../src/flow_matching/flow_matching';

// Initialize WASM backend before tests
beforeAll(async () => {
    await tf.setBackend('wasm');
    await tf.ready();
});

// Force garbage collection between tests
afterEach(() => {
    tf.disposeVariables();
});

describe('FlowModel', () => {
    it('should instantiate without errors', () => {
        const model = new FlowModel(2, 32);
        expect(model).toBeDefined();
    });

    it('should have correct forward pass output shape', () => {
        const model = new FlowModel(2, 32);
        const x_t = tf.randomNormal([5, 2]);
        const t = tf.randomUniform([5, 1]);

        const output = model.forward(x_t, t);

        expect(output.shape).toEqual([5, 2]);

        // Cleanup
        x_t.dispose();
        t.dispose();
        output.dispose();
    });

    it('should train and reduce loss', async () => {
        const model = new FlowModel(2, 16);  // Smaller for faster test

        // Generate simple training data
        const data = tf.randomNormal([50, 2]);

        let firstLoss: number | undefined;
        let lastLoss: number | undefined;

        await model.train(
            data,
            20,    // epochs
            16,    // batchSize
            100,   // updateInterval (no intermediate sampling)
            () => false,
            (epoch, _samples, loss) => {
                if (epoch === 0 && loss !== undefined) {
                    firstLoss = loss;
                }
                lastLoss = loss;
            }
        );

        expect(firstLoss).toBeDefined();
        expect(lastLoss).toBeDefined();
        expect(lastLoss!).toBeLessThan(firstLoss!);

        data.dispose();
    });

    it('should sample valid trajectories', async () => {
        const model = new FlowModel(2, 16);

        // Quick training
        const data = tf.randomNormal([30, 2]);
        await model.train(data, 10, 16, 100, () => false);

        // Sample
        const trajectories = await model.sample(5, 3);

        expect(trajectories).not.toBeNull();
        expect(trajectories!.shape).toEqual([3, 5, 2]);  // [steps, samples, dim]

        // Check for NaN values
        const hasNaN = tf.any(tf.isNaN(trajectories!)).dataSync()[0];
        expect(hasNaN).toBe(0);

        data.dispose();
        trajectories!.dispose();
    });

    it('should sample from initial points', async () => {
        const model = new FlowModel(2, 16);

        // Quick training
        const data = tf.randomNormal([30, 2]);
        await model.train(data, 10, 16, 100, () => false);

        // Sample from specific points
        const initialPoints = tf.tensor2d([[0, 0], [1, 1]]);
        const trajectories = await model.sample_from_initial_points(initialPoints, 3);

        expect(trajectories).not.toBeNull();
        expect(trajectories!.shape).toEqual([3, 2, 2]);

        data.dispose();
        initialPoints.dispose();
        trajectories!.dispose();
    });
});
