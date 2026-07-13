<script lang="ts">
	// Representation ripple figure for MDLM.
	//
	// Two stacked forward passes of the same masked transformer:
	//
	//   PASS 1 (top): "The [MASK] cat sat on [MASK] warm mat"
	//     — the model sees two masked positions.
	//   PASS 2 (bottom): "The little cat sat on [MASK] warm mat"
	//     — position 1 has been unmasked to 'little' and fed back in.
	//
	// Each pass shows: tokens (top) → "Masked Transformer" block → a row of
	// small colored squares (the hidden representation at each position).
	// A section label sits above each panel and states what's happening.
	//
	// The teaching point: the colored squares in pass 2 differ from pass 1
	// at every position — including the position that stayed [MASK] — because
	// bidirectional attention makes every hidden state a function of the
	// whole current context. Committing one token literally changes the
	// representation of every other token.
	//
	// Animation is just a fade-in of each panel in sequence, holding on the
	// final state before looping. No explicit "commit" beat between them.

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';

	interface Props {
		isActive?: Writable<boolean>;
		maskColor?: string;
		maskTextColor?: string;
		width?: number;
		fontSize?: number;
	}

	let { isActive, maskColor = '#cfe0f2', maskTextColor = '#33506e', width = 780, fontSize = 16 }: Props = $props();

	const maskLabelSize = fontSize * (12 / 16);
	const txLabelSize = fontSize * (18 / 16);
	const sectionLabelSize = fontSize * (14 / 16);

	// --- Palette (matches ModelPredictionFigure / KVCacheFigure) ---
	const TEXT_COLOR = '#333';
	const MUTED = '#888';
	const ACCENT = '#f17720';
	const TX_FILL = '#f4f6fa';
	const TX_STROKE = '#c8ccd1';

	// --- Content ---
	// Pass 1: two [MASK]s at positions 1 and 5.
	// Pass 2: position 1 committed to 'little'; position 5 still [MASK].
	const pass1Tokens: (string | null)[] = [
		'The', null, 'cat', 'sat', 'on', null, 'warm', 'mat'
	];
	const pass2Tokens: (string | null)[] = [
		'The', 'little', 'cat', 'sat', 'on', null, 'warm', 'mat'
	];
	const commitIndex = 1; // position that changed between the two passes
	const N_TOKENS = pass1Tokens.length;

	// --- Representation colors ---
	// One hand-tuned color per (pass, position). The pedagogical claim is
	// that EVERY square changes between pass 1 and pass 2 — including the
	// still-masked slot at position 5. The palette is a soft continuous
	// hue set so the shifts read as "the state moved" without any single
	// color implying a specific semantic.
	const pass1Colors: string[] = [
		'#8fb3d6', // The
		'#cfe0f2', // [MASK] — mask-blue tint to signal 'no committed content'
		'#c9a3d1', // cat
		'#e0b689', // sat
		'#a8c99a', // on
		'#cfe0f2', // [MASK]
		'#d99e9e', // warm
		'#b7c8c1'  // mat
	];
	const pass2Colors: string[] = [
		'#a0c7e3', // The       — shifted lighter/warmer
		'#e8a86d', // little    — sharp orange-ish: newly committed content
		'#b58cc4', // cat       — hue rotated
		'#d0a271', // sat       — softened
		'#8fbf8a', // on        — deepened green
		'#b6cde2', // [MASK]    — still masky but different from pass 1's mask blue
		'#c78888', // warm      — deepened
		'#98b8ae'  // mat       — cooled
	];

	// --- Geometry ---
	// Each pass panel is a self-contained top-to-bottom stack:
	//   section label → tokens → transformer block → representation squares
	// The two panels sit vertically, sharing this width.
	const W = width;

	// Per-panel vertical layout
	const LABEL_H = 34;         // section-label row
	const LABEL_TO_TOKENS = 8;  // gap
	const TOKEN_Y = 30;         // token baseline within a panel (relative)
	const TOKEN_TO_TX = 60;     // gap from token baseline to transformer top
	const TX_H = 44;
	const TX_TO_REPR = 30;      // gap from transformer bottom to repr row top
	const REPR_H = 40;          // representation square row height
	const PANEL_BOTTOM_PAD = 8;

	// Total panel height (label + all rows + gaps)
	const PANEL_INNER_H =
		LABEL_H + LABEL_TO_TOKENS + TOKEN_Y + TOKEN_TO_TX + TX_H + TX_TO_REPR + REPR_H + PANEL_BOTTOM_PAD;
	const PANEL_GAP = 24;
	const H = 2 * PANEL_INNER_H + PANEL_GAP;

	// Token row geometry — same slot width as sibling transformer figures.
	const SLOT_W = 78;
	const SLOT_H = 30;
	const seqTotalW = N_TOKENS * SLOT_W;
	const seqX0 = (W - seqTotalW) / 2;
	function slotX(i: number): number {
		return seqX0 + i * SLOT_W + SLOT_W / 2;
	}

	// Transformer block horizontal extent
	const TX_X = seqX0 + 4;
	const TX_W = seqTotalW - 8;

	// Representation squares
	const REPR_SIZE = 30;
	function reprX(i: number): number {
		return slotX(i) - REPR_SIZE / 2;
	}

	// Y anchors for a panel whose top edge is at `panelTop`:
	//   labelY:  center of the section-label text
	//   tokY:    center of the token text (matches SEQ_Y_TOP semantics in siblings)
	//   txY:     top of the transformer rounded rect
	//   reprY:   top of the representation square row
	function panelAnchors(panelTop: number) {
		const labelY = panelTop + LABEL_H / 2;
		const tokY = panelTop + LABEL_H + LABEL_TO_TOKENS + TOKEN_Y;
		const txY = tokY + TOKEN_TO_TX;
		const reprY = txY + TX_H + TX_TO_REPR;
		return { labelY, tokY, txY, reprY };
	}

	const PASS1_TOP = 0;
	const PASS2_TOP = PANEL_INNER_H + PANEL_GAP;
	const P1 = panelAnchors(PASS1_TOP);
	const P2 = panelAnchors(PASS2_TOP);

	// --- Timeline ---
	// Two animated phases: pass 1 fades in, holds, then pass 2 fades in and
	// holds long before looping. u ∈ [0, 4] across four legs so each fade
	// and hold is its own reduce.
	const P_FADE = 900;
	const P_HOLD = 1400;
	const END_HOLD = 5500;

	interface State {
		u: number;
	}
	let u = $state(0);
	let player = $state<Player<State> | undefined>(undefined);

	function smoothstep(x: number): number {
		const c = Math.max(0, Math.min(1, x));
		return c * c * (3 - 2 * c);
	}

	// u progression:
	//   0 → 1: pass 1 fade-in
	//   1 → 2: pass 1 hold (both panels visible: only pass 1 alone)
	//   2 → 3: pass 2 fade-in
	//   3 → 4: final hold (both visible)
	const p1Fade = $derived(smoothstep(Math.max(0, Math.min(1, u - 0))));
	const p2Fade = $derived(smoothstep(Math.max(0, Math.min(1, u - 2))));

	// u progression over the loop:
	//   0 → 1 during pass1-fade
	//   held at 1 during pass1-hold
	//   1 → 3 during pass2-fade (p2Fade only starts responding at u > 2, so
	//     the first half of this leg holds pass 1's state and the second
	//     half fades pass 2 in)
	//   held at 3 during final-hold
	function buildTimeline() {
		const b = new TimelineBuilder<State>().setInitialState({ u: 0 });
		b.add(
			{ name: 'pass1-fade', reduce: (t: number) => ({ u: t }) },
			{ durationMs: P_FADE }
		);
		b.add(
			{ name: 'pass1-hold', reduce: (_t: number) => ({ u: 1 }) },
			{ durationMs: P_HOLD }
		);
		b.add(
			{ name: 'pass2-fade', reduce: (t: number) => ({ u: 1 + t * 2 }) },
			{ durationMs: 2 * P_FADE }
		);
		b.add(
			{ name: 'final-hold', reduce: (_t: number) => ({ u: 3 }) },
			{ durationMs: END_HOLD }
		);
		return b.build();
	}

	onMount(() => {
		player = new Player<State>(buildTimeline(), {
			looping: true,
			endPause: 0.05
		});
		player.onTick((_t, s) => {
			u = s.u;
		});
		const unsubActive = isActive?.subscribe((v) => {
			if (!player) return;
			if (v) player.play();
			else {
				player.pause();
				player.reset();
				u = 0;
			}
		});
		return () => {
			unsubActive?.();
			player?.dispose();
		};
	});
</script>

{#snippet transformerBlock(txY: number)}
	<rect
		x={TX_X}
		y={txY}
		width={TX_W}
		height={TX_H}
		rx={14}
		ry={14}
		fill={TX_FILL}
		stroke={TX_STROKE}
		stroke-width="1.5"
	/>
	<text
		x={W / 2}
		y={txY + TX_H / 2}
		text-anchor="middle"
		dominant-baseline="central"
		font-size={txLabelSize}
		font-weight="600"
		fill="#7a7f86"
	>
		Masked Transformer
	</text>
{/snippet}

{#snippet tokenRow(tokens: (string | null)[], tokY: number, highlightIdx: number | null)}
	{#each tokens as tok, i}
		{#if tok === null}
			<rect
				x={slotX(i) - SLOT_W / 2 + 8}
				y={tokY - SLOT_H / 2}
				width={SLOT_W - 16}
				height={SLOT_H}
				rx={5}
				ry={5}
				fill={maskColor}
			/>
			<text
				x={slotX(i)}
				y={tokY}
				text-anchor="middle"
				dominant-baseline="central"
				font-size={maskLabelSize}
				font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"
				fill={maskTextColor}
			>
				[MASK]
			</text>
		{:else}
			<text
				x={slotX(i)}
				y={tokY}
				text-anchor="middle"
				dominant-baseline="central"
				font-size={fontSize}
				font-weight={i === highlightIdx ? '600' : '400'}
				fill={i === highlightIdx ? ACCENT : TEXT_COLOR}
			>
				{tok}
			</text>
		{/if}
	{/each}
{/snippet}

{#snippet reprRow(colors: string[], reprY: number)}
	{#each colors as c, i}
		<rect
			x={reprX(i)}
			y={reprY}
			width={REPR_SIZE}
			height={REPR_SIZE}
			rx={5}
			ry={5}
			fill={c}
			stroke={TX_STROKE}
			stroke-width="1"
		/>
	{/each}
{/snippet}

<div class="wrap" style="--mask-color: {maskColor}">
	<svg
		viewBox={`0 0 ${W} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Two stacked forward passes of a masked transformer. The top pass shows a sentence with two masked positions; the bottom pass shows the same sentence with the first masked position committed to a word. In each pass, a row of colored squares beneath the transformer represents the hidden state at each token position. The squares differ across the two passes — at every position — illustrating that committing one token changes the representation of every other token."
	>
		<!-- ============ PASS 1 (top) ============ -->
		<g opacity={p1Fade}>
			<text
				x={W / 2}
				y={P1.labelY}
				text-anchor="middle"
				dominant-baseline="central"
				font-size={sectionLabelSize}
				font-weight="600"
				fill={TEXT_COLOR}
			>
				Forward pass 1 — two positions are masked; the transformer produces a hidden state for each token.
			</text>

			{@render tokenRow(pass1Tokens, P1.tokY, null)}
			{@render transformerBlock(P1.txY)}
			{@render reprRow(pass1Colors, P1.reprY)}
		</g>

		<!-- ============ PASS 2 (bottom) ============ -->
		<g opacity={p2Fade}>
			<text
				x={W / 2}
				y={P2.labelY}
				text-anchor="middle"
				dominant-baseline="central"
				font-size={sectionLabelSize}
				font-weight="600"
				fill={TEXT_COLOR}
			>
				Forward pass 2 — one mask has been committed to <tspan fill={ACCENT} font-weight="700">little</tspan>; every hidden state changes.
			</text>

			{@render tokenRow(pass2Tokens, P2.tokY, commitIndex)}
			{@render transformerBlock(P2.txY)}
			{@render reprRow(pass2Colors, P2.reprY)}
		</g>
	</svg>
</div>

<style>
	.wrap {
		width: 100%;
		max-width: 780px;
		margin: 0 auto;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
</style>
