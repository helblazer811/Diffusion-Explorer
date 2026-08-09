<script lang="ts">
	// Sudoku panel of the thesis figure. Wraps SudokuGrid in "correctness" mode:
	//   values[i] = argmax digit of the current step's per-cell distribution
	//   solution[i] = ground truth
	//   clueMask[i] = which cells were given (rendered as bold, no tint)
	// Non-clue cells get a green tint when values[i] === solution[i] and a red
	// tint otherwise. The parent (ThesisFigure) picks the step and computes the
	// argmax; this component just renders.
	import SudokuGrid from './SudokuGrid.svelte';

	interface Props {
		/** Length-81 ground truth digits 1..9. */
		solution: number[];
		/** Length-81 mask, 1 where the cell was given as a clue. */
		clueMask: number[];
		/** Current argmax digits for the current step. */
		values: number[];
		/** Rendered side length of the SVG grid in px on the 1280×720 canvas. */
		size?: number;
	}

	let { solution, clueMask, values, size = 460 }: Props = $props();
</script>

<div class="wrap">
	<SudokuGrid
		{solution}
		{clueMask}
		{size}
		correctness={true}
		values={values as (number | null)[]}
		correctnessOpacity={0.32}
		okColor="#1f7a44"
		badColor="#c0392b"
	/>
</div>

<style>
	.wrap {
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>
