<script lang="ts">
	// Casting sudoku into continuous generation, laid out left → right:
	//
	//   [Gaussian noise           →  [ Flow ]  →   [one-hot 81×9]     [sudoku grid]
	//    of same 81×9 shape                                         (result of decoding)
	//    with random floats]
	//
	// The LHS "noise" and RHS "one-hot" columns are the same tensor shape;
	// the middle "Flow" block transports one to the other, an arrow passing
	// through it end-to-end. The sudoku grid sits to the right of the one-
	// hot stack as the concrete decoding.
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import SudokuPanel from './SudokuPanel.svelte';
	import { argmaxDigits, type SudokuThesisData } from './sudoku_playback';

	const BOARD_SIZE = 240;
	const N_ROWS_TOP = 4;
	const N_ROWS_BOTTOM = 4;

	let sudokuData = $state<SudokuThesisData | null>(null);

	let values = $derived.by(() => {
		if (!sudokuData) return new Array<number>(81).fill(0);
		const finalStep = sudokuData.steps[sudokuData.steps.length - 1];
		return finalStep?.probs ? argmaxDigits(finalStep.probs) : new Array<number>(81).fill(0);
	});

	const topIdx = Array.from({ length: N_ROWS_TOP }, (_, i) => i);
	const bottomIdx = Array.from({ length: N_ROWS_BOTTOM }, (_, i) => 81 - N_ROWS_BOTTOM + i);

	// Deterministic Gaussian samples for the LHS noise matrix. We need
	// the SAME 8 visible rows on both sides so the shapes read as "same
	// tensor," and we want them stable across renders. Box-Muller on a
	// tiny LCG seeded from the row index.
	function gaussSample(idx: number, digit: number): number {
		// LCG constants (Numerical Recipes) — plenty for a static figure.
		let s = ((idx * 9 + digit) * 1103515245 + 12345) >>> 0;
		const step = () => {
			s = (s * 1103515245 + 12345) >>> 0;
			return (s & 0x7fffffff) / 0x7fffffff;
		};
		const u1 = Math.max(1e-6, step());
		const u2 = step();
		// Absolute value so all displayed numbers are positive — cells have
		// a consistent width and the brackets align cleanly across rows.
		return Math.abs(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
	}

	function fmtNoise(v: number): string {
		// Compact two-decimal signed float. Handle "−0.00" edge case.
		const s = v.toFixed(2);
		return s === '-0.00' ? '0.00' : s;
	}

	onMount(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(`${base}/data/sudoku_thesis.json`);
				if (!res.ok) return;
				const json = (await res.json()) as SudokuThesisData;
				if (!cancelled) sudokuData = json;
			} catch (err) {
				console.error('[sudoku-onehot] load failed', err);
			}
		})();
		return () => {
			cancelled = true;
		};
	});
</script>

<div class="figure-wrap">
	<div class="pipeline">
		<!-- LHS: Gaussian noise vectors of the same 81 × 9 shape ----------- -->
		<div class="tensor-side">
			<div class="tensor-caption">Gaussian noise (81 × 9)</div>
			<div class="tensor-stack">
				{#each topIdx as i}
					<div class="row-line">
						<span class="row-vec-tex noise">
							[<span class="entry">{fmtNoise(gaussSample(i, 0))}</span> <span class="entry">{fmtNoise(gaussSample(i, 1))}</span> … <span class="entry">{fmtNoise(gaussSample(i, 8))}</span>]
						</span>
					</div>
				{/each}
				<div class="ellipsis-tex">⋮</div>
				{#each bottomIdx as i}
					<div class="row-line">
						<span class="row-vec-tex noise">
							[<span class="entry">{fmtNoise(gaussSample(i, 0))}</span> <span class="entry">{fmtNoise(gaussSample(i, 1))}</span> … <span class="entry">{fmtNoise(gaussSample(i, 8))}</span>]
						</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- MIDDLE: Flow block with an arrow passing through ---------------- -->
		<div class="flow-block-wrap">
			<svg viewBox="0 0 260 130" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
				<defs>
					<marker
						id="pipe-arrow"
						viewBox="0 -5 10 10"
						refX="9"
						refY="0"
						markerWidth="9"
						markerHeight="9"
						orient="auto"
					>
						<path d="M0,-5L10,0L0,5" fill="#444" />
					</marker>
				</defs>
				<!-- Arrow shaft, drawn under the block so it visually passes through -->
				<line
					x1="4"
					y1="65"
					x2="256"
					y2="65"
					stroke="#444"
					stroke-width="2.5"
					marker-end="url(#pipe-arrow)"
				/>
				<!-- Flow block on top of the arrow -->
				<rect x="55" y="30" width="150" height="70" rx="10" ry="10" class="flow-block-rect" />
				<text x="130" y="76" text-anchor="middle" class="flow-block-label">Flow</text>
			</svg>
		</div>

		<!-- RHS: one-hot 81 × 9 grid + sudoku decoding to its right --------- -->
		<div class="rhs-cluster">
			<div class="tensor-side">
				<div class="tensor-caption">81 × 9 Grid (one-hot)</div>
				<div class="tensor-stack">
					{#each topIdx as i}
						<div class="row-line">
							<span class="row-vec-tex">
								[{#each Array(9) as _, digit}<span class="entry">{values[i] === digit + 1 ? 1 : 0}</span>{digit < 8 ? ' ' : ''}{/each}]
							</span>
						</div>
					{/each}
					<div class="ellipsis-tex">⋮</div>
					{#each bottomIdx as i}
						<div class="row-line">
							<span class="row-vec-tex">
								[{#each Array(9) as _, digit}<span class="entry">{values[i] === digit + 1 ? 1 : 0}</span>{digit < 8 ? ' ' : ''}{/each}]
							</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Thin flat connector between the one-hot stack and the sudoku grid -->
			<div class="thin-connector" aria-hidden="true"></div>

			<div class="grid-side">
				<div class="tensor-caption">9 × 9 Sudoku Grid</div>
				<div class="grid-wrap" style="width: {BOARD_SIZE}px; height: {BOARD_SIZE}px;">
					{#if sudokuData}
						<SudokuPanel
							solution={sudokuData.solution}
							clueMask={sudokuData.clueMask}
							values={values}
							size={BOARD_SIZE}
						/>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.figure-wrap {
		width: 100%;
		display: flex;
		justify-content: center;
	}

	.pipeline {
		display: flex;
		align-items: center;
		gap: 1.25rem;
	}

	.tensor-side,
	.grid-side {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.tensor-caption {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 1.15rem;
		font-weight: 600;
		color: #333;
	}

	.tensor-stack {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.row-line {
		display: flex;
		align-items: center;
	}

	.row-vec-tex {
		font-family: 'STIX Two Math', 'Cambria Math', 'Latin Modern Math', 'Times New Roman', serif;
		font-size: 1.5rem;
		color: #222;
		letter-spacing: 0.05em;
		white-space: pre;
	}

	.row-vec-tex.noise {
		font-size: 1.5rem;
		font-variant-numeric: tabular-nums;
	}

	.row-vec-tex.noise .entry {
		display: inline-block;
		min-width: 3.2ch;
		text-align: right;
	}

	.ellipsis-tex {
		font-family: 'STIX Two Math', 'Cambria Math', 'Latin Modern Math', serif;
		font-size: 1.8rem;
		color: #888;
		line-height: 0.6;
		padding: 6px 0;
	}

	.flow-block-wrap {
		width: 260px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.flow-block-wrap svg {
		width: 260px;
		height: 130px;
	}

	.flow-block-rect {
		fill: #ececee;
		stroke: #666;
		stroke-width: 1.5;
	}

	.flow-block-label {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 26px;
		font-weight: 600;
		fill: #222;
	}

	.rhs-cluster {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.thin-connector {
		width: 30px;
		height: 1.5px;
		background: #666;
		flex-shrink: 0;
	}

	.grid-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>
