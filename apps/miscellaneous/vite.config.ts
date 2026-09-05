import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { tempusDevPlugin } from '@helblazer811/tempus/vite';
import path from 'path';
import fs from 'fs';

const workspaceNodeModules = path.resolve('../../node_modules');
let resolvedNodeModules = workspaceNodeModules;
try {
	resolvedNodeModules = fs.realpathSync(workspaceNodeModules);
} catch {
	// Fall back to the workspace path when node_modules is not a symlink.
}

const workspaceUi = path.resolve('../../packages/ui');
const workspaceDiffusion = path.resolve('../../packages/diffusion');

export default defineConfig({
	plugins: [sveltekit(), tempusDevPlugin()],
	resolve: {
		alias: [
			{ find: /^@diffusion-explorer\/diffusion$/, replacement: `${workspaceDiffusion}/src/index.ts` },
			{ find: /^@diffusion-explorer\/ui$/, replacement: `${workspaceUi}/src/index.ts` },
			{ find: /^@diffusion-explorer\/ui\/styles\/(.+)$/, replacement: `${workspaceUi}/src/styles/$1` }
		]
	},
	server: {
		fs: { allow: [resolvedNodeModules] }
	}
});
