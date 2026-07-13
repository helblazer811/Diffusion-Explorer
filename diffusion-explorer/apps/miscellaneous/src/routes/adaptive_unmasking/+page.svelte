<script lang="ts">
	import { ArticleHeader, Figure } from '@diffusion-explorer/ui';
	import { base } from '$app/paths';
	import { writable } from 'svelte/store';
	import SudokuAdaptiveUnmaskingFigure from './SudokuAdaptiveUnmaskingFigure.svelte';

	const MASK_COLOR = '#cfe0f2';
	const MASK_TEXT_COLOR = '#33506e';

	const figureActive = writable(false);
</script>

<ArticleHeader
	title="Adaptive Unmasking Strategies"
	subtitle="Committing high-confidence cells first on a sudoku puzzle"
	author="Alec Helbling"
	authorLink="https://alechelbling.com"
/>

<p>
	Under a naive schedule, masked diffusion unmasks positions in a random
	order. But <em>which</em> masked position to reveal next is itself a
	decision the sampler can make. An adaptive schedule looks at the model's
	current per-position probability distributions and commits the position
	the model is most confident about &mdash; leaving genuinely uncertain
	slots for later steps, when more context has been resolved.
</p>

<Figure backgroundVisible={false} isActive={figureActive}>
	{#snippet children()}
		<SudokuAdaptiveUnmaskingFigure
			isActive={figureActive}
			maskColor={MASK_COLOR}
			maskTextColor={MASK_TEXT_COLOR}
			trajectoryUrl={`${base}/adaptive_unmasking/data/sudoku_uncertainty_correct.json`}
		/>
	{/snippet}
	{#snippet caption()}
		<strong>Adaptive unmasking commits confident cells first.</strong>
		Left: a real 32-step decoding trajectory of a sudoku puzzle,
		showing per-cell probability distributions collapsing as the
		model resolves the grid. Right: solve rate as a function of
		decoding budget &mdash; an adaptive strategy that reveals the
		highest-confidence cell at each step reaches high solve rates
		with far fewer steps than a fixed-order schedule.
	{/snippet}
</Figure>
