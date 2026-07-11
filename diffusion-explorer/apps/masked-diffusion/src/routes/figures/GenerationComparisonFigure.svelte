<script lang="ts">
	// Side-by-side comparison of two generation processes on the same paragraph,
	// stacked vertically and driven by a single shared clock:
	//
	//   Row 1  Autoregressive — tokens generated strictly left-to-right, one at
	//          a time. Before a token is generated its slot is empty (a subtle
	//          placeholder underline so the reader can see where it will land);
	//          there is no [MASK] sentinel — AR does not represent unfinished
	//          tokens at all.
	//   Row 2  Masked Diffusion — tokens generated in a fixed random order.
	//          Before a token is generated its slot shows the [MASK] sentinel.
	//
	// A single tempus Player drives a global `revealedCount ∈ [0, N]` and both
	// rows read from it: AR reveals index `i` iff `i < revealedCount`, and the
	// mask-diffusion row reveals index `i` iff `posInSchedule[i] < revealedCount`.
	// The two rows finish together after the same number of steps, so the point
	// of the figure is *which cells fill in when*, not which finishes first.

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import { TINY_STORY, tokenize } from './masked_diffusion_math';
	import {
		drawFlipUniforms,
		cosineSchedule,
		flipInstant
	} from './masked_diffusion_math';

	interface Props {
		isActive?: Writable<boolean>;
		text?: string;
		seed?: number;
		/** Background color of the pending-token rectangle. */
		maskColor?: string;
		/** Paragraph font size (any CSS length). */
		fontSize?: string;
		/** Toggle the smooth word↔mask opacity cross-fade at each flip instant. */
		crossFade?: boolean;
		/** Toggle the scale-pulse on each mask cell around its flip instant. */
		scalePulse?: boolean;
	}

	let {
		isActive,
		text = TINY_STORY,
		seed = 7,
		maskColor = '#c4c8ce',
		fontSize = '1.05rem',
		crossFade = true,
		scalePulse = false
	}: Props = $props();

	// Tokenization + independent per-token flip times drawn from a cosine
	// schedule (matches the animation used in ForwardReverseFigure). Multiple
	// tokens can un-mask in the same instant when their flip times cluster.
	const tokenized = $derived(tokenize(text));
	const tokens = $derived(tokenized.tokens);
	const leading = $derived(tokenized.leading);
	const trailing = $derived(tokenized.trailing);
	const N = $derived(tokens.length);
	const uniforms = $derived(drawFlipUniforms(N, seed));
	const flipTimes = $derived(uniforms.map((u) => flipInstant(u, cosineSchedule)));

	// One reveal clip + a brief hold at the end so the reader can read the
	// finished paragraph before the loop restarts. Progress rises 0 → 1 and
	// each token un-masks when it crosses its flip instant.
	const REVEAL_MS = 10000;
	const HOLD_MS = 2400;

	interface State {
		progress: number;
	}

	let progress = $state(0);

	// Cross-fade half-width and scale-pulse peak — same values as
	// ForwardReverseFigure so the two figures share the same feel.
	const FADE_WIDTH_T = 0.09;
	const AR_FADE_WIDTH = 0.45;

	// Autoregressive: strict left-to-right, so the AR row keeps its
	// step-count reveal (index i unmasks at progress = i / N).
	function arOpacity(i: number): number {
		const revealedCount = progress * N;
		const d = revealedCount - i - 0.5;
		if (d >= AR_FADE_WIDTH) return 1;
		if (d <= -AR_FADE_WIDTH) return 0;
		const u = (d + AR_FADE_WIDTH) / (2 * AR_FADE_WIDTH);
		return u * u * (3 - 2 * u);
	}

	// Masked diffusion: each token has its own flip time t_i drawn from the
	// cosine schedule inverse-CDF. In generation the reveal is unmask-only:
	// as `progress` sweeps 0 → 1, token i unmasks when progress passes
	// (1 - flipTimes[i]). Multiple tokens can flip in the same window.
	const SCALE_PEAK = 0.12;

	function mdDist(i: number): number {
		// Signed distance in time from token i's flip instant.
		// d ≥ 0 → past the flip (revealed); d < 0 → not yet flipped (masked).
		return progress - (1 - flipTimes[i]);
	}

	function mdOpacity(i: number): number {
		const d = mdDist(i);
		if (!crossFade) return d >= 0 ? 1 : 0; // hard step at the flip instant
		if (d >= FADE_WIDTH_T) return 1;
		if (d <= -FADE_WIDTH_T) return 0;
		const u = (d + FADE_WIDTH_T) / (2 * FADE_WIDTH_T);
		return u * u * (3 - 2 * u);
	}

	// Scale pulse on the mask cell across the fade window: peaks at d=0 and
	// decays smoothly to 1.0 outside. Disabled when `scalePulse={false}`.
	function mdScale(i: number): number {
		if (!scalePulse) return 1;
		const d = mdDist(i);
		if (Math.abs(d) >= FADE_WIDTH_T) return 1;
		const u = d / FADE_WIDTH_T;
		const bell = 1 - u * u;
		return 1 + SCALE_PEAK * bell;
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

<div class="wrap" style="--mask-color: {maskColor}; --paragraph-font-size: {fontSize};">
	<div class="row">
		<div class="label">Autoregressive</div>
		<p class="paragraph">
			{#each tokens as tok, i (i)}
				<span class="pre">{leading[i]}</span><span class="slot" aria-label={tok}>
					<span class="content" style="opacity: {arOpacity(i)}">{tok}</span
					><span class="placeholder ar" style="opacity: {1 - arOpacity(i)}"
						>&nbsp;</span
					>
				</span><span class="post">{trailing[i]}</span>
			{/each}
		</p>
	</div>

	<div class="row">
		<div class="label">Masked Diffusion</div>
		<p class="paragraph">
			{#each tokens as tok, i (i)}
				<span class="pre">{leading[i]}</span><span class="slot" aria-label={tok}>
					<span class="content" style="opacity: {mdOpacity(i)}">{tok}</span
					><span
						class="placeholder mask"
						style="opacity: {1 - mdOpacity(i)}; transform: scale({mdScale(i)});"
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
		flex-direction: row;
		align-items: flex-start;
		gap: 1.6rem;
		width: 100%;
		margin: 0 auto;
	}

	.row {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		flex: 1 1 0;
		min-width: 0;
	}

	@media (max-width: 640px) {
		.wrap {
			flex-direction: column;
			align-items: center;
		}

		.row {
			width: 100%;
		}
	}

	.label {
		font-size: 1.15rem;
		font-weight: 600;
		color: #666;
	}

	.paragraph {
		font-size: var(--paragraph-font-size, 1.05rem);
		line-height: 1.9;
		color: #333;
		margin: 0;
		text-align: left;
		width: 100%;
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

	.placeholder.ar {
		/* No [MASK] for autoregressive — a subtle grey underline to hint at
		 * where the next token will land, so the row keeps its line rhythm. */
		border-bottom: 1px dashed #c8c8c8;
	}

	.placeholder.mask {
		/* A gray rectangle sized to the token's own width (the slot's width is
		 * max(word, placeholder), and the grid child stretches to that width) —
		 * so word spacing is preserved as tokens flip. Height is capped at 1em
		 * and vertically centered on the baseline via the slot's align-items. */
		width: 100%;
		height: 1em;
		background: var(--mask-color, #c4c8ce);
		border-radius: 3px;
		color: transparent;
	}
</style>
