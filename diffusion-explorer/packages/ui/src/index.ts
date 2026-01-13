// Existing components
export { default as Katex } from './components/Katex.svelte';
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
export * from './plotting/streamlines';
export * from './plotting/mesh_grid';
export * from './plotting/heatmap';
export { useCanvas2D } from './plotting/canvas';
export * from './plotting/utils';

// Animation utilities
export {
  Clock,
  Timeline,
  Layer,
  createPauseClip,
  type Clip,
  type ClipTiming,
  type ClipOptions,
} from './animation/timeline';

export {
  type Animation,
  type AnimationWithData,
} from './animation/animation';

export {
  useVisibilityHandler,
  type VisibilityState,
} from './animation/visibility';

export {
  StreamlineAnimation,
  type StreamlineAnimationState,
  type StreamlineAnimationOptions,
  type StreamlineData,
  type StreamlineDomain,
} from './animation/streamline-animation';

export {
  PathlineAnimation,
  type PathlineAnimationState,
  type PathlineAnimationOptions,
  type PathlineData,
} from './animation/pathline-animation';

export {
  propagateStreamlines,
  generateDiscreteStreamlines,
  interpolateCurves,
  getDiscreteSnapshot,
  sampleStreamlineUniformly,
  precomputePropagatedPaths,
  precomputeDiscretePaths,
  getPropagatedPathIndex,
  getDiscretePathIndex,
  type PropagatedStreamlineData,
  type DiscreteStreamlineData,
  type PropagateOptions,
  type TimeVaryingVectorFieldFn,
} from './animation/streamline-propagation';

