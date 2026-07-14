<script lang="ts">
	// Sequential-recovery companion to OrderMattersFigure.
	//
	// Two stacked forward passes of the same masked transformer, showing
	// that committing tokens one at a time recovers the joint. Same
	// sentence as OrderMattersFigure: "The dog is [MASK] so he wants to
	// [MASK]", same tired/hungry × sleep/eat marginals.
	//
	//   Pass 1 (top): both masks present. Both panels show ~50/50
	//                 marginals. The first mask (position 3) is committed
	//                 to `tired` — its argmax on the top-2 marginal.
	//   Middle: "commit position 3 → tired" callout with a downward
	//           arrow, indicating the transition into pass 2.
	//   Pass 2 (bottom): position 3 is now the visible token `tired`;
	//                    only position 8 is masked. Its marginal is now
	//                    concentrated on `sleep` (0.94), because the
	//                    model can condition on the committed `tired`.
	//                    Argmax picks `sleep`; the decoded row reads the
	//                    coherent sentence.
	//
	// The teaching point: rolling out sequentially recovers the joint
	// that the parallel (factorized) sampler broke in OrderMattersFigure.

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import { PlayPauseResetButton } from '@diffusion-explorer/ui';

	interface Props {
		isActive?: Writable<boolean>;
		maskColor?: string;
		maskTextColor?: string;
		width?: number;
		fontSize?: number;
	}

	let {
		isActive,
		maskColor = '#cfe0f2',
		maskTextColor = '#33506e',
		width = 1000,
		fontSize = 18
	}: Props = $props();

	const maskLabelSize = fontSize * (12 / 16);
	const txLabelSize = fontSize * (16 / 16);
	const panelHeaderSize = fontSize * (13 / 16);
	const barWordSize = fontSize * (13 / 16);
	const probNumSize = fontSize * (12 / 16);
	const commitLabelSize = fontSize * (14 / 16);
	const successLabelSize = fontSize * (13 / 16);

	// --- Palette (matches OrderMattersFigure) ---
	const TEXT_COLOR = '#333';
	const MUTED = '#888';
	const ACCENT = '#f17720';
	const SUCCESS = '#2e8b57';
	const BAR_COLOR = '#99BCDC';
	const TX_FILL = '#f4f6fa';
	const TX_STROKE = '#c8ccd1';

	// --- Content: same sentence + marginals as OrderMattersFigure ---
	const inputTokens: (string | null)[] = [
		'The',
		'dog',
		'is',
		null,
		'so',
		'he',
		'wants',
		'to',
		null
	];
	const N = inputTokens.length;
	const maskedIndices = inputTokens
		.map((t, i) => (t === null ? i : -1))
		.filter((i) => i >= 0);
	// Pass-1 candidates: same top-2 marginals as OrderMattersFigure.
	const candidatesPass1: { word: string; p: number }[][] = [
		[
			{ word: 'tired', p: 0.53 },
			{ word: 'hungry', p: 0.47 }
		],
		[
			{ word: 'eat', p: 0.51 },
			{ word: 'sleep', p: 0.49 }
		]
	];
	// Pass 1 commits position 3 → "tired" (argmax).
	const pass1SampledIndex = 0;
	const pass1CommittedWord = candidatesPass1[0][pass1SampledIndex].word;

	// Pass-2 tokens: position 3 now shows the committed word; position 8
	// is still masked.
	const pass2Tokens: (string | null)[] = inputTokens.map((t, i) =>
		i === maskedIndices[0] ? pass1CommittedWord : t
	);
	// Pass-2 candidates: with `tired` committed, the model's marginal at
	// position 8 concentrates sharply on `sleep`. `eat` collapses to a
	// long-tail-ish sliver.
	const candidatesPass2: { word: string; p: number }[] = [
		{ word: 'sleep', p: 0.94 },
		{ word: 'eat', p: 0.06 }
	];
	const pass2SampledIndex = 0;
	const pass2CommittedWord = candidatesPass2[pass2SampledIndex].word;

	// Final decoded sentence.
	const finalDecoded: string[] = inputTokens.map((t, i) => {
		if (i === maskedIndices[0]) return pass1CommittedWord;
		if (i === maskedIndices[1]) return pass2CommittedWord;
		return t as string;
	});

	// --- Geometry ---
	const W = width;
	const SLOT_W = 78;
	const SLOT_H = 30;
	const seqTotalW = N * SLOT_W;
	const seqX0 = (W - seqTotalW) / 2;
	function slotX(i: number): number {
		return seqX0 + i * SLOT_W + SLOT_W / 2;
	}

	// Vertical layout: pass 1 block, commit callout, pass 2 block, final decoded row.
	const PASS1_TOP = 30;
	const PASS1_SEQ_Y = PASS1_TOP;
	const PASS1_TX_Y = PASS1_TOP + 55;
	const PASS1_TX_H = 40;
	const PASS1_BAR_Y = PASS1_TX_Y + PASS1_TX_H + 40;

	const BAR_ROW_H = 24;
	const BAR_LABEL_W = 66;
	const BAR_MAX_W = 190;
	const BAR_H = 16;
	const BAR_PROB_W = 40;
	const PANEL_W = BAR_LABEL_W + BAR_MAX_W + BAR_PROB_W + 16;
	function panelXAt(maskedIdx: number): number {
		return slotX(maskedIdx) - PANEL_W / 2;
	}

	const PASS1_PANEL_ROWS = candidatesPass1[0].length; // 2 (top-2 only)
	const PASS1_BAR_BOTTOM = PASS1_BAR_Y + PASS1_PANEL_ROWS * BAR_ROW_H;

	const COMMIT_LABEL_Y = PASS1_BAR_BOTTOM + 32;
	const COMMIT_ARROW_TOP = COMMIT_LABEL_Y + 12;
	const COMMIT_ARROW_BOTTOM = COMMIT_ARROW_TOP + 32;

	const PASS2_TOP = COMMIT_ARROW_BOTTOM + 20;
	const PASS2_SEQ_Y = PASS2_TOP;
	const PASS2_TX_Y = PASS2_TOP + 55;
	const PASS2_TX_H = 40;
	const PASS2_BAR_Y = PASS2_TX_Y + PASS2_TX_H + 40;
	const PASS2_PANEL_ROWS = candidatesPass2.length;
	const PASS2_BAR_BOTTOM = PASS2_BAR_Y + PASS2_PANEL_ROWS * BAR_ROW_H;

	const FINAL_SEQ_Y = PASS2_BAR_BOTTOM + 46;
	const SUCCESS_LABEL_Y = FINAL_SEQ_Y + 32;
	const H = SUCCESS_LABEL_Y + 20;

	const TX_X = seqX0 + 4;
	const TX_W = seqTotalW - 8;

	const MARKER_ACCENT = 'srf-arrow-accent';
	const MARKER_SUCCESS = 'srf-arrow-success';

	// --- Timeline ---
	// Five animated phases: pass 1 reveal, hold, commit callout, pass 2
	// reveal, final decoded reveal + hold. Simple fade-ins gated on `u`.
	const P_PASS1 = 1100;
	const P_HOLD_A = 700;
	const P_COMMIT = 800;
	const P_PASS2 = 1100;
	const P_HOLD_B = 700;
	const P_FINAL = 900;
	const END_HOLD = 4500;

	interface State {
		u: number;
	}
	let u = $state(0);
	let player = $state<Player<State> | undefined>(undefined);
	let isPlaying = $state(false);
	const normalizedTime = $derived(Math.min(1, u / 4));

	function smoothstep(x: number): number {
		const c = Math.max(0, Math.min(1, x));
		return c * c * (3 - 2 * c);
	}
	function clamp01(x: number): number {
		return Math.max(0, Math.min(1, x));
	}

	// u ∈ [0, 4]. Phase progresses:
	//   [0, 1): pass 1 fades in.
	//   [1, 2): commit callout appears.
	//   [2, 3): pass 2 fades in.
	//   [3, 4): final decoded row fades in and holds.
	const p1 = $derived(smoothstep(clamp01(u - 0)));
	const pCommit = $derived(smoothstep(clamp01(u - 1)));
	const p2 = $derived(smoothstep(clamp01(u - 2)));
	const pFinal = $derived(smoothstep(clamp01(u - 3)));

	function buildTimeline() {
		const b = new TimelineBuilder<State>().setInitialState({ u: 0 });
		b.add(
			{ name: 'pass1-in', reduce: (t: number) => ({ u: t }) },
			{ durationMs: P_PASS1 }
		);
		b.add({ name: 'hold-a', reduce: (_t: number) => ({ u: 1 }) }, { durationMs: P_HOLD_A });
		b.add(
			{ name: 'commit-in', reduce: (t: number) => ({ u: 1 + t }) },
			{ durationMs: P_COMMIT }
		);
		b.add(
			{ name: 'pass2-in', reduce: (t: number) => ({ u: 2 + t }) },
			{ durationMs: P_PASS2 }
		);
		b.add({ name: 'hold-b', reduce: (_t: number) => ({ u: 3 }) }, { durationMs: P_HOLD_B });
		b.add(
			{ name: 'final-in', reduce: (t: number) => ({ u: 3 + t }) },
			{ durationMs: P_FINAL }
		);
		b.add({ name: 'end-hold', reduce: (_t: number) => ({ u: 4 }) }, { durationMs: END_HOLD });
		return b.build();
	}

	function replay() {
		if (!player) return;
		player.reset();
		u = 0;
		player.play();
		isPlaying = player.isPlaying;
	}

	function togglePlayPause() {
		if (!player) return;
		if (player.isPlaying) player.pause();
		else player.play();
		isPlaying = player.isPlaying;
	}

	onMount(() => {
		player = new Player<State>(buildTimeline(), { looping: false, endPause: 0.05 });
		player.onTick((_t, s) => {
			u = s.u;
			if (player) isPlaying = player.isPlaying;
		});
		const unsubActive = isActive?.subscribe((v) => {
			if (!player) return;
			if (v) player.play();
			else {
				player.pause();
				player.reset();
				u = 0;
			}
			isPlaying = player.isPlaying;
		});
		return () => {
			unsubActive?.();
			player?.dispose();
		};
	});
</script>

{#snippet maskToken(cx: number, cy: number)}
	<rect
		x={cx - SLOT_W / 2 + 8}
		y={cy - SLOT_H / 2}
		width={SLOT_W - 16}
		height={SLOT_H}
		rx={5}
		ry={5}
		fill={maskColor}
	/>
	<text
		x={cx}
		y={cy}
		text-anchor="middle"
		dominant-baseline="central"
		font-size={maskLabelSize}
		font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"
		fill={maskTextColor}
	>
		[MASK]
	</text>
{/snippet}

{#snippet transformerBlock(y: number, height: number)}
	<rect
		x={TX_X}
		y={y}
		width={TX_W}
		height={height}
		rx={12}
		ry={12}
		fill={TX_FILL}
		stroke={TX_STROKE}
		stroke-width="1.5"
	/>
	<text
		x={W / 2}
		y={y + height / 2}
		text-anchor="middle"
		dominant-baseline="central"
		font-size={txLabelSize}
		font-weight="600"
		fill="#7a7f86"
	>
		Masked Transformer
	</text>
{/snippet}

{#snippet inputArrows(seqY: number, txY: number)}
	{#each inputTokens as _tok, i}
		<line
			x1={slotX(i)}
			y1={seqY + SLOT_H / 2 + 2}
			x2={slotX(i)}
			y2={txY - 4}
			stroke={MUTED}
			stroke-width="1.5"
			marker-end={`url(#${MARKER_ACCENT})`}
			opacity="0.55"
		/>
	{/each}
{/snippet}

{#snippet outputArrows(txY: number, txH: number, barY: number, mIdxs: number[])}
	{#each mIdxs as maskedIdx}
		{@const startX = slotX(maskedIdx)}
		{@const startY = txY + txH + 2}
		{@const endX = slotX(maskedIdx)}
		{@const endY = barY - 22 - 4}
		<path
			d={`M ${startX} ${startY} L ${endX} ${endY}`}
			fill="none"
			stroke={ACCENT}
			stroke-width="2"
			marker-end={`url(#${MARKER_ACCENT})`}
		/>
	{/each}
{/snippet}

{#snippet probPanel(
	panelBarY: number,
	panel: { word: string; p: number }[],
	sIdx: number,
	maskedIdx: number
)}
	{@const px = panelXAt(maskedIdx)}
	<text
		x={px + PANEL_W / 2}
		y={panelBarY - 22}
		text-anchor="middle"
		dominant-baseline="central"
		font-size={panelHeaderSize}
		letter-spacing="0.05em"
		font-weight="600"
		fill={MUTED}
	>
		PROBABILITIES
	</text>
	{#each panel as row, r}
		{@const rowY = panelBarY + r * BAR_ROW_H}
		{@const isSampled = r === sIdx}
		{@const barW = row.p * BAR_MAX_W}
		{@const barX = px + BAR_LABEL_W}
		{@const numFitsInside = barW >= 32}
		<text
			x={px + BAR_LABEL_W - 6}
			y={rowY + BAR_ROW_H / 2}
			text-anchor="end"
			dominant-baseline="central"
			font-size={barWordSize}
			fill={isSampled ? ACCENT : TEXT_COLOR}
			font-weight={isSampled ? '600' : '400'}
		>
			{row.word}
		</text>
		<rect
			x={barX}
			y={rowY + BAR_ROW_H / 2 - BAR_H / 2}
			width={barW}
			height={BAR_H}
			rx={3}
			ry={3}
			fill={isSampled ? ACCENT : BAR_COLOR}
			opacity="0.85"
		/>
		{#if numFitsInside}
			<text
				x={barX + barW - 6}
				y={rowY + BAR_ROW_H / 2}
				text-anchor="end"
				dominant-baseline="central"
				font-size={probNumSize}
				fill="#fff"
				font-weight="600"
			>
				{row.p.toFixed(2)}
			</text>
		{:else}
			<text
				x={barX + barW + 4}
				y={rowY + BAR_ROW_H / 2}
				text-anchor="start"
				dominant-baseline="central"
				font-size={probNumSize}
				fill={MUTED}
			>
				{row.p.toFixed(2)}
			</text>
		{/if}
	{/each}
{/snippet}

<div class="wrap" style="--mask-color: {maskColor}">
	<PlayPauseResetButton
		{isPlaying}
		time={normalizedTime}
		onclick={togglePlayPause}
		onreset={replay}
	/>
	<svg
		viewBox={`0 0 ${W} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Two forward passes of a masked transformer. Pass 1 commits 'tired' at the first mask. Pass 2 shows that with 'tired' committed, the second mask's marginal concentrates on 'sleep', recovering the coherent sentence 'The dog is tired so he wants to sleep'."
	>
		<defs>
			<marker
				id={MARKER_ACCENT}
				viewBox="0 -5 10 10"
				refX={8}
				refY={0}
				markerWidth={5}
				markerHeight={5}
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill={ACCENT} />
			</marker>
			<marker
				id={MARKER_SUCCESS}
				viewBox="0 -5 10 10"
				refX={8}
				refY={0}
				markerWidth={5}
				markerHeight={5}
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill={SUCCESS} />
			</marker>
		</defs>

		<!-- Pass 1 -->
		<g opacity={p1}>
			<!-- Section label -->
			<text
				x={seqX0 + 10}
				y={PASS1_SEQ_Y - 18}
				dominant-baseline="central"
				font-size={successLabelSize}
				font-weight="600"
				letter-spacing="0.06em"
				fill={MUTED}
			>
				PASS 1
			</text>
			<!-- Input row with both masks -->
			{#each inputTokens as tok, i}
				{#if tok === null}
					{@render maskToken(slotX(i), PASS1_SEQ_Y)}
				{:else}
					<text
						x={slotX(i)}
						y={PASS1_SEQ_Y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size={fontSize}
						fill={TEXT_COLOR}
					>
						{tok}
					</text>
				{/if}
			{/each}

			{@render inputArrows(PASS1_SEQ_Y, PASS1_TX_Y)}
			{@render transformerBlock(PASS1_TX_Y, PASS1_TX_H)}
			{@render outputArrows(PASS1_TX_Y, PASS1_TX_H, PASS1_BAR_Y, maskedIndices)}

			{@render probPanel(
				PASS1_BAR_Y,
				candidatesPass1[0],
				pass1SampledIndex,
				maskedIndices[0]
			)}
			{@render probPanel(
				PASS1_BAR_Y,
				candidatesPass1[1],
				-1,
				maskedIndices[1]
			)}
		</g>

		<!-- Commit callout: sampled 'tired' from position 3 feeds forward -->
		<g opacity={pCommit}>
			<text
				x={W / 2}
				y={COMMIT_LABEL_Y}
				text-anchor="middle"
				dominant-baseline="central"
				font-size={commitLabelSize}
				font-weight="600"
				fill={ACCENT}
			>
				Commit &ldquo;tired&rdquo; &mdash; then run the model again
			</text>
			<line
				x1={W / 2}
				y1={COMMIT_ARROW_TOP}
				x2={W / 2}
				y2={COMMIT_ARROW_BOTTOM}
				stroke={ACCENT}
				stroke-width="2"
				marker-end={`url(#${MARKER_ACCENT})`}
			/>
		</g>

		<!-- Pass 2 -->
		<g opacity={p2}>
			<text
				x={seqX0 + 10}
				y={PASS2_SEQ_Y - 18}
				dominant-baseline="central"
				font-size={successLabelSize}
				font-weight="600"
				letter-spacing="0.06em"
				fill={MUTED}
			>
				PASS 2
			</text>
			<!-- Input row: position 3 shows 'tired' in orange; position 8 still masked -->
			{#each pass2Tokens as tok, i}
				{#if tok === null}
					{@render maskToken(slotX(i), PASS2_SEQ_Y)}
				{:else if i === maskedIndices[0]}
					<text
						x={slotX(i)}
						y={PASS2_SEQ_Y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size={fontSize}
						fill={ACCENT}
						font-weight="600"
					>
						{tok}
					</text>
				{:else}
					<text
						x={slotX(i)}
						y={PASS2_SEQ_Y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size={fontSize}
						fill={TEXT_COLOR}
					>
						{tok}
					</text>
				{/if}
			{/each}

			{@render inputArrows(PASS2_SEQ_Y, PASS2_TX_Y)}
			{@render transformerBlock(PASS2_TX_Y, PASS2_TX_H)}
			{@render outputArrows(PASS2_TX_Y, PASS2_TX_H, PASS2_BAR_Y, [maskedIndices[1]])}

			{@render probPanel(
				PASS2_BAR_Y,
				candidatesPass2,
				pass2SampledIndex,
				maskedIndices[1]
			)}
		</g>

		<!-- Final decoded row -->
		<g opacity={pFinal}>
			{#each finalDecoded as tok, i}
				{@const isFilled = inputTokens[i] === null}
				<text
					x={slotX(i)}
					y={FINAL_SEQ_Y}
					text-anchor="middle"
					dominant-baseline="central"
					font-size={fontSize}
					fill={isFilled ? ACCENT : TEXT_COLOR}
					font-weight={isFilled ? '600' : '400'}
				>
					{tok}
				</text>
			{/each}
			<text
				x={W / 2}
				y={SUCCESS_LABEL_Y}
				text-anchor="middle"
				dominant-baseline="central"
				font-size={successLabelSize}
				font-style="italic"
				fill={SUCCESS}
			>
				Sequential unmasking recovers the coherent joint sample.
			</text>
		</g>
	</svg>
</div>

<style>
	.wrap {
		position: relative;
		width: 100%;
		max-width: 1000px;
		margin: 0 auto;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
</style>
