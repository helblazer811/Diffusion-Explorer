/**
 * Type declarations for WGSL shader imports.
 * Vite handles these imports via the `?raw` query parameter.
 */
declare module '*.wgsl?raw' {
  const content: string;
  export default content;
}
