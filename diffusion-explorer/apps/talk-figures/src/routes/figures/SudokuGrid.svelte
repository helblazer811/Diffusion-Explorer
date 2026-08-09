<script lang="ts">
	// Pure SVG renderer for a 9x9 Sudoku grid.
	//
	// Puzzle representation matches the project's SudokuExtreme dataset
	// (flow_map_reasoning/datasets/sudoku_extreme.py): row-major length-81 arrays.
	//   - `solution`: digits 1..9 to display (0 / null renders an empty cell)
	//   - `clueMask`: length-81, 1 where the cell is a given clue, else 0
	// Clue cells get a tinted background + bold dark digits; the remaining
	// (filled-in / generated) cells render their digit in an accent color.
	//
	// Uncertainty mode (`uncertainty` + `probs`): instead of one digit per
	// cell, render ALL candidate digits 1..9 overlaid (centered) with opacity
	// proportional to their probability — a "superposition" view of the model's
	// per-cell distribution. See `./sudoku_playback` (types + helpers inlined
	// from FlowMapReasoning/interactive_blog/src/lib/sudoku_uncertainty.ts so
	// the duplicated grid has zero cross-package dependencies).

	import { cellCandidates, type CellProbs } from './sudoku_playback';

	interface Props {
		/** Length-81 row-major digits (1..9). 0 or null = empty cell. */
		solution?: (number | null)[];
		/** Length-81 row-major mask, 1 = given clue. Defaults to all-zero (no clues). */
		clueMask?: number[];
		/** Rendered side length in px. */
		size?: number;
		/** Background tint for clue cells. */
		clueBg?: string;
		/** Digit color for clue (given) cells. */
		clueText?: string;
		/** Digit color for non-clue (filled-in) cells. */
		fillText?: string;
		/** When true, render per-cell distributions from `probs` instead of `solution`. */
		uncertainty?: boolean;
		/** Per-cell distribution over digits 1..9: probs[cell][digit-1]. Shape [81][9]. */
		probs?: CellProbs;
		/** Digit color in uncertainty mode. */
		uncertainText?: string;
		/** Drop candidates with probability <= this (not rendered). */
		probEps?: number;
		/** Opacity floor for any rendered candidate, so faint-but-real ones stay visible. */
		minOpacity?: number;
		/** Recency mode: show the current argmax digit per cell and tint non-clue
		 *  cells blue by how recently the value last flipped. */
		recency?: boolean;
		/** Recency mode: current argmax digit (1..9) per cell, length-81. */
		values?: (number | null)[];
		/** Recency mode: per-cell blue-tint opacity in [0,1], length-81. */
		recencyOpacity?: number[];
		/** Recency mode: blue tint color. */
		recencyColor?: string;
		/** Correctness mode: show argmax digit per cell, tint non-clue cells green
		 *  (matches `solution`) or red (wrong). Uses `values` for the digit and
		 *  `solution` as ground truth. */
		correctness?: boolean;
		/** Correctness mode: background tint opacity. */
		correctnessOpacity?: number;
		/** Correctness mode: fill for cells whose argmax matches solution. */
		okColor?: string;
		/** Correctness mode: fill for cells whose argmax disagrees with solution. */
		badColor?: string;
	}

	let {
		solution = [],
		clueMask = [],
		size = 360,
		clueBg = '#dcdfe3',
		clueText = '#1a1a1a',
		fillText = '#1a1a1a',
		uncertainty = false,
		probs = [],
		uncertainText = '#1a1a1a',
		probEps = 0.02,
		minOpacity = 0.08,
		recency = false,
		values = [],
		recencyOpacity = [],
		recencyColor = 'rgb(0, 100, 200)',
		correctness = false,
		correctnessOpacity = 0.28,
		okColor = '#1f7a44',
		badColor = '#b02a2a'
	}: Props = $props();

	// Geometry in grid units; the SVG viewBox is 0..9 so each cell is 1 unit.
	const N = 9;
	// $derived so the cells (and their candidate opacities) recompute whenever the
	// inputs change — essential for the uncertainty animation where `probs` updates
	// every tick. A plain const here would compute once and never re-render.
	const cells = $derived(
		Array.from({ length: N * N }, (_, i) => {
			const row = Math.floor(i / N);
			const col = i % N;
			const isClue = (clueMask?.[i] ?? 0) === 1;
			// In recency / correctness mode the displayed digit is the argmax from
			// `values`; otherwise it's the `solution` digit.
			const value = recency || correctness ? (values?.[i] ?? 0) : (solution?.[i] ?? 0);
			// In uncertainty mode, the overlaid candidate digits for this cell.
			const candidates = uncertainty
				? cellCandidates(probs?.[i], { eps: probEps, minOpacity })
				: [];
			// In recency mode, the blue-tint opacity for non-clue cells.
			const recOpacity = recency && !isClue ? Math.max(0, Math.min(1, recencyOpacity?.[i] ?? 0)) : 0;
			// In correctness mode, whether this non-clue cell's argmax matches truth.
			const correct = value >= 1 && value <= 9 && value === (solution?.[i] ?? 0);
			return { i, row, col, value, isClue, candidates, recOpacity, correct };
		})
	);

	// Line offsets 0..9. Box boundaries (0,3,6,9) are drawn thick.
	const lines = Array.from({ length: N + 1 }, (_, k) => k);
	const isBox = (k: number) => k % 3 === 0;
	// Pad the viewBox so the thick outer border strokes (at 0 and 9) aren't clipped
	// in half by the viewBox edge — otherwise the frame looks thinner than the
	// interior 3x3 box lines.
	const PAD = 0.05;
</script>

<svg
	class="sudoku-grid"
	viewBox="{-PAD} {-PAD} {9 + 2 * PAD} {9 + 2 * PAD}"
	width={size}
	height={size}
	style="--clue-bg: {clueBg}; --clue-text: {clueText}; --fill-text: {fillText}; --uncertain-text: {uncertainText}; --recency-color: {recencyColor}; --ok-color: {okColor}; --bad-color: {badColor};"
	role="img"
	aria-label={uncertainty
		? 'Sudoku grid with per-cell uncertainty'
		: recency
			? 'Sudoku grid tinted by how recently each cell changed'
			: 'Sudoku grid'}
>
	<!-- Cell backgrounds (clue cells tinted) -->
	{#each cells as cell (cell.i)}
		{#if cell.isClue}
			<rect class="clue-cell" x={cell.col} y={cell.row} width="1" height="1" />
		{/if}
	{/each}

	{#if recency}
		<!-- Recency mode: blue tint by how recently each non-clue cell flipped. -->
		{#each cells as cell (cell.i)}
			{#if cell.recOpacity > 0}
				<rect
					class="recency-cell"
					x={cell.col}
					y={cell.row}
					width="1"
					height="1"
					opacity={cell.recOpacity}
				/>
			{/if}
		{/each}
	{/if}

	{#if correctness}
		<!-- Correctness mode: green (matches solution) / red (wrong) for non-clue cells. -->
		{#each cells as cell (cell.i)}
			{#if !cell.isClue && cell.value >= 1 && cell.value <= 9}
				<rect
					class="correct-cell {cell.correct ? 'ok' : 'bad'}"
					x={cell.col}
					y={cell.row}
					width="1"
					height="1"
					opacity={correctnessOpacity}
				/>
			{/if}
		{/each}
	{/if}

	{#if uncertainty}
		<!-- Uncertainty mode: overlay all candidate digits, opacity ~ probability. -->
		{#each cells as cell (cell.i)}
			{#each cell.candidates as cand (cand.digit)}
				<text
					class="digit uncertain"
					x={cell.col + 0.5}
					y={cell.row + 0.5}
					dominant-baseline="central"
					text-anchor="middle"
					opacity={cand.opacity}
				>
					{cand.digit}
				</text>
			{/each}
		{/each}
	{:else}
		<!-- Digits -->
		{#each cells as cell (cell.i)}
			{#if cell.value >= 1 && cell.value <= 9}
				<text
					class="digit {cell.isClue ? 'clue' : 'fill'}"
					x={cell.col + 0.5}
					y={cell.row + 0.5}
					dominant-baseline="central"
					text-anchor="middle"
				>
					{cell.value}
				</text>
			{/if}
		{/each}
	{/if}

	<!-- Grid lines: draw the THIN inner lines first, then the THICK 3x3 box lines
	     on top so the black box lines aren't overdrawn by the gray ones. -->
	{#each lines as k (`ht${k}`)}
		{#if !isBox(k)}
			<line class="grid-line thin" x1="0" y1={k} x2="9" y2={k} />
		{/if}
	{/each}
	{#each lines as k (`vt${k}`)}
		{#if !isBox(k)}
			<line class="grid-line thin" x1={k} y1="0" x2={k} y2="9" />
		{/if}
	{/each}
	{#each lines as k (`hb${k}`)}
		{#if isBox(k)}
			<line class="grid-line box" x1="0" y1={k} x2="9" y2={k} />
		{/if}
	{/each}
	{#each lines as k (`vb${k}`)}
		{#if isBox(k)}
			<line class="grid-line box" x1={k} y1="0" x2={k} y2="9" />
		{/if}
	{/each}
</svg>

<style>
	.sudoku-grid {
		display: block;
		max-width: 100%;
		height: auto;
		background: #fff;
	}

	.clue-cell {
		fill: var(--clue-bg);
	}

	.recency-cell {
		fill: var(--recency-color);
	}

	.correct-cell.ok {
		fill: var(--ok-color);
	}

	.correct-cell.bad {
		fill: var(--bad-color);
	}

	.digit {
		/* Font size is in grid units (cell = 1 unit). */
		font-size: 0.62px;
		font-family: var(--font-family, sans-serif);
	}

	.digit.clue {
		fill: var(--clue-text);
		font-weight: 400;
	}

	.digit.fill {
		fill: var(--fill-text);
		font-weight: 400;
	}

	.digit.uncertain {
		fill: var(--uncertain-text);
		font-weight: 500;
	}

	.grid-line {
		stroke: #333;
		fill: none;
		/* Caps/joins so thick box lines meet cleanly at corners. */
		stroke-linecap: square;
	}

	.grid-line.thin {
		stroke: #c9c9c9;
		stroke-width: 0.02px;
	}

	.grid-line.box {
		stroke: #333;
		stroke-width: 0.06px;
	}
</style>
