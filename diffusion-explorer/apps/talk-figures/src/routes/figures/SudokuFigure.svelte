<script lang="ts">
	// Standalone Sudoku refinement figure. Drives SudokuPanel from a captured
	// flow-model trajectory (per-cell probabilities over N steps) via a single
	// tempus Player. Loops the refinement + hold; shows a step counter.
	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { base } from '$app/paths';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';

	import SudokuPanel from './SudokuPanel.svelte';
	import { argmaxDigits, type SudokuThesisData } from './sudoku_playback';

	interface Props {
		isActive?: Writable<boolean>;
		/** Rendered side length of the grid in px. */
		size?: number;
		/** Whether to show the "step N / M" counter under the grid. */
		showStepCounter?: boolean;
	}

	let { isActive, size = 500, showStepCounter = true }: Props = $props();

	const REFINE_MS = 16000;
	const HOLD_MS = 4000;

	interface State {
		progress: number;
	}

	let progress = $state(0);
	function smoothstep(t: number): number {
		return t * t * (3 - 2 * t);
	}

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
		const refineClip = {
			name: 'refine',
			reduce(t: number): Partial<State> {
				return { progress: t };
			}
		};
		const holdClip = {
			name: 'hold',
			reduce(_t: number): Partial<State> {
				return { progress: 1 };
			}
		};
		return new TimelineBuilder<State>()
			.setInitialState({ progress: 0 })
			.add(refineClip, { durationMs: REFINE_MS })
			.add(holdClip, { durationMs: HOLD_MS })
			.build();
	}

	onMount(() => {
		let cancelled = false;

		(async () => {
			try {
				const res = await fetch(`${base}/data/sudoku_thesis.json`);
				if (!res.ok) {
					console.error('[sudoku] failed to fetch data', res.status);
					return;
				}
				const json = (await res.json()) as SudokuThesisData;
				if (cancelled) return;
				sudokuData = json;
			} catch (err) {
				console.error('[sudoku] data load failed', err);
			}
		})();

		player = new Player<State>(buildTimeline(), {
			looping: true,
			endPause: 0.5
		});
		player.onTick((_t, s) => {
			progress = s.progress;
		});

		const unsubActive = isActive?.subscribe((v) => {
			if (!player) return;
			if (v) player.play();
			else {
				player.pause();
				player.reset();
				progress = 0;
			}
		});

		// If no isActive store was passed, just play once mounted.
		if (!isActive) player.play();

		return () => {
			cancelled = true;
			unsubActive?.();
			player?.dispose();
		};
	});
</script>

<div class="sudoku-figure">
	{#if sudokuData}
		<SudokuPanel
			solution={sudokuData.solution}
			clueMask={sudokuData.clueMask}
			values={sudokuValues}
			{size}
		/>
		{#if showStepCounter}
			<div class="step-counter">step {sudokuStep + 1} / {sudokuN}</div>
		{/if}
	{:else}
		<div class="loading" style="width: {size}px; height: {size}px;">loading…</div>
	{/if}
</div>

<style>
	.sudoku-figure {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.step-counter {
		font-size: 1.25rem;
		color: #777;
		font-variant-numeric: tabular-nums;
	}

	.loading {
		display: flex;
		align-items: center;
		justify-content: center;
		color: #999;
		font-style: italic;
		background: #f7f7f7;
		border-radius: 8px;
	}
</style>
