<script lang="ts">
	// Animated "why order matters" pipeline diagram for MDLM.
	//
	// Same visual vocabulary as ModelPredictionFigure: input token row →
	// transformer block → two categorical distributions → argmax fills in
	// the decoded sentence. What's different is the example. The sentence
	//
	//     "The dog is [MASK] so he wants to [MASK]"
	//
	// has two masked positions whose marginals look individually plausible
	// but whose joint concentrates on two coherent modes (tired→sleep,
	// hungry→eat). The "so" makes the causal link explicit, so the
	// independent argmax landing on (tired, eat) reads as clearly
	// incoherent — the reader knows a tired dog would sleep, not eat.
	//
	// Timeline phases mirror ModelPredictionFigure exactly.

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

	let { isActive, maskColor = '#cfe0f2', maskTextColor = '#33506e', width = 1000, fontSize = 18 }: Props = $props();

	const maskLabelSize = fontSize * (12 / 16);
	const txLabelSize = fontSize * (18 / 16);
	const panelHeaderSize = fontSize * (15 / 16);
	const barWordSize = fontSize * (14 / 16);
	const probNumSize = fontSize * (12 / 16);
	const warningLabelSize = fontSize * (13 / 16);

	// --- Palette ---
	const TEXT_COLOR = '#333';
	const MUTED = '#888';
	const ACCENT = '#f17720';
	const WARNING = '#c04b3a';
	const BAR_COLOR = '#99BCDC';
	const TX_FILL = '#f4f6fa';
	const TX_STROKE = '#c8ccd1';

	// --- Content ---
	// 9-token sentence with an explicit causal link ("so"), so the reader
	// judges coherence on the state → action pairing rather than on a
	// looser conjunction. Masks at indices 3 and 8.
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
	const maskedIndices = inputTokens
		.map((t, i) => (t === null ? i : -1))
		.filter((i) => i >= 0);
	// Two ~50/50 marginals whose joint is bimodal on (tired, sleep) and
	// (hungry, eat). Only the top-2 candidates per marginal are shown so
	// the eye lands on the bimodality without vocabulary noise.
	// Independent argmax lands on (tired, eat) — incoherent.
	const candidates: { word: string; p: number }[][] = [
		[
			{ word: 'tired', p: 0.53 },
			{ word: 'hungry', p: 0.47 }
		],
		[
			{ word: 'eat', p: 0.51 },
			{ word: 'sleep', p: 0.49 }
		]
	];
	// Hard-coded outcome: position 3 samples "tired" (row 0), position 8
	// samples "eat" (row 0). The two argmaxes together form the incoherent
	// pair the section is arguing about.
	const sampledIndex: number[] = [0, 0];
	const decoded = inputTokens.map((tok, i) => {
		if (tok !== null) return tok;
		const which = maskedIndices.indexOf(i);
		return candidates[which][sampledIndex[which]].word;
	});

	// --- Geometry ---
	const W = width;
	const H = 435;
	const SEQ_Y_TOP = 25;
	const SEQ_Y_BOTTOM = 385;
	const WARNING_Y = SEQ_Y_BOTTOM + 32;
	const SLOT_W = 78;
	const SLOT_H = 30;
	const N = inputTokens.length;
	const seqTotalW = N * SLOT_W;
	const seqX0 = (W - seqTotalW) / 2;
	function slotX(i: number): number {
		return seqX0 + i * SLOT_W + SLOT_W / 2;
	}

	const TX_Y = 90;
	const TX_H = 44;
	const TX_X = seqX0 + 4;
	const TX_W = seqTotalW - 8;

	const BAR_Y_TOP = 220;
	const BAR_ROW_H = 26;
	const BAR_LABEL_W = 72;
	const BAR_MAX_W = 210;
	const BAR_H = 18;
	const BAR_PROB_W = 40;
	const PANEL_W = BAR_LABEL_W + BAR_MAX_W + BAR_PROB_W + 16;
	const PANEL_Y_HEADER = BAR_Y_TOP - 36;
	function panelX(which: number): number {
		return slotX(maskedIndices[which]) - PANEL_W / 2;
	}

	const MARKER_MUTED = 'omf-arrow-muted';
	const MARKER_ACCENT = 'omf-arrow-accent';

	// --- Timeline ---
	const P_IN = 700;
	const P_HOLD = 500;
	const P_SAMPLE = 730;
	const END_HOLD = 6500;
	const ANIMATED_PHASES = [2, 4, 5, 6, 7] as const;
	const SAMPLE_PHASE = 6;

	interface State {
		u: number;
	}
	let u = $state(0);
	let player = $state<Player<State> | undefined>(undefined);
	let isPlaying = $state(false);
	const normalizedTime = $derived(Math.min(1, u / ANIMATED_PHASES.length));

	function smoothstep(x: number): number {
		const c = Math.max(0, Math.min(1, x));
		return c * c * (3 - 2 * c);
	}

	function animatedPhaseProgress(p: number): number {
		const i = ANIMATED_PHASES.indexOf(p as (typeof ANIMATED_PHASES)[number]);
		if (i < 0) return 1;
		return Math.max(0, Math.min(1, u - i));
	}

	let p1 = 1;
	let p2 = $derived(smoothstep(animatedPhaseProgress(2)));
	let p3 = 1;
	let p4 = $derived(smoothstep(animatedPhaseProgress(4)));
	let p5 = $derived(smoothstep(animatedPhaseProgress(5)));
	let pSample = $derived(animatedPhaseProgress(SAMPLE_PHASE));
	let p7 = $derived(smoothstep(animatedPhaseProgress(7)));

	function flashIntensity(s: number): number {
		if (s <= 0) return 0;
		if (s >= 1) return 1;
		const ramp = Math.min(1, s / 0.15);
		return ramp * ramp * (3 - 2 * ramp);
	}

	function buildTimeline() {
		const b = new TimelineBuilder<State>().setInitialState({ u: 0 });
		for (let i = 0; i < ANIMATED_PHASES.length; i++) {
			const phase = ANIMATED_PHASES[i];
			const from = i;
			const to = i + 1;
			const legMs = phase === SAMPLE_PHASE ? P_SAMPLE : P_IN;
			b.add(
				{
					name: `phase-in-${phase}`,
					reduce: (t: number) => ({ u: from + t * (to - from) })
				},
				{ durationMs: legMs }
			);
			b.add(
				{
					name: `hold-${phase}`,
					reduce: (_t: number) => ({ u: to })
				},
				{ durationMs: i === ANIMATED_PHASES.length - 1 ? END_HOLD : P_HOLD }
			);
		}
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
		player = new Player<State>(buildTimeline(), {
			looping: false,
			endPause: 0.05
		});
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
		aria-label="Animated pipeline diagram showing the sentence 'The dog is [MASK] so he wants to [MASK]' fed into a Transformer block, which emits two categorical distributions; the independent argmax picks land on the incoherent pair (tired, eat)."
	>
		<defs>
			<marker
				id={MARKER_MUTED}
				viewBox="0 -5 10 10"
				refX={8}
				refY={0}
				markerWidth={5}
				markerHeight={5}
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill={MUTED} />
			</marker>
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
		</defs>

		<!-- Phase 1: input sequence -->
		<g opacity={p1}>
			{#each inputTokens as tok, i}
				{#if tok === null}
					<rect
						x={slotX(i) - SLOT_W / 2 + 8}
						y={SEQ_Y_TOP - SLOT_H / 2}
						width={SLOT_W - 16}
						height={SLOT_H}
						rx={5}
						ry={5}
						fill={maskColor}
					/>
					<text
						x={slotX(i)}
						y={SEQ_Y_TOP}
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
						y={SEQ_Y_TOP}
						text-anchor="middle"
						dominant-baseline="central"
						font-size={fontSize}
						fill={TEXT_COLOR}
					>
						{tok}
					</text>
				{/if}
			{/each}
		</g>

		<!-- Phase 2: arrows from every input into the transformer -->
		<g opacity={p2}>
			{#each inputTokens as _tok, i}
				{@const y1 = SEQ_Y_TOP + SLOT_H / 2 + 2}
				{@const yEnd = TX_Y - 4}
				{@const yCur = y1 + (yEnd - y1) * p2}
				<line
					x1={slotX(i)}
					y1={y1}
					x2={slotX(i)}
					y2={yCur}
					stroke={MUTED}
					stroke-width="1.5"
					marker-end={p2 >= 1 ? `url(#${MARKER_MUTED})` : ''}
				/>
			{/each}
		</g>

		<!-- Phase 3: transformer block -->
		<g opacity={p3}>
			<rect
				x={TX_X}
				y={TX_Y}
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
				y={TX_Y + TX_H / 2}
				text-anchor="middle"
				dominant-baseline="central"
				font-size={txLabelSize}
				font-weight="600"
				fill="#7a7f86"
			>
				Masked Transformer
			</text>
		</g>

		<!-- Phase 4: arrows from transformer's masked positions to bar panels -->
		<g opacity={p4}>
			{#each maskedIndices as maskedIdx, which}
				{@const startX = slotX(maskedIdx)}
				{@const startY = TX_Y + TX_H + 2}
				{@const endX = panelX(which) + PANEL_W / 2}
				{@const endY = PANEL_Y_HEADER - 6}
				{@const curEndX = startX + (endX - startX) * p4}
				{@const curEndY = startY + (endY - startY) * p4}
				<path
					d={`M ${startX} ${startY} C ${startX} ${(startY + curEndY) / 2}, ${curEndX} ${(startY + curEndY) / 2}, ${curEndX} ${curEndY}`}
					fill="none"
					stroke={ACCENT}
					stroke-width="2"
					marker-end={p4 >= 1 ? `url(#${MARKER_ACCENT})` : ''}
				/>
			{/each}
		</g>

		<!-- Phase 5 + 6: bar-chart panels -->
		<g opacity={p5}>
			{#each candidates as panel, which}
				{@const px = panelX(which)}
				{@const flash = flashIntensity(pSample)}
				<text
					x={px + PANEL_W / 2}
					y={BAR_Y_TOP - 22}
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
					{@const rowY = BAR_Y_TOP + r * BAR_ROW_H}
					{@const isSampled = r === sampledIndex[which]}
					{@const isHot = isSampled && flash > 0}
					{@const baseW = row.p * BAR_MAX_W * p5}
					{@const grow = 1 + 0.1 * (isHot ? flash : 0)}
					{@const barW = baseW * grow}
					{@const barX = px + BAR_LABEL_W}
					{@const numFitsInside = barW >= 32}
					<text
						x={px + BAR_LABEL_W - 6}
						y={rowY + BAR_ROW_H / 2}
						text-anchor="end"
						dominant-baseline="central"
						font-size={barWordSize}
						fill={isHot ? ACCENT : TEXT_COLOR}
						font-weight={isHot ? '600' : '400'}
					>
						{row.word}
					</text>
					<rect
						x={barX}
						y={rowY + BAR_ROW_H / 2 - (BAR_H * grow) / 2}
						width={barW}
						height={BAR_H * grow}
						rx={3}
						ry={3}
						fill={isHot ? ACCENT : BAR_COLOR}
						opacity={isHot ? 0.75 + 0.2 * flash : 0.75}
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
			{/each}
		</g>

		<!-- Phase 7: arrows from sampled bars down to the decoded row, and the
		     incoherence warning line below it. -->
		<g opacity={p7}>
			{#each maskedIndices as maskedIdx, which}
				{@const px = panelX(which)}
				{@const sIdx = sampledIndex[which]}
				{@const sampledP = candidates[which][sIdx].p}
				{@const sampledBarW = sampledP * BAR_MAX_W * 1.1}
				{@const sampledRowY = BAR_Y_TOP + sIdx * BAR_ROW_H + BAR_ROW_H / 2}
				{@const startX = px + BAR_LABEL_W + sampledBarW + 4}
				{@const startY = sampledRowY}
				{@const endX = slotX(maskedIdx)}
				{@const endY = SEQ_Y_BOTTOM - SLOT_H / 2 - 2}
				{@const curEndX = startX + (endX - startX) * p7}
				{@const curEndY = startY + (endY - startY) * p7}
				{@const c1X = startX + 40}
				{@const c1Y = startY}
				{@const c2X = curEndX}
				{@const c2Y = startY + (curEndY - startY) * 0.6}
				<path
					d={`M ${startX} ${startY} C ${c1X} ${c1Y}, ${c2X} ${c2Y}, ${curEndX} ${curEndY}`}
					fill="none"
					stroke={ACCENT}
					stroke-width="2"
					marker-end={p7 >= 1 ? `url(#${MARKER_ACCENT})` : ''}
				/>
			{/each}
			{#each decoded as tok, i}
				<text
					x={slotX(i)}
					y={SEQ_Y_BOTTOM}
					text-anchor="middle"
					dominant-baseline="central"
					font-size={fontSize}
					fill={inputTokens[i] === null ? ACCENT : TEXT_COLOR}
					font-weight={inputTokens[i] === null ? '600' : '400'}
				>
					{tok}
				</text>
			{/each}
			<text
				x={W / 2}
				y={WARNING_Y}
				text-anchor="middle"
				dominant-baseline="central"
				font-size={warningLabelSize}
				font-style="italic"
				fill={WARNING}
			>
				Marginals look plausible, but the joint sample is incoherent.
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
