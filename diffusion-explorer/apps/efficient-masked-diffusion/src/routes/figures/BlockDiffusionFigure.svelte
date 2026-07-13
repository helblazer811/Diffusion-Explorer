<script lang="ts">
	// Block-diffusion (a.k.a. block-autoregressive) generation on a paragraph.
	//
	// Tokens are split into fixed-size blocks. Within a block, tokens are
	// generated in a random order (masked-diffusion style — each pending slot
	// shows a gray rectangle sized to the eventual token). Blocks are
	// completed left-to-right (autoregressive at the block level): block k+1's
	// first token only starts revealing after block k is fully revealed.
	//
	// Same shape/style as GenerationComparisonFigure: one shared tempus Player
	// drives a global reveal fraction, and each slot's opacity is computed from
	// how far its own step in the schedule has been passed. The mask token is
	// rendered as a gray rectangle whose width matches its eventual word so
	// word spacing is preserved as tokens flip.

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
	}

	let {
		isActive,
		text = TINY_STORY,
		seed = 7,
		blockSize = 6,
		maskColor = '#c4c8ce'
	}: Props = $props();

	const tokenized = $derived(tokenize(text));
	const tokens = $derived(tokenized.tokens);
	const leading = $derived(tokenized.leading);
	const trailing = $derived(tokenized.trailing);
	const N = $derived(tokens.length);

	// Block index each token belongs to; all tokens in block b share the same
	// reveal step (they flash in together). Blocks are completed strictly
	// left-to-right — block b+1 starts only after block b is fully revealed.
	const nBlocks = $derived(Math.ceil(N / blockSize));
	const blockOf = $derived.by(() => {
		const b = new Array<number>(N);
		for (let i = 0; i < N; i++) b[i] = Math.floor(i / blockSize);
		return b;
	});

	// `seed` is unused here for the reveal schedule (blocks reveal together),
	// but we keep it so the prop signature matches the other figures.
	void seed;

	const REVEAL_MS = 5500;
	const HOLD_MS = 1200;

	interface State {
		progress: number;
	}

	let progress = $state(0);
	// Fractional block count: [0, nBlocks] over the reveal clip.
	const blocksRevealed = $derived(progress * nBlocks);
	// Fade window in *block* units — narrower than the AR/MDM per-token fade so
	// each block flashes in relatively cleanly, with a visible pause before the
	// next block starts.
	const BLOCK_FADE_WIDTH = 0.25;

	function opacityFor(i: number): number {
		// Every token in block b treats step b as its flip instant.
		const stepIndex = blockOf[i];
		const d = blocksRevealed - stepIndex - 0.5;
		if (d >= BLOCK_FADE_WIDTH) return 1;
		if (d <= -BLOCK_FADE_WIDTH) return 0;
		const u = (d + BLOCK_FADE_WIDTH) / (2 * BLOCK_FADE_WIDTH);
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

<div class="wrap" style="--mask-color: {maskColor}">
	<div class="row">
		<div class="label">Block Diffusion (Block-Autoregressive)</div>
		<p class="paragraph">
			{#each tokens as tok, i (i)}
				<span class="pre">{leading[i]}</span><span class="slot" aria-label={tok}>
					<span class="content" style="opacity: {opacityFor(i)}">{tok}</span
					><span class="placeholder mask" style="opacity: {1 - opacityFor(i)}"
						>&nbsp;</span
					>
				</span><span class="post">{trailing[i]}</span>
			{/each}
		</p>
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
		gap: 0.5rem;
		width: 100%;
	}

	.label {
		font-size: 1.15rem;
		font-weight: 600;
		color: #666;
	}

	.paragraph {
		font-size: 1.05rem;
		line-height: 1.9;
		color: #333;
		margin: 0;
		text-align: left;
		max-width: 720px;
	}

	.pre,
	.post {
		white-space: pre-wrap;
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

	.placeholder.mask {
		width: 100%;
		height: 1em;
		background: var(--mask-color, #c4c8ce);
		border-radius: 3px;
		color: transparent;
	}
</style>
