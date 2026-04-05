import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: {
      '$rectified-flow': path.resolve('../rectified-flow-explainer/src/lib'),
      '$continuity': path.resolve('../continuity-equation-explainer/src/lib'),
      '$flow-matching': path.resolve('../flow-matching-explainer/src/lib'),
      '$miscellaneous': path.resolve('../miscellaneous/src/routes'),
    }
  },
  server: {
    fs: {
      allow: [
        path.resolve('../packages/diffusion/dist'),
        path.resolve('../rectified-flow-explainer/src/lib'),
        path.resolve('../continuity-equation-explainer/src/lib'),
        path.resolve('../flow-matching-explainer/src/lib'),
        path.resolve('../miscellaneous/src/routes'),
      ]
    }
  },
  ssr: {
    noExternal: ['tempus', '@diffusion-explorer/ui'],
  },
  worker: {
    format: 'es'
  }
});
