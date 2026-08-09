<script lang="ts">
	// Decoding-trajectory view of AR vs. masked diffusion on a short line.
	//
	// Both paradigms are shown as a vertical stack of steps: step 0 is the
	// empty (fully-masked) line, step k is the line after k tokens have been
	// generated, step N is the fully-revealed line. Rows fade in top-to-bottom
	// on one shared tempus clock. AR reveals slots in fixed left-to-right
	// order; masked diffusion reveals slots in a fixed random order. Pending
	// slots in *both* rows are gray rectangles sized to the eventual word so
	// the columns stay aligned.
	//
	// The AR block sits above the diffusion block; they share a single
	// paragraph line (10 tokens by default) so the reader can see all N+1
	// generation steps for each paradigm.

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import { tokenize, buildMaskSchedule } from './masked_diffusion_math';

	// Short line, exactly 7 word tokens. Every column has a fixed slot
	// width so the two paradigms align cleanly and pending [MASK] pills
	// don't reshape the row as tokens fill in.
	const DEFAULT_LINE = 'The cat sat on the mat';

	interface Props {
		isActive?: Writable<boolean>;
		text?: string;
		seed?: number;
		/** Background color of the [MASK] pill. */
		maskColor?: string;
		/** Text color for the [MASK] label. */
		maskTextColor?: string;
	}

	let {
		isActive,
		text = DEFAULT_LINE,
		seed = 3,
		maskColor = '#cfe0f2',
		maskTextColor = '#33506e'
	}: Props = $props();

	const tokenized = $derived(tokenize(text));
	const tokens = $derived(tokenized.tokens);
	const N = $derived(tokens.length);

	// AR reveal order = identity. Masked-diffusion order = seeded permutation.
	const arOrder = $derived(Array.from({ length: N }, (_, i) => i));
	const mdOrder = $derived(buildMaskSchedule(N, seed));

	// posInSchedule[order][i] = step at which token i is revealed under `order`.
	function invertOrder(order: number[]): number[] {
		const inv = new Array<number>(order.length);
		for (let k = 0; k < order.length; k++) inv[order[k]] = k;
		return inv;
	}
	const arPos = $derived(invertOrder(arOrder));
	const mdPos = $derived(invertOrder(mdOrder));

	// Whether token i is revealed at step s under a given `pos` array.
	function revealedAt(pos: number[], i: number, step: number): boolean {
		return step > pos[i];
	}

	const STEP_MS = 550; // per row fade-in
	const HOLD_MS = 1500; // hold on the fully-revealed grid
	const nRows = $derived(N + 1);
	const revealMs = $derived(nRows * STEP_MS);

	interface State {
		progress: number;
	}
	let progress = $state(0);

	// Fractional row-fade progress: [0, nRows] over the reveal clip.
	const rowsRevealed = $derived(progress * nRows);
	const ROW_FADE = 0.45; // fade half-width, in row units

	function rowOpacity(rowIndex: number): number {
		const d = rowsRevealed - rowIndex - 0.5;
		if (d >= ROW_FADE) return 1;
		if (d <= -ROW_FADE) return 0;
		const u = (d + ROW_FADE) / (2 * ROW_FADE);
		return u * u * (3 - 2 * u);
	}

	let player: Player<State> | undefined;

	function buildTimeline() {
		const revealClip = {
			name: 'reveal',
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
			.add(revealClip, { durationMs: revealMs })
			.add(holdClip, { durationMs: HOLD_MS })
			.build();
	}

	onMount(() => {
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
		return () => {
			unsubActive?.();
			player?.dispose();
		};
	});
</script>

<div class="wrap" style="--mask-color: {maskColor}; --mask-text-color: {maskTextColor}">
	<div class="block">
		<div class="label">Autoregressive</div>
		<div class="stack">
			{#each Array(nRows) as _, step (step)}
				<p class="line" style="opacity: {rowOpacity(step)}">
					{#each tokens as tok, i (i)}
						<span class="slot" aria-label={tok}>
							{#if revealedAt(arPos, i, step)}
								<span class="content">{tok}</span>
							{:else}
								<span class="ar-placeholder"></span>
							{/if}
						</span>
					{/each}
				</p>
			{/each}
		</div>
	</div>

	<div class="block">
		<div class="label">Masked Diffusion</div>
		<div class="stack">
			{#each Array(nRows) as _, step (step)}
				<p class="line" style="opacity: {rowOpacity(step)}">
					{#each tokens as tok, i (i)}
						<span class="slot" aria-label={tok}>
							{#if revealedAt(mdPos, i, step)}
								<span class="content">{tok}</span>
							{:else}
								<span class="mask-pill">[MASK]</span>
							{/if}
						</span>
					{/each}
				</p>
			{/each}
		</div>
	</div>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: row;
		justify-content: center;
		align-items: flex-start;
		gap: 2rem;
		width: 100%;
		margin: 0 auto;
		flex-wrap: wrap;
	}

	@media (max-width: 700px) {
		.wrap {
			row-gap: 1.25rem;
		}
	}

	.block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
	}

	.label {
		font-size: 1.15rem;
		font-weight: 600;
		color: #666;
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		align-items: flex-start;
	}

	.line {
		font-size: 1.05rem;
		line-height: 1.6;
		color: #333;
		margin: 0;
		text-align: left;
		white-space: nowrap;
		display: flex;
		gap: 4px;
	}

	/* Fixed-width slot: every column is the same width regardless of what
	 * token or [MASK] pill sits inside it, so rows stay aligned. */
	.slot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 60px;
		height: 1.6em;
		flex: 0 0 60px;
	}

	.slot > .content {
		color: #333;
	}

	/* Dashed underline placeholder for autoregressive pending slots: keeps
	 * the row rhythm without introducing a [MASK] visual on the AR side. */
	.ar-placeholder {
		display: inline-block;
		width: 70%;
		border-bottom: 1px dashed #c8c8c8;
	}

	.mask-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.35em 0.4em;
		background: var(--mask-color, #cfe0f2);
		color: var(--mask-text-color, #33506e);
		border-radius: 4px;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1;
	}
</style>
