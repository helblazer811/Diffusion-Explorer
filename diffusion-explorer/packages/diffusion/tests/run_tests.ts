/**
 * Simple test runner for diffusion package
 * Runs tests directly with tsx to avoid Vitest/V8 memory issues with TensorFlow WASM backend
 *
 * Run with: npx tsx tests/run_tests.ts
 */

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import { FlowModel } from '../src/flow_matching/flow_matching';
import { DiffusionModel } from '../src/diffusion/diffusion';
import { createDiffusionSchedule, ddimStep, getDiffusionScheduler } from '../src/diffusion/schedulers';

// Test utilities
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
    if (condition) {
        console.log(`  ✓ ${message}`);
        passed++;
    } else {
        console.log(`  ✗ ${message}`);
        failed++;
    }
}

function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
    const close = Math.abs(actual - expected) <= tolerance;
    if (close) {
        console.log(`  ✓ ${message}`);
        passed++;
    } else {
        console.log(`  ✗ ${message} (expected ${expected}, got ${actual})`);
        failed++;
    }
}

async function runTests(): Promise<void> {
    console.log('\n========================================');
    console.log('  Diffusion Package Tests');
    console.log('========================================\n');

    // Initialize WASM backend
    console.log('Initializing TensorFlow WASM backend...');
    await tf.setBackend('wasm');
    await tf.ready();
    console.log(`Backend: ${tf.getBackend()}\n`);

    // ==========================================
    // FlowModel Tests
    // ==========================================
    console.log('FlowModel Tests:');
    console.log('----------------------------------------');

    // Test: FlowModel instantiation
    {
        const model = new FlowModel(2, 32);
        assert(model !== undefined, 'FlowModel instantiation');
    }
    tf.disposeVariables();

    // Test: FlowModel forward pass
    {
        const model = new FlowModel(2, 32);
        const x_t = tf.randomNormal([5, 2]);
        const t = tf.randomUniform([5, 1]);
        const output = model.forward(x_t, t);

        assert(
            output.shape[0] === 5 && output.shape[1] === 2,
            'FlowModel forward pass shape [5, 2]'
        );

        x_t.dispose();
        t.dispose();
        output.dispose();
    }
    tf.disposeVariables();

    // Test: FlowModel training reduces loss
    // Note: Use minimal params to avoid V8 memory issues
    {
        const model = new FlowModel(2, 8);  // Smaller hidden size
        const data = tf.randomNormal([20, 2]) as tf.Tensor2D;

        let firstLoss: number | undefined;
        let lastLoss: number | undefined;

        await model.train(
            data,
            10,    // epochs - reduced
            10,    // batchSize
            100,   // updateInterval
            () => false,
            (epoch, _samples, loss) => {
                if (epoch === 0 && loss !== undefined) {
                    firstLoss = loss;
                }
                lastLoss = loss;
            }
        );

        assert(firstLoss !== undefined, 'FlowModel training produces loss');
        assert(
            lastLoss !== undefined && firstLoss !== undefined && lastLoss < firstLoss,
            'FlowModel training reduces loss'
        );

        data.dispose();
    }
    tf.disposeVariables();

    // Test: FlowModel sampling
    {
        const model = new FlowModel(2, 8);  // Smaller hidden size
        const data = tf.randomNormal([20, 2]) as tf.Tensor2D;
        await model.train(data, 5, 10, 100, () => false);

        const trajectories = await model.sample(3, 3);  // Fewer samples

        assert(trajectories !== null, 'FlowModel sampling returns trajectories');
        assert(
            trajectories !== null &&
            trajectories.shape[0] === 3 &&
            trajectories.shape[1] === 3 &&
            trajectories.shape[2] === 2,
            'FlowModel sampling shape [3, 3, 2]'
        );

        if (trajectories) {
            const hasNaN = tf.any(tf.isNaN(trajectories)).dataSync()[0];
            assert(hasNaN === 0, 'FlowModel sampling has no NaN values');
            trajectories.dispose();
        }

        data.dispose();
    }
    tf.disposeVariables();

    console.log('');

    // ==========================================
    // DiffusionModel Tests
    // ==========================================
    console.log('DiffusionModel Tests:');
    console.log('----------------------------------------');

    // Test: DiffusionModel instantiation
    {
        const model = new DiffusionModel(2, 32, 20);
        assert(model !== undefined, 'DiffusionModel instantiation');
        assert(model.T === 20, 'DiffusionModel T=20');
    }
    tf.disposeVariables();

    // Test: DiffusionModel forward pass
    {
        const model = new DiffusionModel(2, 32, 20);
        const x_t = tf.randomNormal([5, 2]) as tf.Tensor2D;
        const t = tf.tensor1d([5, 5, 5, 5, 5], 'int32');
        const output = model.forward(x_t, t);

        assert(
            output.shape[0] === 5 && output.shape[1] === 2,
            'DiffusionModel forward pass shape [5, 2]'
        );

        x_t.dispose();
        t.dispose();
        output.dispose();
    }
    tf.disposeVariables();

    // Test: DiffusionModel addNoise
    {
        const model = new DiffusionModel(2, 32, 20);
        const x0 = tf.ones([3, 2]) as tf.Tensor2D;
        const noise = tf.zeros([3, 2]) as tf.Tensor2D;
        const t = tf.tensor1d([0, 0, 0], 'int32');

        const x_t = model.addNoise(x0, noise, t);
        const x_t_data = x_t.dataSync();

        assertClose(x_t_data[0], 1, 0.1, 'DiffusionModel addNoise at t=0 preserves x0');

        x0.dispose();
        noise.dispose();
        t.dispose();
        x_t.dispose();
    }
    tf.disposeVariables();

    // NOTE: DiffusionModel training tests are skipped in this test runner
    // due to V8/TensorFlow.js WASM memory issues. The training functionality
    // is verified via the standalone scripts:
    //   npm run train:diffusion
    //   npm run train:flow
    console.log('  (skipped) DiffusionModel training - use npm run train:diffusion');
    console.log('  (skipped) DiffusionModel sampling - use npm run train:diffusion');

    console.log('');

    // ==========================================
    // Diffusion Scheduler Tests
    // ==========================================
    console.log('Diffusion Scheduler Tests:');
    console.log('----------------------------------------');

    // Test: Noise schedule creation
    {
        const schedule = createDiffusionSchedule(100, 1e-4, 2e-2);

        assert(schedule.T === 100, 'Schedule T=100');
        assert(
            schedule.betas.shape[0] === 100,
            'Betas shape [100]'
        );
        assert(
            schedule.alphasCumprod.shape[0] === 100,
            'AlphasCumprod shape [100]'
        );

        const alphaCumprodData = schedule.alphasCumprod.dataSync();
        assert(
            alphaCumprodData[0] > alphaCumprodData[99],
            'Alpha bar decreases over time'
        );
        assert(
            alphaCumprodData[0] > 0.99,
            'First alpha bar close to 1'
        );
        assert(
            alphaCumprodData[99] > 0 && alphaCumprodData[99] < 0.5,
            'Last alpha bar small but positive'
        );

        const varianceData = schedule.variance.dataSync();
        let allPositive = true;
        for (const v of varianceData) {
            if (v <= 0) allPositive = false;
        }
        assert(allPositive, 'All variance values positive');
    }
    tf.disposeVariables();

    console.log('');

    // ==========================================
    // DDIM Scheduler Tests
    // ==========================================
    console.log('DDIM Scheduler Tests:');
    console.log('----------------------------------------');

    // Test: DDIM scheduler registry lookup
    {
        const scheduler = getDiffusionScheduler('ddim');
        assert(scheduler !== undefined, 'DDIM scheduler exists in registry');
        assert(typeof scheduler === 'function', 'DDIM scheduler is a function');
    }
    tf.disposeVariables();

    // Test: DDIM step function produces valid output
    {
        const model = new DiffusionModel(2, 8, 10);  // Small model
        const schedule = createDiffusionSchedule(10);
        const x_t = tf.randomNormal([3, 2]) as tf.Tensor2D;
        const t = tf.tensor1d([5, 5, 5], 'int32');

        const output = ddimStep(
            x_t,
            t,
            (x, tStep) => model.forward(x, tStep),
            schedule,
            0.0  // eta=0 for deterministic
        );

        assert(
            output.shape[0] === 3 && output.shape[1] === 2,
            'DDIM step output shape [3, 2]'
        );

        const hasNaN = tf.any(tf.isNaN(output)).dataSync()[0];
        assert(hasNaN === 0, 'DDIM step has no NaN values');

        x_t.dispose();
        t.dispose();
        output.dispose();
    }
    tf.disposeVariables();

    // ==========================================
    // Summary
    // ==========================================
    console.log('\n========================================');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('========================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error('Test runner failed:', err);
    process.exit(1);
});
