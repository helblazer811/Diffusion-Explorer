import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  // Required for ffmpeg.wasm to use SharedArrayBuffer
  // Using 'credentialless' instead of 'require-corp' to allow loading external resources
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');

  return response;
};
