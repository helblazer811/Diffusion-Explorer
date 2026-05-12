// Shared figures (extracted from byte-identical duplicates in apps)
export { default as CurvedTrajectoryIntro } from './figures/CurvedTrajectoryIntro.svelte';
export type {
  CurvedTrajectoryIntroSettings,
  FlowModelClientLike,
} from './figures/CurvedTrajectoryIntro.svelte';
export { default as EulerStepDemo } from './figures/EulerStepDemo.svelte';
export type {
  EulerStepDemoSettings,
  EulerStepDemoVectorFieldData,
  EulerStepDemoFlowModelClientLike,
} from './figures/EulerStepDemo.svelte';

// Existing components
export { default as Katex } from './components/Katex.svelte';
export { default as AnnotatedEquation } from './components/AnnotatedEquation.svelte';
export { default as Minimizable } from './components/Minimizable.svelte';
export { default as Quote } from './components/Quote.svelte';
export {
  plotKatexInSVG,
  type PlotKatexOptions,
  type Anchor,
  createSourceTargetScales,
  plotScatterAtCenter,
  plotSourceTargetScatter,
  plotLabel,
  plotSourceTargetLabels,
  dataToPixelX
} from './d3_utils';

// Layout components
export { default as TableOfContents } from './components/TableOfContents.svelte';
export { default as Figure } from './components/Figure.svelte';
export { default as DoubleFigure } from './components/DoubleFigure.svelte';
export { default as TripleFigure } from './components/TripleFigure.svelte';
export { default as TopNav } from './components/TopNav.svelte';
export { default as ArticleHeader } from './components/ArticleHeader.svelte';
export { default as PageContainer } from './components/PageContainer.svelte';

// UI Controls
export { default as PlayButton } from './components/PlayButton.svelte';
export { default as Slider } from './components/Slider.svelte';
export { default as TimeSlider } from './components/TimeSlider.svelte';
export { default as TextToggleButton } from './components/TextToggleButton.svelte';
export { default as MultiStateToggleButton } from './components/MultiStateToggleButton.svelte';
export { default as FigureLegend } from './components/FigureLegend.svelte';
export { default as DropDown } from './components/DropDown.svelte';
export { default as IconToggleButton } from './components/IconToggleButton.svelte';

// Algorithm components
export { default as Algorithm } from './components/Algorithm.svelte';
export { default as AlgorithmLine } from './components/AlgorithmLine.svelte';

// Bibliography components
export { default as Bibliography } from './components/Bibliography.svelte';
export { default as HoverableReference } from './components/HoverableReference.svelte';

// Citations utilities
export {
  type BibEntry,
  type CitationInfo,
  parseBibTeX,
  loadBibliography,
  collectCitations,
  formatAuthors
} from './citations';

// Plotting utilities
export * from './plotting/plotting';
export * from './plotting/trajectories';
export * from './plotting/contours';
export * from './plotting/vector_field';
export * from './plotting/mathjax';
export * from './plotting/pathlines';
export * from './plotting/streamlines/index';  // New unified module with CPU/GPU support
export * from './plotting/mesh_grid';
export * from './plotting/heatmap';
export { useCanvas2D, useCanvasWebGPU } from './plotting/canvas';
export * from './plotting/utils';
export * from './plotting/line-integral-convolution';

// Legacy: streamlines-gpu is now part of plotting/streamlines/gpu
// Re-export for backward compatibility
export {
  StreamlineRenderer,
  prepareStreamlineData,
  parseColor,
  type StreamlineRendererOptions,
  type StreamlineRenderStyle,
  type StreamlineGPUData,
  type StreamlineSegment,
  type StreamlineUniforms,
  type WebGPUContext,
  type RGBAColor,
} from './plotting/streamlines/gpu';

// Pulsing paths renderer (GPU-accelerated)
export {
  PulsingPathsRenderer,
  preparePathData,
  type PulsingPathsRendererOptions,
  type PulsingPathsRenderStyle,
  type PulsingPathsGPUData,
} from './plotting/pulsing-paths';

// Animation core (re-exported from tempus)
export {
  Clock,
  Timeline,
  Layer,
  createPauseClip,
  type Clip,
  type ClipTiming,
  type ClipOptions,
  type Animation,
  type AnimationWithData,
  useVisibilityHandler,
  type VisibilityState,
  TimelineBuilder,
  type TimelineBuilderAddOptions,
  type TimelineBuilderAddAtOptions,
  exportAnimation,
  streamingVideoExport,
  downloadBlob,
  downloadFrames,
  type VideoExportOptions,
  type ExportableAnimation,
} from 'tempus';

// Domain-specific animations
export {
  StreamlineAnimation,
  type StreamlineAnimationState,
  type StreamlineAnimationOptions,
  type StreamlineAnimationData,
  type StreamlineAnimationCPUOptions,
  type StreamlineAnimationGPUOptions,
  type StreamlineData,  // Legacy alias
  type StreamlineDomain,
  type StreamlineBackend,
} from './animation/animations/streamline-animation';

export {
  PathlineAnimation,
  type PathlineAnimationState,
  type PathlineAnimationOptions,
  type PathlineData,
} from './animation/animations/pathline-animation';

export {
  PulsingPathlineAnimation,
  type PulsingPathlineAnimationState,
  type PulsingPathlineAnimationOptions,
} from './animation/animations/pulsing-pathline-animation';

