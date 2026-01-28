// Convenience script to run both training and sampling
import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

console.log('\n****************************************');
console.log('  Source Selection - Full Pipeline');
console.log('****************************************\n');

const startTime = Date.now();

try {
  // Run training
  console.log('Step 1: Training models...\n');
  execSync('npx tsx scripts/source_selection/train.ts', {
    cwd: ROOT,
    stdio: 'inherit'
  });

  // Run sampling
  console.log('\nStep 2: Generating samples...\n');
  execSync('npx tsx scripts/source_selection/sample.ts', {
    cwd: ROOT,
    stdio: 'inherit'
  });

  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log('\n****************************************');
  console.log('  Pipeline Complete!');
  console.log(`  Total time: ${elapsed}min`);
  console.log('****************************************\n');

} catch (error) {
  console.error('\nPipeline failed:', error);
  process.exit(1);
}
