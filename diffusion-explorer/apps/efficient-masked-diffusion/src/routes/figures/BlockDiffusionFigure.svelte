<script lang="ts">
	// Block-diffusion (a.k.a. block-autoregressive) generation on a paragraph.
	// Structurally a copy of the block-diffusion bottom row of
	// GenerationComparisonFigure, minus the AR row and the clock icon:
	//
	//   - Tokens are split into fixed-size blocks (default 6). Blocks complete
	//     strictly left-to-right (block b+1 begins only after block b is fully
	//     revealed).
	//   - Within a block, tokens un-mask in a random order according to their
	//     per-token flip time (drawn from a deterministic cosine-schedule).
	//   - The animation runs a slow-pause-fast row-time warp so the opening
	//     reads as "the model decodes one whole block per step" before the
	//     finale zips through the rest.
	//   - A light-orange highlight pill sits behind the block currently being
	//     decoded; a brief blink pulses on the block the instant it first
	//     reveals during the slow phase.
	//
	// The tokens are laid out on a 12-column grid: each block spans blockSize
	// columns via a subgrid so token positions line up cleanly.

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import { TINY_STORY, tokenize } from './masked_diffusion_math';

	interface Props {
		isActive?: Writable<boolean>;
		text?: string;
		seed?: number;
		/** Tokens per block. */
		blockSize?: number;
		/** Background color of the pending-token rectangle. */
		maskColor?: string;
		/** Paragraph font size (any CSS length). */
		fontSize?: string;
	}

	let {
		isActive,
		text = TINY_STORY,
		seed = 7,
		blockSize = 6,
		maskColor = '#cfe0f2',
		fontSize = '1.05rem'
	}: Props = $props();

	// Tokenization. Every token in a block reveals simultaneously — one
	// decoding step commits an entire block in one go — so we don't need
	// per-token flip times here. `seed` is kept in the prop signature for
	// call-site parity with the other figures.
	const tokenized = $derived(tokenize(text));
	const tokens = $derived(tokenized.tokens);
	const N = $derived(tokens.length);
	void seed;

	// Block partition. Every token's block index; a nested grouping for the
	// template so we can wrap each block in its own <div class="block"> to
	// carry the highlight pill.
	const nBlocks = $derived(Math.ceil(N / blockSize));
	const blockOf = $derived.by(() => {
		const b = new Array<number>(N);
		for (let i = 0; i < N; i++) b[i] = Math.floor(i / blockSize);
		return b;
	});
	const blockGroups = $derived.by(() => {
		const groups: number[][] = Array.from({ length: nBlocks }, () => []);
		for (let i = 0; i < N; i++) groups[blockOf[i]].push(i);
		return groups;
	});

	// Three-clip timeline: an up-front hold on the fully-masked state so the
	// reader has a beat to notice the [MASK] grid, then a single-cadence
	// reveal (no slow-pause-fast warp — every block decodes at the same
	// per-step rate), then a trailing hold on the finished paragraph before
	// the loop restarts. Reveal duration scales with the block count so the
	// per-block cadence stays readable regardless of paragraph length.
	const PRE_HOLD_MS = 1500;
	const MS_PER_BLOCK = 850;
	const HOLD_MS = 3000;
	const REVEAL_MS = $derived(nBlocks * MS_PER_BLOCK);

	interface State {
		progress: number;
	}

	let progress = $state(0);
	// Single-cadence row-time: linear pass-through, no warp. `progress` is
	// already the fraction of the reveal clip that has elapsed, so it maps
	// 1-to-1 onto the block schedule.
	const rowTime = $derived(progress);

	// Within-block reveal offset — the highlight lands on a block at slot
	// start, and its tokens pop in shortly after so there's a moment of
	// anticipation before the block flips.
	const REVEAL_OFFSET = 0.2;

	// Signed distance from block b's flip instant, in row-time units. Every
	// token in block b shares the same instant `(b + REVEAL_OFFSET) / nBlocks`
	// so the whole block reveals simultaneously — one decoding step per
	// block, exactly what block diffusion does at inference time.
	function bdDist(i: number): number {
		const b = blockOf[i];
		return rowTime - (b + REVEAL_OFFSET) / nBlocks;
	}

	function bdOpacity(i: number): number {
		return bdDist(i) >= 0 ? 1 : 0;
	}

	// Currently-decoding block used to paint the highlight pill; -1 once the
	// row is fully done so the highlight doesn't linger through the hold.
	const DONE_EPS = 1e-4;
	const targetBlock = $derived(
		rowTime >= 1 - DONE_EPS ? -1 : Math.min(nBlocks - 1, Math.floor(rowTime * nBlocks))
	);

	// "Just decoded" window — briefly flash the block the instant it first
	// reveals. With a single steady cadence every block gets the same flash;
	// no phase gate needed.
	const FLASH_STEPS = 0.6;
	const justDecoded = $derived.by(() => {
		if (targetBlock < 0) return -1;
		const revealedFrac = rowTime * nBlocks - targetBlock - REVEAL_OFFSET;
		return revealedFrac >= 0 && revealedFrac < FLASH_STEPS ? targetBlock : -1;
	});

	let player: Player<State> | undefined;

	function buildTimeline() {
		// Pre-hold: keep the fully-masked state visible for a beat before
		// decoding starts, so the reader has time to notice the [MASK] grid.
		const preHoldClip = {
			name: 'pre-hold',
			reduce(_t: number): Partial<State> {
				return { progress: 0 };
			}
		};
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
			.add(preHoldClip, { durationMs: PRE_HOLD_MS })
			.add(revealClip, { durationMs: REVEAL_MS })
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

<div
	class="wrap"
	style="--mask-color: {maskColor}; --paragraph-font-size: {fontSize}; --block-span: {blockSize};"
>
	<div class="row">
		<div class="row-header">
			<div class="label">
				<strong>Block Diffusion</strong> &mdash; One Block per Step
			</div>
		</div>
		<div class="paragraph">
			{#each blockGroups as blockIndices, b (b)}
				<div
					class="block"
					class:highlight={b === targetBlock}
					class:just-decoded={b === justDecoded}
				>
					{#each blockIndices as i (i)}
						<div class="slot" aria-label={tokens[i]}>
							<span class="content" style="opacity: {bdOpacity(i)}">{tokens[i]}</span
							><span class="placeholder mask" style="opacity: {1 - bdOpacity(i)}"
								>[MASK]</span
							>
						</div>
					{/each}
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.6rem;
		width: 100%;
		margin: 0 auto;
	}

	.row {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		width: 100%;
		min-width: 0;
	}

	.row-header {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;
		width: 100%;
	}

	.label {
		font-size: 1.3rem;
		font-weight: 400;
		color: #666;
	}
	.label strong {
		font-weight: 600;
	}

	/* Token grid: 12 constant-width cells per row. Each block spans blockSize
	   cells via a subgrid so token positions line up cleanly. --block-span is
	   set on .wrap and inherited to .block's grid-column. */
	.paragraph {
		font-size: var(--paragraph-font-size, 1.05rem);
		line-height: 1.4;
		color: #333;
		margin: 0;
		width: 100%;
		display: grid;
		grid-template-columns: repeat(12, 1fr);
		gap: 0.5rem 4px;
	}

	.block {
		grid-column: span var(--block-span, 6);
		display: grid;
		grid-template-columns: subgrid;
		border-radius: 6px;
		padding: 0.15em 0;
	}
	.block.highlight {
		background: #fde0c8;
	}
	.block.just-decoded {
		animation: reveal-blink 200ms ease-in-out 2;
	}
	@keyframes reveal-blink {
		0%,
		100% {
			background: #fde0c8;
		}
		50% {
			background: #f7a869;
		}
	}

	.slot {
		display: grid;
		grid-template-columns: 1fr;
		grid-template-rows: 1fr;
		align-items: center;
		justify-items: center;
		min-width: 0;
		min-height: 1.4em;
	}

	.slot > .content,
	.slot > .placeholder {
		grid-row: 1;
		grid-column: 1;
		white-space: nowrap;
	}

	.placeholder.mask {
		background: var(--mask-color, #cfe0f2);
		color: #33506e;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
		font-size: 0.7em;
		font-weight: 500;
		padding: 0.15em 0.15em;
		border-radius: 3px;
		white-space: nowrap;
		line-height: 1.25;
		max-width: 100%;
		box-sizing: border-box;
	}
</style>
