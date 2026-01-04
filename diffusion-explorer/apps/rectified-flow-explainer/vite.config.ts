import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    fs: {
      // Allow Vite to serve files from your diffusion package dist folder
      allow: [
        // adjust this path to your local package dist folder
        path.resolve('../packages/diffusion/dist')
      ]
    }
  },
  worker: {
    format: 'es'
  },
  esbuild: {
    drop: ['console', 'debugger']
  }
});
