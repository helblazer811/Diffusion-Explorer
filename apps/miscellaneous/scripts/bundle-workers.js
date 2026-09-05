#!/usr/bin/env node
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
	entryPoints: [path.resolve(appDir, '../../packages/diffusion/src/workers/flow_model.worker.ts')],
	bundle: true,
	format: 'esm',
	outfile: path.resolve(appDir, 'static/pull_toward_mean/workers/flow_model.worker.js'),
	platform: 'browser',
	target: 'es2020',
	minify: false,
	sourcemap: false,
	define: { 'process.env.NODE_ENV': '"production"' }
});

console.log('Bundled the flow-matching sampling worker.');
