// screen.ts
import { writable } from 'svelte/store';

export const screenWidth = writable(0);

if (typeof window !== 'undefined') {
  screenWidth.set(window.innerWidth);
  window.addEventListener('resize', () => {
    screenWidth.set(window.innerWidth);
  });
}
