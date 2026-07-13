<script lang="ts">
	// Inline animation that visualizes the MLM cross-entropy loss geometrically:
	// the model's predicted categorical distribution (left panel) is dragged
	// toward the one-hot target distribution (right panel). Bars stay in a
	// fixed order — no reordering or rank animation — so the reader focuses on
	// mass migrating between rows, not on words changing rank.
	//
	// Timeline (looping; no replay button):
	//   Phase 1: left-panel probabilities interpolate linearly toward the
	//            one-hot on `target`. The target row also colors from muted
	//            blue → accent orange as its probability grows.
	//   Phase 2: brief hold at the fully-collapsed state.
	// Panel titles (math symbols) are rendered as HTML above the SVG using
	// the shared Katex component, since KaTeX outputs HTML/MathML and cannot
	// live inside an SVG <text> element.

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import { Katex } from '@diffusion-explorer/ui';

	interface Bar {
		word: string;
		p: number;
	}

	interface Props {
		isActive?: Writable<boolean>;
		width?: number;
		fontSize?: number;
		bars?: Bar[];
		target?: string;
	}

	let {
		isActive,
		width = 620,
		fontSize = 17,
		bars = [
			{ word: 'black', p: 0.28 },
			{ word: 'angry', p: 0.14 },
			{ word: 'little', p: 0.19 },
			{ word: 'warm', p: 0.09 },
			{ word: 'sleepy', p: 0.3 }
		],
		target = 'little'
	}: Props = $props();

	const labelSize = fontSize;
	const probSize = fontSize * (12 / 14);

	// --- Palette ---
	const MUTED = '#888';
	const ACCENT = '#f17720';
	const BAR_COLOR = '#99BCDC';

	// --- Geometry ---
	const W = width;
	const N = bars.length;
	const ROW_H = 28;
	const BAR_H = 20;
	const ZERO_STEM_W = 6;
	const BARS_TOP = 14;
	const PANEL_H = BARS_TOP + N * ROW_H + 10;
	const H = PANEL_H;

	// Two panels split the width, with a narrow arrow region between them.
	const ARROW_W = 44;
	const PANEL_W = (W - ARROW_W) / 2;
	const LEFT_X = 0;
	const RIGHT_X = PANEL_W + ARROW_W;

	const LABEL_W = 62;
	const PROB_W = 36;
	const BAR_MAX_W = PANEL_W - LABEL_W - PROB_W - 8;

	const targetIndex = bars.findIndex((b) => b.word === target);

	// --- Timeline ---
	const P_ANIM = 3600;
	const END_HOLD = 1500;

	interface State {
		t: number;
	}
	let t = $state(0);
	let player = $state<Player<State> | undefined>(undefined);

	function smoothstep(x: number): number {
		const c = Math.max(0, Math.min(1, x));
		return c * c * (3 - 2 * c);
	}

	let animT = $derived(smoothstep(t));
	let predicted = $derived(
		bars.map((b, i) => {
			const targetP = i === targetIndex ? 1 : 0;
			return b.p + (targetP - b.p) * animT;
		})
	);

	function buildTimeline() {
		const b = new TimelineBuilder<State>().setInitialState({ t: 0 });
		b.add(
			{
				name: 'collapse',
				reduce: (u: number) => ({ t: u })
			},
			{ durationMs: P_ANIM }
		);
		b.add(
			{
				name: 'hold',
				reduce: (_u: number) => ({ t: 1 })
			},
			{ durationMs: END_HOLD }
		);
		return b.build();
	}

	onMount(() => {
		player = new Player<State>(buildTimeline(), {
			looping: true,
			endPause: 0.05
		});
		player.onTick((_ms, s) => {
			t = s.t;
		});
		const unsubActive = isActive?.subscribe((v) => {
			if (!player) return;
			if (v) player.play();
			else {
				player.pause();
				player.reset();
				t = 0;
			}
		});
		return () => {
			unsubActive?.();
			player?.dispose();
		};
	});

	function panelBarX(panelLeft: number): number {
		return panelLeft + LABEL_W;
	}

	function rowY(i: number): number {
		return BARS_TOP + i * ROW_H + ROW_H / 2;
	}

	const arrowX = LEFT_X + PANEL_W + 6;
	const arrowY = BARS_TOP + (N * ROW_H) / 2;

	function targetColor(intensity: number): string {
		const [r1, g1, b1] = [0x99, 0xbc, 0xdc];
		const [r2, g2, b2] = [0xf1, 0x77, 0x20];
		const k = Math.max(0, Math.min(1, intensity));
		const r = Math.round(r1 + (r2 - r1) * k);
		const g = Math.round(g1 + (g2 - g1) * k);
		const b = Math.round(b1 + (b2 - b1) * k);
		return `rgb(${r}, ${g}, ${b})`;
	}
</script>

<div class="wrap" style="max-width: {width}px;">
	<div class="titles">
		<div class="title-cell" style="width: {(PANEL_W / W) * 100}%;">
			<div class="title-text">Model Prediction</div>
			<div class="title-math">
				<Katex math={"p_\\theta(\\mathbf{x}^\\ell \\mid \\tilde{\\mathbf{x}})"} />
			</div>
		</div>
		<div class="arrow-spacer" style="width: {(ARROW_W / W) * 100}%;"></div>
		<div class="title-cell" style="width: {(PANEL_W / W) * 100}%;">
			<div class="title-text">Target</div>
			<div class="title-math"><Katex math={"\\mathbf{x}^\\ell"} /></div>
		</div>
	</div>

	<svg
		class="canvas"
		viewBox={`0 0 ${W} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Animation showing the model's predicted categorical distribution over five vocabulary words on the left being pulled toward the one-hot target distribution on the right, illustrating the geometric effect of the MLM cross-entropy loss."
	>
		<defs>
			<marker
				id="mlm-arrow"
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

		<!-- Left panel: model prediction (animated) -->
		<g>
			{#each bars as bar, i}
				{@const p = predicted[i]}
				{@const isTarget = i === targetIndex}
				{@const barW = Math.max(p * BAR_MAX_W, ZERO_STEM_W)}
				{@const barX = panelBarX(LEFT_X)}
				{@const y = rowY(i)}
				{@const fill = isTarget ? targetColor(animT) : BAR_COLOR}
				<text
					x={barX - 6}
					y={y}
					text-anchor="end"
					dominant-baseline="central"
					font-size={labelSize}
					fill={isTarget && animT > 0.55 ? ACCENT : MUTED}
					font-weight={isTarget && animT > 0.55 ? '600' : '400'}
				>
					{bar.word}
				</text>
				<rect
					x={barX}
					y={y - BAR_H / 2}
					width={barW}
					height={BAR_H}
					rx={3}
					ry={3}
					fill={fill}
					opacity={0.85}
				/>
				<text
					x={barX + barW + 4}
					y={y}
					text-anchor="start"
					dominant-baseline="central"
					font-size={probSize}
					fill={MUTED}
				>
					{p.toFixed(2)}
				</text>
			{/each}
		</g>

		<!-- Arrow between panels -->
		<g>
			<line
				x1={arrowX}
				y1={arrowY}
				x2={arrowX + ARROW_W - 12}
				y2={arrowY}
				stroke={MUTED}
				stroke-width="1.5"
				marker-end="url(#mlm-arrow)"
			/>
		</g>

		<!-- Right panel: target one-hot (static) -->
		<g>
			{#each bars as bar, i}
				{@const isTarget = i === targetIndex}
				{@const p = isTarget ? 1 : 0}
				{@const barW = Math.max(p * BAR_MAX_W, ZERO_STEM_W)}
				{@const barX = panelBarX(RIGHT_X)}
				{@const y = rowY(i)}
				{@const fill = isTarget ? ACCENT : BAR_COLOR}
				<text
					x={barX - 6}
					y={y}
					text-anchor="end"
					dominant-baseline="central"
					font-size={labelSize}
					fill={isTarget ? ACCENT : MUTED}
					font-weight={isTarget ? '600' : '400'}
				>
					{bar.word}
				</text>
				<rect
					x={barX}
					y={y - BAR_H / 2}
					width={barW}
					height={BAR_H}
					rx={3}
					ry={3}
					fill={fill}
					opacity={0.85}
				/>
				<text
					x={barX + barW + 4}
					y={y}
					text-anchor="start"
					dominant-baseline="central"
					font-size={probSize}
					fill={MUTED}
				>
					{p.toFixed(2)}
				</text>
			{/each}
		</g>
	</svg>
</div>

<style>
	.wrap {
		width: 100%;
		margin: 0 auto;
	}
	.titles {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		margin-bottom: 0.4rem;
	}
	.title-cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}
	.title-text {
		font-size: 1.25rem;
		font-weight: 500;
		color: #666;
	}
	.title-math {
		font-size: 1.4rem;
		color: #666;
	}
	.arrow-spacer {
		flex-shrink: 0;
	}
	.canvas {
		width: 100%;
		height: auto;
		display: block;
	}
</style>
