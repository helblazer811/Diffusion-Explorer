/**
 * Generate cached samples for all trained models
 *
 * Usage:
 *   tsx scripts/sample-all.ts
 */

import {
    initBackend,
    formatDuration,
    OBJECTIVES,
    DATASETS,
} from './utils';
import { sampleModel } from './sample';

async function main(): Promise<void> {
    console.log('\n****************************************');
    console.log('  Sample All Models');
    console.log('****************************************\n');

    // Initialize backend
    await initBackend();

    const startTime = Date.now();
    const results: { objective: string; dataset: string; samplesPath: string; gridPath: string; time: string }[] = [];
    const skipped: { objective: string; dataset: string }[] = [];

    // Sample all combinations
    for (const objective of OBJECTIVES) {
        for (const dataset of DATASETS) {
            const sampleStartTime = Date.now();
            try {
                const result = await sampleModel(objective, dataset);
                if (result) {
                    results.push({
                        objective,
                        dataset,
                        samplesPath: result.samplesPath,
                        gridPath: result.gridPath,
                        time: formatDuration(Date.now() - sampleStartTime),
                    });
                } else {
                    skipped.push({ objective, dataset });
                }
            } catch (err) {
                console.error(`\nFailed to sample ${objective} on ${dataset}:`, err);
                skipped.push({ objective, dataset });
            }
        }
    }

    // Summary
    console.log('\n****************************************');
    console.log('  Sampling Summary');
    console.log('****************************************\n');

    if (results.length > 0) {
        console.log('Samples generated:');
        for (const result of results) {
            console.log(`  [${result.time.padStart(8)}] ${result.objective} / ${result.dataset}`);
            console.log(`            → samples: ${result.samplesPath}`);
            console.log(`            → grid: ${result.gridPath}`);
        }
    }

    if (skipped.length > 0) {
        console.log('\nSkipped (model not found):');
        for (const item of skipped) {
            console.log(`  - ${item.objective} / ${item.dataset}`);
        }
    }

    console.log(`\nTotal time: ${formatDuration(Date.now() - startTime)}`);
    console.log(`Sampled: ${results.length} / ${OBJECTIVES.length * DATASETS.length}`);
    console.log('\n****************************************\n');
}

main().catch((err) => {
    console.error('Sampling failed:', err);
    process.exit(1);
});
