// Existing components
export { default as Katex } from './components/Katex.svelte';
export { default as Minimizable } from './components/Minimizable.svelte';
export { default as Quote } from './components/Quote.svelte';
export { plotKatexInSVG, type PlotKatexOptions, type Anchor } from './d3_utils';

// Layout components
export { default as TableOfContents } from './components/TableOfContents.svelte';
export { default as Figure } from './components/Figure.svelte';
export { default as DoubleFigure } from './components/DoubleFigure.svelte';

// UI Controls
export { default as PlayButton } from './components/PlayButton.svelte';
export { default as TimeSlider } from './components/TimeSlider.svelte';
export { default as TextToggleButton } from './components/TextToggleButton.svelte';

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