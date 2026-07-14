<script lang="ts">
	// Fully-masked variant of ModelPredictionInline. Every input position is
	// [MASK] and every output position is "?" — used to visualize the
	// motivating question of the Masked Language Modeling section: what
	// happens if we try to generate a sequence completely from scratch by
	// feeding an all-masked input to a fixed-rate MLM model?
	//
	// Timeline (matches the sibling component):
	//   Phase 1: (a) all-masked input sequence — pinned visible.
	//   Phase 2: (b) arrows down from each input into the transformer.
	//   Phase 3: (c) transformer block — pinned visible.
	//   Phase 4: (d) arrows from every position of the transformer drop to
	//               the corresponding output slot.
	//   Phase 5: (e) output row of "?" reveals.

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

	let { isActive, maskColor = '#cfe0f2', maskTextColor = '#33506e', width = 520, fontSize = 18 }: Props = $props();

	const maskLabelSize = fontSize * (10 / 14);
	const txLabelSize = fontSize * (15 / 14);

	// --- Palette ---
	const TEXT_COLOR = '#333';
	const MUTED = '#888';
	const ACCENT = '#f17720';
	const TX_FILL = '#f4f6fa';
	const TX_STROKE = '#c8ccd1';

	// --- Content ---
	const N = 8;
	const allIndices = Array.from({ length: N }, (_, i) => i);

	// --- Geometry ---
	const W = width;
	const H = 190;
	const SEQ_Y_TOP = 25;
	const SEQ_Y_BOTTOM = 175;
	const SLOT_W = 60;
	const SLOT_H = 26;
	const seqTotalW = N * SLOT_W;
	const seqX0 = (W - seqTotalW) / 2;
	function slotX(i: number): number {
		return seqX0 + i * SLOT_W + SLOT_W / 2;
	}

	const TX_Y = 82;
	const TX_H = 38;
	const TX_X = seqX0 + 4;
	const TX_W = seqTotalW - 8;

	const MARKER_MUTED = 'mpifm-arrow-muted';
	const MARKER_ACCENT = 'mpifm-arrow-accent';

	// --- Timeline ---
	const P_IN = 650;
	const P_HOLD = 450;
	const END_HOLD = 4500;
	const ANIMATED_PHASES = [2, 4, 5] as const;

	interface State {
		u: number;
	}
	let u = $state(0);
	let player = $state<Player<State> | undefined>(undefined);

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

	function buildTimeline() {
		const b = new TimelineBuilder<State>().setInitialState({ u: 0 });
		for (let i = 0; i < ANIMATED_PHASES.length; i++) {
			const phase = ANIMATED_PHASES[i];
			const from = i;
			const to = i + 1;
			b.add(
				{
					name: `phase-in-${phase}`,
					reduce: (t: number) => ({ u: from + t * (to - from) })
				},
				{ durationMs: P_IN }
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

	onMount(() => {
		player = new Player<State>(buildTimeline(), {
			looping: false,
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

<div class="wrap" style="--mask-color: {maskColor};">
	<svg
		class="canvas"
		viewBox={`0 0 ${W} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Fully-masked variant: every input position is [MASK] and every output position is a question mark, illustrating what it looks like to ask a masked language model to generate a sequence completely from scratch."
		style="max-width: {width}px;"
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

		<!-- Phase 1: fully-masked input sequence -->
		<g opacity={p1}>
			{#each allIndices as i}
				<rect
					x={slotX(i) - SLOT_W / 2 + 6}
					y={SEQ_Y_TOP - SLOT_H / 2}
					width={SLOT_W - 12}
					height={SLOT_H}
					rx={4}
					ry={4}
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
			{/each}
		</g>

		<!-- Phase 2: arrows from every input into the transformer -->
		<g opacity={p2}>
			{#each allIndices as i}
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
				rx={12}
				ry={12}
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

		<!-- Phase 4: arrows from every transformer position to output slot -->
		<g opacity={p4}>
			{#each allIndices as i}
				{@const x = slotX(i)}
				{@const y1 = TX_Y + TX_H + 2}
				{@const yEnd = SEQ_Y_BOTTOM - SLOT_H / 2 - 2}
				{@const yCur = y1 + (yEnd - y1) * p4}
				<line
					x1={x}
					y1={y1}
					x2={x}
					y2={yCur}
					stroke={ACCENT}
					stroke-width="2"
					marker-end={p4 >= 1 ? `url(#${MARKER_ACCENT})` : ''}
				/>
			{/each}
		</g>

		<!-- Phase 5: output row of question marks -->
		<g opacity={p5}>
			{#each allIndices as i}
				<text
					x={slotX(i)}
					y={SEQ_Y_BOTTOM}
					text-anchor="middle"
					dominant-baseline="central"
					font-size={fontSize}
					fill={ACCENT}
					font-weight="600"
				>
					?
				</text>
			{/each}
		</g>
	</svg>
</div>

<style>
	.wrap {
		position: relative;
		width: 100%;
	}
	.canvas {
		width: 100%;
		height: auto;
		display: block;
		margin: 0 auto;
	}
</style>
