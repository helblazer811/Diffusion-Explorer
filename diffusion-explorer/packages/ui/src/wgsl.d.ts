declare module '*.wgsl' {
  const source: string;
  export default source;
}

declare module '*.wgsl?raw' {
  const source: string;
  export default source;
}
