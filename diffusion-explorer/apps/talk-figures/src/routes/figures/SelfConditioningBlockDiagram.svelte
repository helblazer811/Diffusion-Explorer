<script lang="ts">
	// One-block self-conditioning diagram with the recurrence drawn as a
	// literal loop back to the top of the block, plus an animated sudoku
	// below that plays through the trajectory over time:
	//
	//     ┌─────────────────────────┐
	//     │                         │
	//     │       ▼                 │
	//     │  ┌──────────┐           │
	//   z_t ─►│ Flow Model│───► x̂₁ ─┘   (recurrence: x̂₁ loops back
	//     │  └──────────┘                to the block's top input)
	//     │       │
	//     │       ▼
	//     │   [sudoku animating over time]
	//
	// Sudoku is driven by the same tempus Player pattern SudokuFigure uses,
	// looping over all steps in sudoku_thesis.json so viewers see the grid
	// refine and correct itself while the loop is on-screen.
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import SudokuPanel from './SudokuPanel.svelte';
	import { argmaxDigits, type SudokuThesisData } from './sudoku_playback';

	const BOARD_SIZE = 220;
	const REFINE_MS = 16000;
	const HOLD_MS = 4000;

	interface State {
		progress: number;
	}
	function smoothstep(t: number): number {
		return t * t * (3 - 2 * t);
	}

	let progress = $state(0);
	let sudokuData = $state<SudokuThesisData | null>(null);
	let sudokuN = $derived(sudokuData?.steps.length ?? 1);
	let sudokuStep = $derived(
		Math.min(sudokuN - 1, Math.max(0, Math.floor(smoothstep(progress) * (sudokuN - 1))))
	);
	let sudokuValues = $derived.by(() => {
		if (!sudokuData) return new Array<number>(81).fill(0);
		const probs = sudokuData.steps[sudokuStep]?.probs;
		return probs ? argmaxDigits(probs) : new Array<number>(81).fill(0);
	});

	let player: Player<State> | undefined;

	function buildTimeline() {
		return new TimelineBuilder<State>()
			.setInitialState({ progress: 0 })
			.add(
				{
					name: 'refine',
					reduce(t: number) {
						return { progress: t };
					}
				},
				{ durationMs: REFINE_MS }
			)
			.add(
				{
					name: 'hold',
					reduce(_t: number) {
						return { progress: 1 };
					}
				},
				{ durationMs: HOLD_MS }
			)
			.build();
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
				console.error('[self-cond] sudoku load failed', err);
			}
		})();

		player = new Player<State>(buildTimeline(), {
			looping: true,
			endPause: 0.5
		});
		player.onTick((_t, s) => {
			progress = s.progress;
		});
		player.play();

		return () => {
			cancelled = true;
			player?.dispose();
		};
	});
</script>

<div class="figure-wrap">
	<p class="subtitle">
		Self-conditioning is a mechanism for error correction in continuous
		diffusion / flows.
	</p>

	<div class="diagram-row">
	<svg
		class="diagram-svg"
		viewBox="0 0 800 380"
		xmlns="http://www.w3.org/2000/svg"
		aria-label="Self-conditioning: Flow Model block with a recurrence loop."
	>
		<defs>
			<marker
				id="arrowhead"
				viewBox="0 -5 10 10"
				refX="9"
				refY="0"
				markerWidth="8"
				markerHeight="8"
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill="#444" />
			</marker>
			<marker
				id="arrowhead-loop"
				viewBox="0 -5 10 10"
				refX="9"
				refY="0"
				markerWidth="8"
				markerHeight="8"
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill="#c76a1a" />
			</marker>
		</defs>

		<!-- ============================================================ -->
		<!-- Recurrence loop (drawn first, sits behind the block)          -->
		<!-- Path: from x̂₁ label position (right of block, y≈190),        -->
		<!-- up, left across the top, and down into the block's top edge.  -->
		<!-- ============================================================ -->
		<path
			class="loop-path"
			d="M 655 170
			   L 655 90
			   L 450 90
			   L 450 140"
			fill="none"
			stroke="#c76a1a"
			stroke-width="2.5"
			stroke-linecap="butt"
			stroke-linejoin="miter"
			stroke-dasharray="8 6"
			marker-end="url(#arrowhead-loop)"
		/>
		<!-- Loop caption -->
		<text x="552" y="35" class="loop-label" text-anchor="middle">
			<tspan x="552" dy="0">Condition future attempts</tspan>
			<tspan x="552" dy="1.15em">on past ones</tspan>
		</text>

		<!-- ============================================================ -->
		<!-- Main horizontal flow: z_t → [Flow Model] → x̂₁                -->
		<!-- ============================================================ -->

		<!-- z_t label -->
		<text x="220" y="197" class="var" text-anchor="middle">z<tspan class="sub">t</tspan></text>

		<!-- Arrow z_t → block -->
		<line x1="250" y1="190" x2="330" y2="190" stroke="#444" stroke-width="2" marker-end="url(#arrowhead)" />

		<!-- Flow Model block -->
		<rect x="330" y="150" width="240" height="80" rx="10" ry="10" class="block" />
		<text x="450" y="198" class="block-label" text-anchor="middle">Flow Model</text>

		<!-- Arrow block → x̂₁ label -->
		<line x1="570" y1="190" x2="620" y2="190" stroke="#444" stroke-width="2" marker-end="url(#arrowhead)" />

		<!-- x̂₁ label -->
		<text x="655" y="197" class="var" text-anchor="middle">
			x̂<tspan class="sub">1</tspan>
		</text>

		<!-- Right arrow: x̂₁ → sudoku beside it -->
		<line x1="680" y1="190" x2="780" y2="190" stroke="#444" stroke-width="2" marker-end="url(#arrowhead)" />
	</svg>

		<!-- Animated sudoku, sitting inline to the right of the SVG -->
		<div class="board-slot">
			{#if sudokuData}
				<SudokuPanel
					solution={sudokuData.solution}
					clueMask={sudokuData.clueMask}
					values={sudokuValues}
					size={BOARD_SIZE}
				/>
				<div class="step-counter">step {sudokuStep + 1} / {sudokuN}</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.figure-wrap {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.subtitle {
		margin: 0 0 0.75rem 0;
		font-size: 1.15rem;
		color: #333;
		font-style: italic;
		text-align: center;
		max-width: 900px;
	}

	.diagram-row {
		width: 100%;
		max-width: 1200px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
	}

	.diagram-svg {
		flex: 1 1 auto;
		max-width: 800px;
		height: auto;
	}

	.board-slot {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.step-counter {
		font-size: 1rem;
		color: #777;
		font-variant-numeric: tabular-nums;
	}

	.block {
		fill: #ececee;
		stroke: #666;
		stroke-width: 1.5;
	}

	.block-label {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 22px;
		font-weight: 600;
		fill: #222;
	}

	.var {
		font-family: 'STIX Two Math', 'Cambria Math', 'Latin Modern Math', serif;
		font-style: italic;
		font-size: 26px;
		fill: #111;
	}

	.sub {
		font-size: 0.72em;
		baseline-shift: sub;
	}

	.loop-label {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 24px;
		fill: #c76a1a;
		font-style: italic;
	}

	.loop-path {
		animation: loop-march 1.2s linear infinite;
	}

	@keyframes loop-march {
		to {
			/* Sum of dasharray (8 + 6 = 14) — one full cycle brings the
			   pattern back to its starting position, so the animation
			   loops seamlessly. */
			stroke-dashoffset: -14;
		}
	}
</style>
