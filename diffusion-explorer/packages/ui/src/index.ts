// Existing components
export { default as Katex } from './Katex.svelte';
export { default as Minimizable } from './Minimizable.svelte';
export { default as Quote } from './Quote.svelte';
export { plotKatexInSVG, type PlotKatexOptions, type Anchor } from './d3_utils';

// Layout components
export { default as TableOfContents } from './TableOfContents.svelte';
export { default as Figure } from './Figure.svelte';
export { default as DoubleFigure } from './DoubleFigure.svelte';

// UI Controls
export { default as PlayButton } from './PlayButton.svelte';
export { default as TimeSlider } from './TimeSlider.svelte';
export { default as TextToggleButton } from './TextToggleButton.svelte';

// Algorithm components
export { default as Algorithm } from './Algorithm.svelte';
export { default as AlgorithmLine } from './AlgorithmLine.svelte';

// Bibliography components
export { default as Bibliography } from './Bibliography.svelte';
export { default as HoverableReference } from './HoverableReference.svelte';

// Citations utilities
export {
  type BibEntry,
  type CitationInfo,
  parseBibTeX,
  loadBibliography,
  collectCitations,
  formatAuthors
} from './citations';