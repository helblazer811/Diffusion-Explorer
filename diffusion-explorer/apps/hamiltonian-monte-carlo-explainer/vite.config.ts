import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
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

// Force the worktree's own packages/ui to be used instead of the symlinked
// `node_modules/@diffusion-explorer/ui` (which, in a worktree, resolves to the
// primary checkout). Both the bare import and the `/styles/*` subpath need to
// be redirected, mirroring the package.json `exports` mapping.
const workspaceUi = path.resolve('../../packages/ui');

export default defineConfig({
  plugins: [sveltekit()],
  ssr: {
    noExternal: ['tempus']
  },
  resolve: {
    alias: [
      { find: /^@diffusion-explorer\/ui$/, replacement: `${workspaceUi}/src/index.ts` },
      { find: /^@diffusion-explorer\/ui\/node$/, replacement: `${workspaceUi}/src/node.ts` },
      { find: /^@diffusion-explorer\/ui\/plotting\/post-processing$/, replacement: `${workspaceUi}/src/plotting/post-processing/index.ts` },
      { find: /^@diffusion-explorer\/ui\/styles\/(.+)$/, replacement: `${workspaceUi}/src/styles/$1` },
    ],
  },
  server: {
    fs: {
      allow: [
        resolvedNodeModules,
      ]
    }
  },
  worker: {
    format: 'es'
  },
});
