#!/usr/bin/env node
/**
 * Bundle web workers for production.
 * Workers need to be pre-bundled because they import npm packages.
 */
import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function bundleWorkers() {
  const workers = [
    {
      entry: 'src/lib/workers/diffusion_model.worker.ts',
      output: 'static/pull_toward_mean/workers/diffusion_model.worker.js'
    }
  ];

  for (const worker of workers) {
    const entryPath = path.resolve(rootDir, worker.entry);
    const outputPath = path.resolve(rootDir, worker.output);

    console.log(`Bundling ${worker.entry}...`);

    try {
      await build({
        entryPoints: [entryPath],
        bundle: true,
        format: 'esm',
        outfile: outputPath,
        platform: 'browser',
        target: 'es2020',
        minify: false,
        sourcemap: false,
        define: {
          'process.env.NODE_ENV': '"production"'
        }
      });
      console.log(`  -> ${worker.output}`);
    } catch (error) {
      console.error(`Failed to bundle ${worker.entry}:`, error.message);
      process.exit(1);
    }
  }

  console.log('Workers bundled successfully!');
}

bundleWorkers();
