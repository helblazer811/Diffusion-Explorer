<script lang="ts">
	// ----------------------------------------------------------------
	// Absorbing Mask — a decoding-trajectory-style visual companion to
	// the sentence "once a position is masked, it stays masked at all
	// later times."
	//
	// The 8-token sequence is unrolled vertically: each row shows the
	// sequence at a progressive forward-process timestep. Row 0 is
	// unmasked, and each subsequent row masks one or two more tokens
	// than the row above — strictly monotone, so once a column turns
	// gray it stays gray in every row below. Rows fade in top-to-bottom
	// on one shared clock; a label + curved arrow anchor the message on
	// the first-masked cell. Plays once; a replay button restarts it.
	// ----------------------------------------------------------------

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import { PlayPauseResetButton } from '@diffusion-explorer/ui';

	// ----------------------------------------------------------------
	// Props
	// ----------------------------------------------------------------

	interface Props {
		isActive?: Writable<boolean>;
		maskColor?: string;
		maskTextColor?: string;
		tokens?: string[];
		width?: number;
	}

	let {
		isActive,
		maskColor = '#cfe0f2',
		maskTextColor = '#33506e',
		tokens = ['the', 'cat', 'sat', 'on', 'the', 'small'],
		width = 780
	}: Props = $props();

	// ----------------------------------------------------------------
	// State
	// ----------------------------------------------------------------

	const TEXT_COLOR = '#333';
	const MUTED = '#888';
	const LABEL_COLOR = '#666';

	// Static row layout: mask sequence for each row. Column indices are
	// masked in a deterministic order chosen to avoid a left-to-right
	// pattern (which would read as autoregressive rather than diffusion).
	// Bumps of 2 in some steps compress the trajectory into 6 rows.
	const N = tokens.length; // 6
	// Deterministic mask order: which token index becomes masked at which
	// step. Chosen by hand so the reveal doesn't look left-to-right.
	const MASK_ORDER = [5, 2, 0, 3, 4, 1];
	// Cumulative mask count at each row (row 0 = 0 masked, final = all).
	// One or two per row to compress into 6 rows.
	const CUMULATIVE = [0, 1, 2, 3, 5, 6];
	const ROWS = CUMULATIVE.length; // 6

	// Precompute the boolean mask grid: rowMasked[r][c] = is column c
	// masked at row r? Monotone in r (once true, stays true).
	const rowMasked: boolean[][] = CUMULATIVE.map((k) => {
		const set = new Set(MASK_ORDER.slice(0, k));
		return Array.from({ length: N }, (_, c) => set.has(c));
	});
	// The annotation now anchors below the whole rollout, with the arrow
	// pointing UP at a masked cell in the final row. We pick a column that
	// (a) is masked in the final row (always true — the final row is all
	// masked) and (b) got masked partway through, so the reader can trace
	// down the column and see the mask persisting.
	const ANCHOR_COL = 3;
	const anchorRow = ROWS - 1;

	// Geometry.
	const W = width;
	const SLOT_W = 74;
	const SLOT_H = 28;
	const ROW_GAP = 6; // vertical space between rows
	const ROW_PITCH = SLOT_H + ROW_GAP;
	const TOP_PAD = 20;
	// Room at the bottom for the "Once masked, stays masked." annotation
	// that now sits under the last row and points up at a masked cell.
	const BOTTOM_LABEL_H = 60;
	const FOOTER_H = 6;
	const H = TOP_PAD + ROWS * ROW_PITCH + BOTTOM_LABEL_H + FOOTER_H;
	const seqTotalW = N * SLOT_W;
	// Grid is centered in the full SVG width.
	const seqX0 = (W - seqTotalW) / 2;

	function slotX(c: number): number {
		return seqX0 + c * SLOT_W + SLOT_W / 2;
	}
	function rowY(r: number): number {
		return TOP_PAD + r * ROW_PITCH + SLOT_H / 2;
	}

	// Timeline scalar: u ∈ [0, ROWS] — floor(u) = last fully-visible row,
	// fractional part = fade-in progress of the next row.
	let u = $state(0);

	// Cross-fade / stagger tunings.
	const ROW_FADE_HALF = 0.35; // rows overlap slightly during their fade-in
	const ANNOTATION_FADE_HALF = 0.45;

	let player = $state<Player<{ u: number }> | undefined>(undefined);
	let isPlaying = $state(false);
	const normalizedTime = $derived(Math.min(1, u / ROWS));

	// ----------------------------------------------------------------
	// Helpers
	// ----------------------------------------------------------------

	function rowOpacity(r: number): number {
		// Each row centers its fade-in on integer u = r. Before u = r -
		// ROW_FADE_HALF the row is invisible; after u = r + ROW_FADE_HALF
		// it's fully visible.
		const d = u - r;
		if (d <= -ROW_FADE_HALF) return 0;
		if (d >= ROW_FADE_HALF) return 1;
		const t = (d + ROW_FADE_HALF) / (2 * ROW_FADE_HALF);
		return t * t * (3 - 2 * t);
	}

	// Annotation fades in as the anchor row appears (the first row where
	// column 0 flips), so the reader sees the arrow arrive with the mask
	// it's pointing at.
	let annotationOpacity = $derived.by(() => {
		const d = u - anchorRow;
		if (d <= -ANNOTATION_FADE_HALF) return 0;
		if (d >= ANNOTATION_FADE_HALF) return 1;
		const t = (d + ANNOTATION_FADE_HALF) / (2 * ANNOTATION_FADE_HALF);
		return t * t * (3 - 2 * t);
	});

	// ----------------------------------------------------------------
	// Setup
	// ----------------------------------------------------------------

	// --- Right-side time axis: a vertical arrow spanning row 0 to row
	// ROWS-1, positioned just past the right edge of the last column.
	// "t=0" aligns to row 0, "t=1" to the last row (both to the right
	// of the shaft); "Forward Process" is rotated 90° on the left of
	// the shaft. Static (always visible).
	const TIME_AXIS_X = seqX0 + seqTotalW + 30;
	const TIME_AXIS_Y_TOP = rowY(0);
	const TIME_AXIS_Y_BOTTOM = rowY(ROWS - 1);

	// --- Static annotation geometry.
	// Label sits below the entire rollout and a short curved arrow reaches
	// up to the bottom edge of a masked cell in the final row.
	const LABEL_LINE_HEIGHT = 22;
	const LAST_ROW_Y = rowY(ROWS - 1);
	const LABEL_LINE1_Y = LAST_ROW_Y + SLOT_H / 2 + 44;
	const LABEL_LINE2_Y = LABEL_LINE1_Y + LABEL_LINE_HEIGHT;
	const LABEL_X = slotX(ANCHOR_COL);

	// Arrow: short vertical-ish cubic from the label's top up to just
	// below the anchor cell in the final row.
	const arrowTargetX = slotX(ANCHOR_COL);
	const arrowTargetY = LAST_ROW_Y + SLOT_H / 2 + 6;
	const arrowStartX = slotX(ANCHOR_COL);
	const arrowStartY = LABEL_LINE1_Y - 16;
	const arrowC1X = arrowStartX;
	const arrowC1Y = arrowStartY - 8;
	const arrowC2X = arrowTargetX;
	const arrowC2Y = arrowTargetY + 8;
	const arrowPath = `M ${arrowStartX} ${arrowStartY} C ${arrowC1X} ${arrowC1Y}, ${arrowC2X} ${arrowC2Y}, ${arrowTargetX} ${arrowTargetY}`;

	// ----------------------------------------------------------------
	// Animations
	// ----------------------------------------------------------------

	// Row-reveal timeline: u advances 0 → ROWS over the forward leg,
	// then holds at ROWS so the finished picture stays on screen. Each
	// row's fade-in occupies ~1 unit of u.
	const FORWARD_MS = 4200;
	const END_HOLD_MS = 1400;

	function buildTimeline() {
		const forwardClip = {
			name: 'forward',
			reduce(t: number): Partial<{ u: number }> {
				return { u: t * ROWS };
			}
		};
		const holdClip = {
			name: 'hold-mask',
			reduce(_t: number): Partial<{ u: number }> {
				return { u: ROWS };
			}
		};
		return new TimelineBuilder<{ u: number }>()
			.setInitialState({ u: 0 })
			.add(forwardClip, { durationMs: FORWARD_MS })
			.add(holdClip, { durationMs: END_HOLD_MS })
			.build();
	}

	// ----------------------------------------------------------------
	// Event Handlers
	// ----------------------------------------------------------------

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

	// ----------------------------------------------------------------
	// Lifecycle
	// ----------------------------------------------------------------

	onMount(() => {
		player = new Player<{ u: number }>(buildTimeline(), {
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

<div class="wrap">
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
		aria-label="Eight-token sequence unrolled vertically over six timesteps. Each row shows the sequence at a progressive forward-process step; tokens flip to gray mask rectangles and never flip back. A label points at the first-masked cell: once masked, stays masked."
	>
		<!-- Annotation: label under the entire rollout + short curved arrow
		     reaching up into a masked cell in the final row. Fades in as
		     the trajectory finishes. -->
		<g opacity={annotationOpacity}>
			<text
				x={LABEL_X}
				y={LABEL_LINE1_Y}
				text-anchor="middle"
				dominant-baseline="alphabetic"
				font-size="18"
				fill={LABEL_COLOR}
				font-style="italic"
			>
				Once masked,
			</text>
			<text
				x={LABEL_X}
				y={LABEL_LINE2_Y}
				text-anchor="middle"
				dominant-baseline="alphabetic"
				font-size="18"
				fill={LABEL_COLOR}
				font-style="italic"
			>
				stays masked.
			</text>
			<path
				d={arrowPath}
				fill="none"
				stroke={MUTED}
				stroke-width="1.4"
				marker-end="url(#absorbing-arrowhead)"
			/>
		</g>

		<defs>
			<marker
				id="absorbing-arrowhead"
				viewBox="0 -5 10 10"
				refX={8}
				refY={0}
				markerWidth={5}
				markerHeight={5}
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill={MUTED} />
			</marker>
		</defs>

		<!-- Right-side time axis: vertical downward arrow whose endpoints
		     line up with the first and last rows. t=0 and t=1 sit to the
		     right of the shaft, vertically centered on their rows. -->
		<g>
			<line
				x1={TIME_AXIS_X}
				y1={TIME_AXIS_Y_TOP}
				x2={TIME_AXIS_X}
				y2={TIME_AXIS_Y_BOTTOM}
				stroke={MUTED}
				stroke-width="1.4"
				marker-end="url(#absorbing-arrowhead)"
			/>
			<text
				x={TIME_AXIS_X + 14}
				y={TIME_AXIS_Y_TOP}
				text-anchor="start"
				dominant-baseline="central"
				font-size="16"
				fill={LABEL_COLOR}
			>
				t=0
			</text>
			<text
				x={TIME_AXIS_X + 14}
				y={TIME_AXIS_Y_BOTTOM}
				text-anchor="start"
				dominant-baseline="central"
				font-size="16"
				fill={LABEL_COLOR}
			>
				t=1
			</text>
			<g transform={`rotate(90 ${TIME_AXIS_X + 30} ${(TIME_AXIS_Y_TOP + TIME_AXIS_Y_BOTTOM) / 2})`}>
				<text
					x={TIME_AXIS_X + 30}
					y={(TIME_AXIS_Y_TOP + TIME_AXIS_Y_BOTTOM) / 2 - 9}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="17"
					fill={LABEL_COLOR}
					font-style="italic"
				>
					Forward
				</text>
				<text
					x={TIME_AXIS_X + 30}
					y={(TIME_AXIS_Y_TOP + TIME_AXIS_Y_BOTTOM) / 2 + 9}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="17"
					fill={LABEL_COLOR}
					font-style="italic"
				>
					Process
				</text>
			</g>
		</g>

		<!-- Grid: one row per timestep, each row stagger-fades in on the
		     shared clock. Cells are either the word or the [MASK] rect. -->
		{#each rowMasked as row, r}
			{@const op = rowOpacity(r)}
			{@const y = rowY(r)}
			<g opacity={op}>
				{#each row as isMasked, c}
					{@const cx = slotX(c)}
					{#if isMasked}
						<rect
							x={cx - SLOT_W / 2 + 1}
							y={y - SLOT_H / 2 - 2}
							width={SLOT_W - 2}
							height={SLOT_H + 4}
							rx={4}
							ry={4}
							fill={maskColor}
						/>
						<text
							x={cx}
							y={y}
							text-anchor="middle"
							dominant-baseline="central"
							font-size="16"
							font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"
							fill={maskTextColor}
						>
							[MASK]
						</text>
					{:else}
						<text
							x={cx}
							y={y}
							text-anchor="middle"
							dominant-baseline="central"
							font-size="18"
							fill={TEXT_COLOR}
						>
							{tokens[c]}
						</text>
					{/if}
				{/each}
			</g>
		{/each}
	</svg>
</div>

<style>
	.wrap {
		position: relative;
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
