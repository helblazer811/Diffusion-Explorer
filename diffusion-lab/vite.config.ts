import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	optimizeDeps: {
		exclude: [
			'@mapbox/node-pre-gyp',
			'@mswjs/interceptors'
		]
	},
});
