<script lang="ts">
	// Two-phase MDM pipeline diagram: why independent-per-position
	// sampling drops joint constraints, and how remasking recovers.
	//
	//   Phase A (upper panel): the transformer emits two 50/50 {Alice, Bob}
	//     distributions at the masked positions. The sampler draws each
	//     position independently and lands on the duplicate — the decoded
	//     row reads "Alice and Alice love baseball.", a nonsensical result.
	//   Handoff: the broken decoded row of phase A flows down into phase B
	//     as its new input row.
	//   Phase B (lower panel): position 5 stays visible with the token
	//     chosen in phase A ("Alice"); position 7 is remasked. The
	//     transformer now emits a near-degenerate distribution at position
	//     7 (~98% "Bob"), because it can condition on the visible token to
	//     its left. Argmax fills the corrected token, yielding "Alice and
	//     Bob love baseball.".
	//
	// The two panels share one SVG; every y-coordinate goes through
	// `yFor(phase, anchor)` which adds the panel's Y_OFFSET.
	//
	// Plays once when the figure enters view; a replay button in the top-
	// left restarts. Auto-pauses/resets when scrolled out.

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import { PlayPauseResetButton } from '@diffusion-explorer/ui';

	interface Props {
		isActive?: Writable<boolean>;
		maskColor?: string;
		maskTextColor?: string;
		width?: number;
	}

	let { isActive, maskColor = '#cfe0f2', maskTextColor = '#33506e', width = 860 }: Props = $props();

	// --- Palette (matches ModelPredictionFigure) ---
	const TEXT_COLOR = '#333';
	const MUTED = '#888';
	const ACCENT = '#f17720';
	const BAR_COLOR = '#99BCDC';
	const TX_FILL = '#f4f6fa';
	const TX_STROKE = '#c8ccd1';
	// Phase-B "just remasked; still remembers phase A" color — same orange,
	// muted a little so it reads as "context inherited from above" rather
	// than "freshly decoded".
	const CARRY_COLOR = '#c78149';

	// --- Content ---
	// 10-token sequence. Positions 5 and 7 are the two masked subject slots
	// in the second sentence.
	const inputTokens: (string | null)[] = [
		'Alice',
		'and',
		'Bob',
		'are',
		'friends.',
		null,
		'and',
		null,
		'love',
		'baseball.'
	];
	const N = inputTokens.length;
	const maskedIndices = inputTokens
		.map((t, i) => (t === null ? i : -1))
		.filter((i) => i >= 0);

	// Phase A: independent 50/50 {Alice, Bob} at each masked slot.
	const candidatesA: { word: string; p: number }[][] = [
		[
			{ word: 'Alice', p: 0.5 },
			{ word: 'Bob', p: 0.5 }
		],
		[
			{ word: 'Alice', p: 0.5 },
			{ word: 'Bob', p: 0.5 }
		]
	];
	// Hard-coded outcome: both positions land on Alice — the failure mode.
	const sampledIndexA = [0, 0];
	const decodedA: string[] = inputTokens.map((tok, i) => {
		if (tok !== null) return tok;
		const which = maskedIndices.indexOf(i);
		return candidatesA[which][sampledIndexA[which]].word;
	});

	// Phase B: position 5 is now visible (fixed as "Alice" from phase A).
	// Only position 7 is masked; its distribution collapses onto "Bob".
	// We keep the same maskedIndices in the geometry so we can reuse the
	// bar-panel machinery, but only render the panel at index 1 (position 7).
	const candidatesB: ({ word: string; p: number }[] | null)[] = [
		null, // position 5 is not masked in phase B
		[
			{ word: 'Bob', p: 0.98 },
			{ word: 'Alice', p: 0.02 }
		]
	];
	const sampledIndexB: (number | null)[] = [null, 0];
	// The observed (from phase A) token at position 5 and the freshly-
	// decoded (in phase B) token at position 7.
	const observedInB: (string | null)[] = inputTokens.map((tok, i) => {
		if (tok !== null) return tok;
		if (i === maskedIndices[0]) return decodedA[i]; // "Alice" carried down
		return null; // position 7 stays masked
	});
	const decodedB: string[] = inputTokens.map((tok, i) => {
		if (tok !== null) return tok;
		if (i === maskedIndices[0]) return decodedA[i]; // carried
		return 'Bob'; // freshly decoded
	});

	// --- Geometry ---
	const W = width;
	// Per-phase vertical extent, matching ModelPredictionFigure's H.
	const PANEL_H = 405;
	const HANDOFF_H = 90;
	const H = PANEL_H * 2 + HANDOFF_H;
	// Y offset applied to every intra-panel anchor.
	const Y_OFFSET: [number, number] = [0, PANEL_H + HANDOFF_H];
	function yFor(phase: 0 | 1, anchor: number): number {
		return Y_OFFSET[phase] + anchor;
	}

	// Intra-panel anchors (identical to ModelPredictionFigure).
	const SEQ_Y_TOP = 25;
	const SEQ_Y_BOTTOM = 385;
	// Token slot width — scale down so 10 tokens fit inside the widened SVG.
	const SLOT_W = 68;
	const SLOT_H = 30;
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
	const BAR_ROW_H = 32;
	const BAR_LABEL_W = 48;
	const BAR_MAX_W = 92;
	const BAR_H = 24;
	const BAR_PROB_W = 28;
	const PANEL_W = BAR_LABEL_W + BAR_MAX_W + BAR_PROB_W + 16;
	const PANEL_Y_HEADER = BAR_Y_TOP - 36;
	function panelX(which: number): number {
		return slotX(maskedIndices[which]) - PANEL_W / 2;
	}

	// The "handoff" Masked Transformer block sits centered in the vertical
	// gap between Phase A's decoded row and Phase B's remasked input row.
	const HANDOFF_TX_H = 44;
	const HANDOFF_TX_Y = PANEL_H + (HANDOFF_H - HANDOFF_TX_H) / 2;

	const MARKER_MUTED = 'iff-arrow-muted';
	const MARKER_ACCENT = 'iff-arrow-accent';

	// --- Timeline ---
	// The pipeline has 5 animated phases (2, 4, 5, 6, 7). We run them twice —
	// once for panel A, then a handoff, then once for panel B. Timeline `u`
	// advances one unit per animated phase. Order of firing:
	//   A2 A4 A5 A6 A7  HANDOFF  B2 B4 B5 B6 B7
	//   0  1  2  3  4   5        6  7  8  9  10
	// A total of 11 animated legs, each followed by a hold.
	const P_IN = 700;
	const P_HOLD = 500;
	const P_SAMPLE = 2200;
	const HANDOFF_MS = 900;
	const END_HOLD = 5500;

	// Which phase indices are animated, in play order. Values are the intra-
	// panel phase-tag we key on (2, 4, 5, 6, 7); index in this array is the
	// leg counter `u`.
	//   Legs 0..4  → phase A (upper)
	//   Leg 5      → handoff (own reducer, no phase tag reused)
	//   Legs 6..10 → phase B (lower)
	const ANIMATED_LEGS = [
		{ panel: 0 as 0 | 1, kind: 'phase' as const, phase: 2 },
		{ panel: 0 as 0 | 1, kind: 'phase' as const, phase: 4 },
		{ panel: 0 as 0 | 1, kind: 'phase' as const, phase: 5 },
		{ panel: 0 as 0 | 1, kind: 'phase' as const, phase: 6 },
		{ panel: 0 as 0 | 1, kind: 'phase' as const, phase: 7 },
		{ panel: null, kind: 'handoff' as const, phase: -1 },
		{ panel: 1 as 0 | 1, kind: 'phase' as const, phase: 2 },
		{ panel: 1 as 0 | 1, kind: 'phase' as const, phase: 4 },
		{ panel: 1 as 0 | 1, kind: 'phase' as const, phase: 5 },
		{ panel: 1 as 0 | 1, kind: 'phase' as const, phase: 6 },
		{ panel: 1 as 0 | 1, kind: 'phase' as const, phase: 7 }
	];
	const SAMPLE_LEG_A = 3;
	const SAMPLE_LEG_B = 9;
	const HANDOFF_LEG = 5;

	interface State {
		u: number;
	}
	let u = $state(0);
	let player = $state<Player<State> | undefined>(undefined);
	let isPlaying = $state(false);

	// 0..1 fraction of the animation actually complete. Reaches 1 the instant
	// the last animated leg finishes (before the trailing END_HOLD), which is
	// when we want to swap in the "restart" affordance.
	const normalizedTime = $derived(Math.min(1, u / ANIMATED_LEGS.length));

	function smoothstep(x: number): number {
		const c = Math.max(0, Math.min(1, x));
		return c * c * (3 - 2 * c);
	}

	// Progress ∈ [0, 1] of a specific leg (0..10). `u` is the position on
	// the concatenated timeline.
	function legProgress(leg: number): number {
		return Math.max(0, Math.min(1, u - leg));
	}
	function legProgressRaw(leg: number): number {
		return u - leg;
	}

	// Per-panel per-phase progress. Panel index is 0 (A) or 1 (B); phase
	// number is 2/4/5/6/7 (matching ModelPredictionFigure's naming).
	function progressFor(panel: 0 | 1, phase: number): number {
		for (let i = 0; i < ANIMATED_LEGS.length; i++) {
			const l = ANIMATED_LEGS[i];
			if (l.kind === 'phase' && l.panel === panel && l.phase === phase) {
				return legProgress(i);
			}
		}
		return 0;
	}
	function progressForRaw(panel: 0 | 1, phase: number): number {
		for (let i = 0; i < ANIMATED_LEGS.length; i++) {
			const l = ANIMATED_LEGS[i];
			if (l.kind === 'phase' && l.panel === panel && l.phase === phase) {
				return legProgressRaw(i);
			}
		}
		return 0;
	}

	// Handoff progress (linear).
	const handoffP = $derived(legProgress(HANDOFF_LEG));

	// Per-panel derived progress values (mirroring ModelPredictionFigure).
	// Panel A
	const A_p1 = 1;
	const A_p2 = $derived(smoothstep(progressFor(0, 2)));
	const A_p3 = 1;
	const A_p4 = $derived(smoothstep(progressFor(0, 4)));
	const A_p5 = $derived(smoothstep(progressFor(0, 5)));
	const A_pSample = $derived(progressForRaw(0, 6)); // raw for wheel flash
	const A_p7 = $derived(smoothstep(progressFor(0, 7)));

	// Panel B: only visible starting at the handoff (its transformer +
	// input row need to reveal along with the handoff).
	// Its per-phase animations fire on legs 6..10.
	const B_p1 = $derived(smoothstep(Math.min(1, handoffP))); // input row reveal
	const B_p2 = $derived(smoothstep(progressFor(1, 2)));
	const B_p3 = $derived(smoothstep(Math.min(1, handoffP))); // transformer fades in with handoff
	const B_p4 = $derived(smoothstep(progressFor(1, 4)));
	const B_p5 = $derived(smoothstep(progressFor(1, 5)));
	const B_pSample = $derived(progressForRaw(1, 6));
	const B_p7 = $derived(smoothstep(progressFor(1, 7)));

	function flashIntensity(s: number): number {
		if (s <= 0) return 0;
		if (s >= 1) return 1;
		const ramp = Math.min(1, s / 0.15);
		return ramp * ramp * (3 - 2 * ramp);
	}

	function buildTimeline() {
		const b = new TimelineBuilder<State>().setInitialState({ u: 0 });
		for (let i = 0; i < ANIMATED_LEGS.length; i++) {
			const l = ANIMATED_LEGS[i];
			const from = i;
			const to = i + 1;
			let legMs = P_IN;
			if (l.kind === 'handoff') legMs = HANDOFF_MS;
			else if (l.phase === 6) legMs = P_SAMPLE;
			b.add(
				{
					name: `phase-in-${i}`,
					reduce: (t: number) => ({ u: from + t * (to - from) })
				},
				{ durationMs: legMs }
			);
			b.add(
				{
					name: `hold-${i}`,
					reduce: (_t: number) => ({ u: to })
				},
				{ durationMs: i === ANIMATED_LEGS.length - 1 ? END_HOLD : P_HOLD }
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
		aria-label="Two-phase pipeline showing that independent per-position sampling can produce a nonsensical duplicate ('Alice and Alice'), and that remasking one position and resampling recovers the correct joint completion ('Alice and Bob')."
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

		<!-- ============================================================ -->
		<!-- Phase A (upper panel) — copy of the ModelPredictionFigure     -->
		<!-- pipeline at Y_OFFSET[0].                                       -->
		<!-- ============================================================ -->

		<!-- A1: input sequence -->
		<g opacity={A_p1}>
			{#each inputTokens as tok, i}
				{#if tok === null}
					<rect
						x={slotX(i) - SLOT_W / 2 + 8}
						y={yFor(0, SEQ_Y_TOP) - SLOT_H / 2}
						width={SLOT_W - 16}
						height={SLOT_H}
						rx={5}
						ry={5}
						fill={maskColor}
					/>
					<text
						x={slotX(i)}
						y={yFor(0, SEQ_Y_TOP)}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="12"
						font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"
						fill={maskTextColor}
					>
						[MASK]
					</text>
				{:else}
					<text
						x={slotX(i)}
						y={yFor(0, SEQ_Y_TOP)}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="16"
						fill={TEXT_COLOR}
					>
						{tok}
					</text>
				{/if}
			{/each}
		</g>

		<!-- A2: arrows into transformer -->
		<g opacity={A_p2}>
			{#each inputTokens as _tok, i}
				{@const y1 = yFor(0, SEQ_Y_TOP + SLOT_H / 2 + 2)}
				{@const yEnd = yFor(0, TX_Y - 4)}
				{@const yCur = y1 + (yEnd - y1) * A_p2}
				<line
					x1={slotX(i)}
					y1={y1}
					x2={slotX(i)}
					y2={yCur}
					stroke={MUTED}
					stroke-width="1.5"
					marker-end={A_p2 >= 1 ? `url(#${MARKER_MUTED})` : ''}
				/>
			{/each}
		</g>

		<!-- A3: transformer block -->
		<g opacity={A_p3}>
			<rect
				x={TX_X}
				y={yFor(0, TX_Y)}
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
				y={yFor(0, TX_Y + TX_H / 2)}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="18"
				font-weight="600"
				fill="#7a7f86"
			>
				Masked Transformer
			</text>
		</g>

		<!-- A4: curved arrows from transformer's masked column down to the
		     probability panels centered on the masked slots. -->
		<g opacity={A_p4}>
			{#each maskedIndices as maskedIdx, which}
				{@const startX = slotX(maskedIdx)}
				{@const startY = yFor(0, TX_Y + TX_H + 2)}
				{@const endX = panelX(which) + PANEL_W / 2}
				{@const endY = yFor(0, PANEL_Y_HEADER - 6)}
				{@const curEndX = startX + (endX - startX) * A_p4}
				{@const curEndY = startY + (endY - startY) * A_p4}
				{@const midY = (startY + curEndY) / 2}
				<path
					d={`M ${startX} ${startY} C ${startX} ${midY}, ${curEndX} ${midY}, ${curEndX} ${curEndY}`}
					fill="none"
					stroke={ACCENT}
					stroke-width="2"
					marker-end={A_p4 >= 1 ? `url(#${MARKER_ACCENT})` : ''}
				/>
			{/each}
		</g>

		<!-- A5 + A6: bar panels + wheel-of-fortune sample -->
		<g opacity={A_p5}>
			{#each candidatesA as panel, which}
				{@const px = panelX(which)}
				{@const flash = flashIntensity(A_pSample)}
				<text
					x={px + PANEL_W / 2}
					y={yFor(0, BAR_Y_TOP - 22)}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="15"
					letter-spacing="0.05em"
					font-weight="600"
					fill={MUTED}
				>
					PROBABILITIES
				</text>
				{#each panel as row, r}
					{@const rowY = yFor(0, BAR_Y_TOP + r * BAR_ROW_H)}
					{@const isSampled = r === sampledIndexA[which]}
					{@const isHot = isSampled && flash > 0}
					{@const baseW = row.p * BAR_MAX_W * A_p5}
					{@const grow = 1}
					{@const barW = baseW * grow}
					{@const barX = px + BAR_LABEL_W}
					{@const numFitsInside = barW >= 32}
					<text
						x={px + BAR_LABEL_W - 6}
						y={rowY + BAR_ROW_H / 2}
						text-anchor="end"
						dominant-baseline="central"
						font-size="14"
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
							font-size="12"
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
							font-size="12"
							fill={MUTED}
						>
							{row.p.toFixed(2)}
						</text>
					{/if}
				{/each}
			{/each}
		</g>

		<!-- A7: argmax arrows + decoded sequence. Both arrows exit the
		     sampled bar's RIGHT edge and hook down into the decoded slot. -->
		<g opacity={A_p7}>
			{#each maskedIndices as maskedIdx, which}
				{@const px = panelX(which)}
				{@const sIdx = sampledIndexA[which]}
				{@const sampledP = candidatesA[which][sIdx].p}
				{@const sampledBarW = sampledP * BAR_MAX_W * 1.1}
				{@const sampledRowY = yFor(0, BAR_Y_TOP + sIdx * BAR_ROW_H + BAR_ROW_H / 2)}
				{@const startX = px + BAR_LABEL_W + sampledBarW + 4}
				{@const startY = sampledRowY}
				{@const endX = slotX(maskedIdx)}
				{@const endY = yFor(0, SEQ_Y_BOTTOM - SLOT_H / 2 - 2)}
				{@const curEndX = startX + (endX - startX) * A_p7}
				{@const curEndY = startY + (endY - startY) * A_p7}
				{@const c1X = startX + 40}
				{@const c1Y = startY}
				{@const c2X = curEndX}
				{@const c2Y = startY + (curEndY - startY) * 0.6}
				<path
					d={`M ${startX} ${startY} C ${c1X} ${c1Y}, ${c2X} ${c2Y}, ${curEndX} ${curEndY}`}
					fill="none"
					stroke={ACCENT}
					stroke-width="2"
					marker-end={A_p7 >= 1 ? `url(#${MARKER_ACCENT})` : ''}
				/>
			{/each}
			{#each decodedA as tok, i}
				<text
					x={slotX(i)}
					y={yFor(0, SEQ_Y_BOTTOM)}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="16"
					fill={inputTokens[i] === null ? ACCENT : TEXT_COLOR}
					font-weight={inputTokens[i] === null ? '600' : '400'}
				>
					{tok}
				</text>
			{/each}
		</g>

		<!-- Handoff: a Masked Transformer block sits in the gap between
		     Phase A's decoded row and Phase B's remasked input row. Fades in
		     with the handoff leg. -->
		<g opacity={handoffP}>
			<rect
				x={TX_X}
				y={HANDOFF_TX_Y}
				width={TX_W}
				height={HANDOFF_TX_H}
				rx={14}
				ry={14}
				fill={TX_FILL}
				stroke={TX_STROKE}
				stroke-width="1.5"
			/>
			<text
				x={W / 2}
				y={HANDOFF_TX_Y + HANDOFF_TX_H / 2}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="18"
				font-weight="600"
				fill="#7a7f86"
			>
				Masked Transformer
			</text>
		</g>

		<!-- ============================================================ -->
		<!-- Phase B (lower panel) — same pipeline at Y_OFFSET[1].         -->
		<!-- ============================================================ -->

		<!-- B1: phase B input row. Position 5 shows "Alice" carried down    -->
		<!-- (styled with CARRY_COLOR to convey observed-from-A); position 7 -->
		<!-- is [MASK] (remasked). All other positions are the same context. -->
		<g opacity={B_p1}>
			{#each inputTokens as tok, i}
				{@const observed = observedInB[i]}
				{#if observed === null}
					<rect
						x={slotX(i) - SLOT_W / 2 + 8}
						y={yFor(1, SEQ_Y_TOP) - SLOT_H / 2}
						width={SLOT_W - 16}
						height={SLOT_H}
						rx={5}
						ry={5}
						fill={maskColor}
					/>
					<text
						x={slotX(i)}
						y={yFor(1, SEQ_Y_TOP)}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="12"
						font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"
						fill={maskTextColor}
					>
						[MASK]
					</text>
				{:else}
					{@const carried = tok === null && observed !== null}
					<text
						x={slotX(i)}
						y={yFor(1, SEQ_Y_TOP)}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="16"
						fill={carried ? CARRY_COLOR : TEXT_COLOR}
						font-weight={carried ? '600' : '400'}
					>
						{observed}
					</text>
				{/if}
			{/each}
		</g>

		<!-- B2: arrows into transformer -->
		<g opacity={B_p2}>
			{#each inputTokens as _tok, i}
				{@const y1 = yFor(1, SEQ_Y_TOP + SLOT_H / 2 + 2)}
				{@const yEnd = yFor(1, TX_Y - 4)}
				{@const yCur = y1 + (yEnd - y1) * B_p2}
				<line
					x1={slotX(i)}
					y1={y1}
					x2={slotX(i)}
					y2={yCur}
					stroke={MUTED}
					stroke-width="1.5"
					marker-end={B_p2 >= 1 ? `url(#${MARKER_MUTED})` : ''}
				/>
			{/each}
		</g>

		<!-- B3: transformer block -->
		<g opacity={B_p3}>
			<rect
				x={TX_X}
				y={yFor(1, TX_Y)}
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
				y={yFor(1, TX_Y + TX_H / 2)}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="18"
				font-weight="600"
				fill="#7a7f86"
			>
				Masked Transformer
			</text>
		</g>

		<!-- B4/B5/B6/B7 (arrows → panel, bars + sample flash, argmax +
		     decoded row) are intentionally hidden: Part B ends at its
		     transformer block. -->
	</svg>
</div>

<style>
	.wrap {
		position: relative;
		width: 100%;
		max-width: 860px;
		margin: 0 auto;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
</style>
