import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { tempusDevPlugin } from '@helblazer811/tempus/vite';
import path from 'path';
import fs from 'fs';

// When running inside a git worktree, node_modules is often a symlink to the
// primary checkout. Resolve the realpath so Vite's fs.strict can serve from it.
const workspaceNodeModules = path.resolve('../../node_modules');
let resolvedNodeModules = workspaceNodeModules;
try {
	resolvedNodeModules = fs.realpathSync(workspaceNodeModules);
} catch {
	// ignore — fall back to the original path
}

export default defineConfig({
	plugins: [sveltekit(), tempusDevPlugin()],
	server: {
		headers: {
			// Required for ffmpeg.wasm to use SharedArrayBuffer
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
		fs: {
			// Allow Vite to serve files from the real node_modules location
			// (handles git worktrees where node_modules is symlinked).
			allow: [resolvedNodeModules],
		},
	},
});
