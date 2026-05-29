import { readFileSync } from 'node:fs';

export function wgslPlugin() {
  return {
    name: 'vite-plugin-wgsl',
    config() {
      return {
        optimizeDeps: {
          esbuildOptions: {
            loader: { '.wgsl': 'text' }
          }
        }
      };
    },
    transform(_, id) {
      const path = id.replace(/\?raw$/, '');
      if (!path.endsWith('.wgsl')) return null;
      const source = readFileSync(path, 'utf-8');
      return { code: `export default ${JSON.stringify(source)}`, map: null };
    }
  };
}
