/**
 * Train all model/dataset combinations
 *
 * Usage:
 *   tsx scripts/train-all.ts
 */

import {
    initBackend,
    formatDuration,
    OBJECTIVES,
    DATASETS,
} from './utils';
import { trainModel } from './train';

async function main(): Promise<void> {
    console.log('\n****************************************');
    console.log('  Train All Models');
    console.log('****************************************\n');

    // Initialize backend
    await initBackend();

    const startTime = Date.now();
    const results: { objective: string; dataset: string; path: string; time: string }[] = [];

    // Train all combinations
    for (const objective of OBJECTIVES) {
        for (const dataset of DATASETS) {
            const modelStartTime = Date.now();
            try {
                const modelPath = await trainModel(objective, dataset);
                results.push({
                    objective,
                    dataset,
                    path: modelPath,
                    time: formatDuration(Date.now() - modelStartTime),
                });
            } catch (err) {
                console.error(`\nFailed to train ${objective} on ${dataset}:`, err);
            }
        }
    }

    // Summary
    console.log('\n****************************************');
    console.log('  Training Summary');
    console.log('****************************************\n');

    console.log('Models trained:');
    for (const result of results) {
        console.log(`  [${result.time.padStart(8)}] ${result.objective} / ${result.dataset}`);
        console.log(`            → ${result.path}`);
    }

    console.log(`\nTotal time: ${formatDuration(Date.now() - startTime)}`);
    console.log(`Models: ${results.length} / ${OBJECTIVES.length * DATASETS.length}`);
    console.log('\n****************************************\n');
}

main().catch((err) => {
    console.error('Training failed:', err);
    process.exit(1);
});
