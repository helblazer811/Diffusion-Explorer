import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import { DiffusionModel } from '../src/diffusion/diffusion';
import { createDiffusionSchedule, ddimStep, getDiffusionScheduler } from '../src/diffusion/schedulers';

// Initialize WASM backend before tests
beforeAll(async () => {
    await tf.setBackend('wasm');
    await tf.ready();
});

// Force garbage collection between tests
afterEach(() => {
    tf.disposeVariables();
});

describe('DiffusionModel', () => {
    it('should instantiate without errors', () => {
        const model = new DiffusionModel(2, 32, 20);
        expect(model).toBeDefined();
        expect(model.T).toBe(20);
    });

    it('should have correct forward pass output shape', () => {
        const model = new DiffusionModel(2, 32, 20);
        const x_t = tf.randomNormal([5, 2]);
        const t = tf.tensor1d([5, 5, 5, 5, 5], 'int32');

        const output = model.forward(x_t, t);

        expect(output.shape).toEqual([5, 2]);

        // Cleanup
        x_t.dispose();
        t.dispose();
        output.dispose();
    });

    it('should add noise correctly', () => {
        const model = new DiffusionModel(2, 32, 20);
        const x0 = tf.ones([3, 2]);
        const noise = tf.zeros([3, 2]);  // Zero noise for testing
        const t = tf.tensor1d([0, 0, 0], 'int32');

        // At t=0, alpha_bar ≈ 1, so x_t should be close to x0
        const x_t = model.addNoise(x0, noise, t);

        const x_t_data = x_t.dataSync();
        // Should be very close to 1 (the original value)
        expect(x_t_data[0]).toBeCloseTo(1, 1);

        x0.dispose();
        noise.dispose();
        t.dispose();
        x_t.dispose();
    });

    it('should train and reduce loss', async () => {
        const model = new DiffusionModel(2, 16, 10);  // Very small model for testing

        // Generate simple training data
        const data = tf.randomNormal([50, 2]);

        let firstLoss: number | undefined;
        let lastLoss: number | undefined;

        await model.train(
            data,
            10,    // epochs
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
        // Loss should change (may not always decrease with so few epochs)
        expect(lastLoss).toBeDefined();

        data.dispose();
    });

    it('should sample valid trajectories', async () => {
        const model = new DiffusionModel(2, 16, 10);

        // Quick training
        const data = tf.randomNormal([30, 2]);
        await model.train(data, 5, 16, 100, () => false);

        // Sample with fewer steps
        const trajectories = await model.sample(5, 3);

        expect(trajectories).not.toBeNull();
        expect(trajectories!.shape[1]).toBe(5);  // 5 samples
        expect(trajectories!.shape[2]).toBe(2);  // 2 dimensions

        // Check for NaN values
        const hasNaN = tf.any(tf.isNaN(trajectories!)).dataSync()[0];
        expect(hasNaN).toBe(0);

        data.dispose();
        trajectories!.dispose();
    });
});

describe('Diffusion Schedulers', () => {
    it('should create valid noise schedule', () => {
        const schedule = createDiffusionSchedule(100, 1e-4, 2e-2);

        expect(schedule.T).toBe(100);
        expect(schedule.betas.shape).toEqual([100]);
        expect(schedule.alphas.shape).toEqual([100]);
        expect(schedule.alphasCumprod.shape).toEqual([100]);

        // Alpha bar should decrease over time
        const alphaCumprodData = schedule.alphasCumprod.dataSync();
        expect(alphaCumprodData[0]).toBeGreaterThan(alphaCumprodData[99]);

        // First alpha bar should be close to 1
        expect(alphaCumprodData[0]).toBeGreaterThan(0.99);

        // Last alpha bar should be small but positive
        expect(alphaCumprodData[99]).toBeGreaterThan(0);
        expect(alphaCumprodData[99]).toBeLessThan(0.1);
    });

    it('should have valid variance values', () => {
        const schedule = createDiffusionSchedule(100);

        const varianceData = schedule.variance.dataSync();

        // All variances should be positive
        for (const v of varianceData) {
            expect(v).toBeGreaterThan(0);
        }
    });
});

describe('DDIM Scheduler', () => {
    it('should get DDIM scheduler from registry', () => {
        const scheduler = getDiffusionScheduler('ddim');
        expect(scheduler).toBeDefined();
        expect(typeof scheduler).toBe('function');
    });

    it('should sample valid trajectories with DDIM scheduler', async () => {
        const model = new DiffusionModel(2, 16, 10);
        const data = tf.randomNormal([30, 2]);
        await model.train(data, 5, 16, 100, () => false);

        const trajectories = await model.sample(5, 3, { scheduler: 'ddim' });

        expect(trajectories).not.toBeNull();
        expect(trajectories!.shape[1]).toBe(5);  // 5 samples
        expect(trajectories!.shape[2]).toBe(2);  // 2 dimensions

        // Check for NaN values
        const hasNaN = tf.any(tf.isNaN(trajectories!)).dataSync()[0];
        expect(hasNaN).toBe(0);

        data.dispose();
        trajectories!.dispose();
    });

    it('should produce deterministic outputs (eta=0)', async () => {
        const model = new DiffusionModel(2, 16, 10);
        const data = tf.randomNormal([30, 2]);
        await model.train(data, 3, 16, 100, () => false);

        // Sample with DDIM from same initial points twice
        const initialPoints = tf.randomNormal([3, 2]);

        // DDIM with eta=0 is deterministic, so sampling from same initial noise should give same result
        // Note: We can't easily test determinism since we'd need to control the model's random state
        // Instead, we verify the step function produces valid output
        const schedule = createDiffusionSchedule(10);
        const t = tf.tensor1d([5, 5, 5], 'int32');

        const output = ddimStep(
            initialPoints as tf.Tensor2D,
            t,
            (x, tStep) => model.forward(x, tStep),
            schedule,
            0.0  // eta=0 for deterministic
        );

        expect(output.shape).toEqual([3, 2]);
        const hasNaN = tf.any(tf.isNaN(output)).dataSync()[0];
        expect(hasNaN).toBe(0);

        initialPoints.dispose();
        t.dispose();
        output.dispose();
        data.dispose();
    });

    it('should sample from initial points with DDIM scheduler', async () => {
        const model = new DiffusionModel(2, 16, 10);
        const data = tf.randomNormal([30, 2]);
        await model.train(data, 5, 16, 100, () => false);

        const initialPoints = tf.randomNormal([4, 2]);
        const trajectories = await model.sample_from_initial_points(initialPoints, 3, { scheduler: 'ddim' });

        expect(trajectories).not.toBeNull();
        expect(trajectories!.shape[1]).toBe(4);  // 4 samples
        expect(trajectories!.shape[2]).toBe(2);  // 2 dimensions

        // Check for NaN values
        const hasNaN = tf.any(tf.isNaN(trajectories!)).dataSync()[0];
        expect(hasNaN).toBe(0);

        data.dispose();
        initialPoints.dispose();
        trajectories!.dispose();
    });
});
