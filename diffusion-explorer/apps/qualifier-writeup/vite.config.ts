import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: {
      '$qualifier-slides': path.resolve(__dirname, '../qualifier-slides/src/lib'),
    }
  },
  server: {
    fs: {
      allow: [
        path.resolve('../packages/diffusion/dist'),
        path.resolve('../qualifier-slides/src/lib'),
      ]
    }
  },
  ssr: {
    noExternal: ['tempus', '@diffusion-explorer/ui'],
  },
  worker: {
    format: 'es'
  },
});
