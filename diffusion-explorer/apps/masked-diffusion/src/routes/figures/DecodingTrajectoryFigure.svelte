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

	// Short line, exactly 8 word tokens (punctuation is folded into whitespace
	// so the two columns read cleanly and align row-by-row).
	const DEFAULT_LINE = 'The little cat sat on the warm mat';

	interface Props {
		isActive?: Writable<boolean>;
		text?: string;
		seed?: number;
		/** Background color of the pending-token rectangle. */
		maskColor?: string;
	}

	let {
		isActive,
		text = DEFAULT_LINE,
		seed = 3,
		maskColor = '#c4c8ce'
	}: Props = $props();

	const tokenized = $derived(tokenize(text));
	const tokens = $derived(tokenized.tokens);
	const leading = $derived(tokenized.leading);
	const trailing = $derived(tokenized.trailing);
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

<div class="wrap" style="--mask-color: {maskColor}">
	<div class="block">
		<div class="label">Autoregressive</div>
		<div class="stack">
			{#each Array(nRows) as _, step (step)}
				{@const rev = revealedAt}
				<p class="line" style="opacity: {rowOpacity(step)}">
					{#each tokens as tok, i (i)}
						<span class="pre">{leading[i]}</span><span class="slot" aria-label={tok}>
							<span
								class="content"
								style="opacity: {rev(arPos, i, step) ? 1 : 0}">{tok}</span
							><span
								class="placeholder ar"
								style="opacity: {rev(arPos, i, step) ? 0 : 1}">&nbsp;</span
							>
						</span><span class="post">{trailing[i]}</span>
					{/each}
				</p>
			{/each}
		</div>
	</div>

	<div class="block">
		<div class="label">Masked Diffusion</div>
		<div class="stack">
			{#each Array(nRows) as _, step (step)}
				{@const rev = revealedAt}
				<p class="line" style="opacity: {rowOpacity(step)}">
					{#each tokens as tok, i (i)}
						<span class="pre">{leading[i]}</span><span class="slot" aria-label={tok}>
							<span
								class="content"
								style="opacity: {rev(mdPos, i, step) ? 1 : 0}">{tok}</span
							><span
								class="placeholder mask"
								style="opacity: {rev(mdPos, i, step) ? 0 : 1}">&nbsp;</span
							>
						</span><span class="post">{trailing[i]}</span>
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
		gap: 4rem;
		width: 100%;
		margin: 0 auto;
		flex-wrap: wrap;
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
	}

	.pre,
	.post {
		white-space: pre;
	}

	.slot {
		display: inline-grid;
		grid-template-columns: 1fr;
		grid-template-rows: 1fr;
		vertical-align: middle;
		line-height: inherit;
		align-items: center;
		justify-items: center;
		margin: 0 2px;
	}

	.slot > .content,
	.slot > .placeholder {
		grid-row: 1;
		grid-column: 1;
		white-space: nowrap;
	}

	.slot > .content {
		color: #333;
	}

	.slot > .placeholder {
		width: 100%;
		color: transparent;
	}

	.placeholder.ar {
		/* No [MASK] for autoregressive — a subtle dashed underline hints at
		 * where the next token will land, so the row keeps its line rhythm. */
		border-bottom: 1px dashed #c8c8c8;
	}

	.placeholder.mask {
		height: 1em;
		background: var(--mask-color, #c4c8ce);
		border-radius: 3px;
	}
</style>
